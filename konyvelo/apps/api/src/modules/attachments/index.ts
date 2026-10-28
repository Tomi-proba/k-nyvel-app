import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { canonicalJson, checkAttachment } from "@konyvelo/domain";
import type { AttachmentDto, IntegrityReport } from "@konyvelo/shared";
import { writeAudit } from "../../core/audit";
import { requireCompanyPermission } from "../../core/auth";
import type { Executor, Tx } from "../../core/db";
import { AppError, assertUuid, conflict, notFound, validationError } from "../../core/errors";
import { storageKey, type FileStore } from "../../core/filestore";
import type { AppModule } from "../../core/modules";
import { attachments, documents, journalLines, users } from "../../core/schema";
import { documentHash } from "../documents";
import { listAccounts } from "../accounts";

/**
 * Csatolmányok (K9): a bizonylathoz feltöltött PDF vagy kép.
 *
 * - A típust a fájl tartalma alapján ellenőrizzük, a kiterjesztésnek is egyeznie kell; méretkorlát.
 * - SHA-256 lenyomat; a könyvelés előtt feltöltött csatolmány a bizonylat tartalmi hash-ébe számít, és
 *   minden könyvelt bizonylat csatolmánya bekerül a cégenkénti csatolmány-láncba. Utólagos csere,
 *   törlés vagy eltüntetés így kimutatható (`/integrity`).
 * - Könyvelt bizonylat csatolmánya nem törölhető (az adatbázis is tiltja), újabb feltölthető mellé.
 */

type Row = typeof attachments.$inferSelect;
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

export function attachmentDto(a: Row, uploadedByName: string | null): AttachmentDto {
  return {
    id: a.id,
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    sha256: a.sha256,
    uploadedAt: a.uploadedAt.toISOString(),
    uploadedByName,
    locked: a.chainHash !== null,
    inDocumentHash: a.inDocumentHash,
  };
}

export async function documentAttachments(db: Executor, documentId: string): Promise<AttachmentDto[]> {
  const rows = await db
    .select({ a: attachments, name: users.name })
    .from(attachments)
    .leftJoin(users, eq(users.id, attachments.uploadedBy))
    .where(eq(attachments.documentId, documentId))
    .orderBy(asc(attachments.uploadedAt), asc(attachments.id));
  return rows.map((r) => attachmentDto(r.a, r.name));
}

/** A csatolmány leírása, ahogy a bizonylat tartalmi hash-ébe számít. */
export const attachmentHashPart = (a: Pick<Row, "id" | "fileName" | "mimeType" | "sizeBytes" | "sha256">) => ({
  id: a.id,
  fileName: a.fileName,
  mimeType: a.mimeType,
  size: a.sizeBytes,
  sha256: a.sha256,
});

function chainHash(a: Row, seq: number, prevHash: string | null, documentContentHash: string): string {
  return sha256(
    canonicalJson({
      v: 1,
      seq,
      prevHash,
      companyId: a.companyId,
      id: a.id,
      documentId: a.documentId,
      documentContentHash,
      fileName: a.fileName,
      mimeType: a.mimeType,
      size: a.sizeBytes,
      sha256: a.sha256,
      uploadedAt: a.uploadedAt.toISOString(),
      uploadedBy: a.uploadedBy,
    }),
  );
}

/** A csatolmány felvétele a cég csatolmány-láncába (a hívó tranzakciójában, sorba rendezve). */
export async function chainAttachment(tx: Tx, a: Row, documentContentHash: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"attachments-chain:" + a.companyId}, 0))`);
  const [last] = await tx
    .select({ seq: attachments.chainSeq, hash: attachments.chainHash })
    .from(attachments)
    .where(and(eq(attachments.companyId, a.companyId), isNotNull(attachments.chainSeq)))
    .orderBy(desc(attachments.chainSeq))
    .limit(1);
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? null;
  await tx.update(attachments).set({ chainSeq: seq, prevHash, chainHash: chainHash(a, seq, prevHash, documentContentHash) }).where(eq(attachments.id, a.id));
}

/** A könyvelés előtti csatolmányok (a bizonylat hash-ébe számítanak). */
export async function draftAttachments(tx: Executor, documentId: string): Promise<Row[]> {
  return tx.select().from(attachments).where(eq(attachments.documentId, documentId)).orderBy(asc(attachments.uploadedAt), asc(attachments.id));
}

/** Könyveléskor: a csatolmányok a bizonylat hash-ébe számítottak; most a láncba is bekerülnek. */
export async function lockAttachmentsOnPosting(tx: Tx, rows: Row[], documentContentHash: string): Promise<void> {
  for (const a of rows) {
    await tx.update(attachments).set({ inDocumentHash: true }).where(eq(attachments.id, a.id));
    await chainAttachment(tx, { ...a, inDocumentHash: true }, documentContentHash);
  }
}

/** A bizonylatok tartalmi hash-ének és a csatolmány-láncnak, valamint a tárolt fájloknak az ellenőrzése. */
export async function verifyIntegrity(db: Executor, files: FileStore, companyId: string): Promise<IntegrityReport> {
  const accounts = new Map((await listAccounts(db, companyId)).map((a) => [a.id, a]));
  const docs = await db.select().from(documents).where(and(eq(documents.companyId, companyId), eq(documents.status, "POSTED"))).orderBy(asc(documents.postedAt), asc(documents.id));
  const lines = docs.length ? await db.select().from(journalLines).where(inArray(journalLines.documentId, docs.map((d) => d.id))).orderBy(asc(journalLines.lineNo)) : [];
  const atts = await db.select().from(attachments).where(eq(attachments.companyId, companyId)).orderBy(asc(attachments.uploadedAt), asc(attachments.id));
  const byDoc = new Map<string, Row[]>();
  for (const a of atts) byDoc.set(a.documentId, [...(byDoc.get(a.documentId) ?? []), a]);
  const linesByDoc = new Map<string, typeof lines>();
  for (const l of lines) linesByDoc.set(l.documentId, [...(linesByDoc.get(l.documentId) ?? []), l]);

  const documentProblems: IntegrityReport["documents"]["problems"] = [];
  const contentHashById = new Map<string, string>();
  for (const d of docs) {
    contentHashById.set(d.id, d.contentHash ?? "");
    const included = (byDoc.get(d.id) ?? []).filter((a) => a.inDocumentHash);
    const recomputed = documentHash({ doc: d, prevHash: d.prevHash, serialNumber: d.serialNumber!, postedAt: d.postedAt!, postedBy: d.postedBy!, lines: linesByDoc.get(d.id) ?? [], accounts, attachments: included });
    if (recomputed !== d.contentHash) documentProblems.push({ documentId: d.id, serialNumber: d.serialNumber, reason: "CONTENT_CHANGED" });
  }

  const attachmentProblems: IntegrityReport["attachments"]["problems"] = [];
  const serial = new Map(docs.map((d) => [d.id, d.serialNumber]));
  const chained = atts.filter((a) => a.chainSeq !== null).sort((x, y) => x.chainSeq! - y.chainSeq!);
  let prev: string | null = null;
  chained.forEach((a, i) => {
    const expected = chainHash(a, i + 1, prev, contentHashById.get(a.documentId) ?? "");
    if (a.chainSeq !== i + 1 || a.prevHash !== prev || a.chainHash !== expected) {
      attachmentProblems.push({ attachmentId: a.id, fileName: a.fileName, serialNumber: serial.get(a.documentId) ?? null, reason: "CHAIN_BROKEN" });
    }
    prev = a.chainHash;
  });
  // A könyvelt bizonylat minden csatolmánya a láncban van.
  for (const a of atts) {
    if (serial.has(a.documentId) && a.chainSeq === null) attachmentProblems.push({ attachmentId: a.id, fileName: a.fileName, serialNumber: serial.get(a.documentId) ?? null, reason: "CHAIN_BROKEN" });
  }
  // A tárolt fájl tartalma (minden csatolmányé, a piszkozatoké is).
  for (const a of atts) {
    const data = await files.get(a.storageKey);
    if (!data) attachmentProblems.push({ attachmentId: a.id, fileName: a.fileName, serialNumber: serial.get(a.documentId) ?? null, reason: "FILE_MISSING" });
    else if (sha256(data) !== a.sha256) attachmentProblems.push({ attachmentId: a.id, fileName: a.fileName, serialNumber: serial.get(a.documentId) ?? null, reason: "FILE_CHANGED" });
  }
  return {
    ok: documentProblems.length === 0 && attachmentProblems.length === 0,
    documents: { checked: docs.length, problems: documentProblems },
    attachments: { checked: atts.length, problems: attachmentProblems },
  };
}

async function loadDocument(db: Executor, companyId: string, documentId: string) {
  assertUuid(documentId, "A bizonylat nem található.");
  const [d] = await db.select().from(documents).where(and(eq(documents.companyId, companyId), eq(documents.id, documentId)));
  if (!d) throw notFound("A bizonylat nem található.");
  return d;
}

async function loadAttachment(db: Executor, companyId: string, documentId: string, id: string) {
  assertUuid(id, "A csatolmány nem található.");
  const [a] = await db.select().from(attachments).where(and(eq(attachments.companyId, companyId), eq(attachments.documentId, documentId), eq(attachments.id, id)));
  if (!a) throw notFound("A csatolmány nem található.");
  return a;
}

/** RFC 5987 szerinti fájlnév a Content-Disposition fejlécben (ékezetes névvel is). */
const disposition = (kind: "inline" | "attachment", name: string) => `${kind}; filename="${name.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

export const attachmentsModule: AppModule = {
  name: "attachments",
  register(app, { db, config, files }) {
    const base = "/api/companies/:companyId/documents/:documentId/attachments";
    type PD = { Params: { companyId: string; documentId: string } };
    type PA = { Params: { companyId: string; documentId: string; attachmentId: string }; Querystring: { letoltes?: string } };

    // A feltöltés nyers bájtokként érkezik (a fájlnév az X-File-Name fejlécben).
    app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: config.attachmentMaxBytes + 1024 }, (_req, body, done) => done(null, body));

    app.get<PD>(base, async (request) => {
      const { companyId, documentId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      await loadDocument(db, companyId, documentId);
      return documentAttachments(db, documentId);
    });

    /** Feltöltés: piszkozathoz és könyvelt bizonylathoz is (a könyvelthez csak hozzáadni lehet). */
    app.post<PD>(base, { bodyLimit: config.attachmentMaxBytes + 1024 }, async (request, reply) => {
      const { companyId, documentId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      const doc = await loadDocument(db, companyId, documentId);
      if (!Buffer.isBuffer(request.body)) throw validationError({ file: "Válasszon fájlt (PDF, JPEG vagy PNG)." });
      const rawName = String(request.headers["x-file-name"] ?? "");
      let fileName: string;
      try {
        fileName = decodeURIComponent(rawName);
      } catch {
        fileName = "";
      }
      const check = checkAttachment(fileName, request.body, config.attachmentMaxBytes);
      if (!check.ok) throw validationError({ file: check.message }, check.message);
      const id = randomUUID();
      const key = storageKey(companyId, id);
      const data = request.body;
      const hash = sha256(data);
      // Előbb a fájl kerül a tárolóba; ha az adatbázis-írás nem sikerül, töröljük.
      await files.put(key, data, check.type);
      try {
        await db.transaction(async (tx) => {
          // A bizonylat zárolása előbb: egy közben futó könyvelés vagy az előtt, vagy az után látja a csatolmányt.
          const [current] = await tx.select({ status: documents.status, contentHash: documents.contentHash }).from(documents).where(eq(documents.id, doc.id)).for("update");
          const [row] = await tx
            .insert(attachments)
            .values({ id, companyId, documentId, fileName: check.fileName, mimeType: check.type, sizeBytes: data.length, sha256: hash, storageKey: key, uploadedAt: new Date(), uploadedBy: user.id })
            .returning();
          if (current!.status === "POSTED") await chainAttachment(tx, row!, current!.contentHash!);
          await writeAudit(tx, {
            companyId,
            userId: user.id,
            action: "attachment.upload",
            entityType: "document",
            entityId: documentId,
            after: { attachmentId: id, fileName: check.fileName, mimeType: check.type, size: data.length, sha256: hash, documentPosted: current!.status === "POSTED" },
            ip: request.ip,
          });
        });
      } catch (e) {
        await files.delete(key).catch(() => undefined);
        throw e;
      }
      return reply.code(201).send((await documentAttachments(db, documentId)).find((a) => a.id === id));
    });

    /** A fájl tartalma (előnézethez vagy letöltéshez). A lenyomatot minden kiadáskor ellenőrizzük. */
    app.get<PA>(`${base}/:attachmentId/content`, async (request, reply) => {
      const { companyId, documentId, attachmentId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      const a = await loadAttachment(db, companyId, documentId, attachmentId);
      const data = await files.get(a.storageKey);
      if (!data) throw new AppError(409, "FILE_MISSING", "A csatolmány fájlja hiányzik a tárolóból. Állítsa vissza mentésből, és szóljon az üzemeltetőnek.");
      if (sha256(data) !== a.sha256) throw new AppError(409, "FILE_CHANGED", "A csatolmány fájlja megváltozott a feltöltés óta (a lenyomata nem egyezik). Állítsa vissza mentésből.");
      return reply
        .header("Content-Type", a.mimeType)
        .header("Content-Disposition", disposition(request.query.letoltes === "1" ? "attachment" : "inline", a.fileName))
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
        .send(data);
    });

    /** Csak piszkozat csatolmánya törölhető. */
    app.delete<PA>(`${base}/:attachmentId`, async (request) => {
      const { companyId, documentId, attachmentId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      const doc = await loadDocument(db, companyId, documentId);
      if (doc.status === "POSTED") throw conflict("Könyvelt bizonylat csatolmánya nem törölhető (Szt. 169. §). Újabb csatolmányt feltölthet mellé.");
      const a = await loadAttachment(db, companyId, documentId, attachmentId);
      await db.transaction(async (tx) => {
        await tx.delete(attachments).where(eq(attachments.id, a.id));
        await writeAudit(tx, {
          companyId,
          userId: user.id,
          action: "attachment.delete",
          entityType: "document",
          entityId: documentId,
          before: { attachmentId: a.id, fileName: a.fileName, sha256: a.sha256 },
          ip: request.ip,
        });
      });
      await files.delete(a.storageKey).catch(() => undefined);
      return { ok: true };
    });

    /** A bizonylatok és a csatolmányok sértetlenségének ellenőrzése (Adminisztrátor, Vezető könyvelő). */
    app.get<{ Params: { companyId: string } }>("/api/companies/:companyId/integrity", async (request) => {
      const { companyId } = request.params;
      await requireCompanyPermission(db, request, companyId, "audit:read");
      return verifyIntegrity(db, files, companyId);
    });
  },
};
