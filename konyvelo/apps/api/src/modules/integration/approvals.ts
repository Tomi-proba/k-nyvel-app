import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { approvalRequestSchema, type ApprovalGroupDto, type ApprovalItemDto, type ApprovalKind, type ApprovalResultDto } from "@konyvelo/shared";
import type { FastifyInstance } from "fastify";
import { writeAudit } from "../../core/audit";
import { requireCompanyPermission, type AuthUser } from "../../core/auth";
import { pgErrorCode, type Db, type Executor, type Tx } from "../../core/db";
import { AppError, forbidden, parseBody } from "../../core/errors";
import { accounts, auditLog, documents, integrationRecords, integrationTodos, journalLines, partners, SYSTEM_USER_ID } from "../../core/schema";
import { postDocument, reverseDocument } from "../documents";
import { chooseDate } from "./dates";

/**
 * Csoportos átnézés és jóváhagyás (TERV.md F14.8). A Készletből érkező piszkozatok (beszerzés, ELÁBÉ) és
 * a javasolt sztornók fajta és nap szerint csoportosítva nézhetők át; egyszerre csak a HIÁNYTALAN tételek
 * könyvelhetők, és mindig egy ember kattintásával. Hiánytalan az a tétel, amelyet a Könyvelő könyvelési
 * ellenőrzése most elfogadna: ezt ugyanazzal a könyvelési lépéssel próbáljuk ki, visszagörgetve.
 */

const KIND_OF_TODO: Record<string, ApprovalKind> = { PURCHASE_APPROVAL: "PURCHASE", COGS_APPROVAL: "COGS", REVERSAL_APPROVAL: "REVERSAL" };

class DryRun extends Error {}

/** Kipróbálja a könyvelést (vagy sztornót) mentőponton belül, és mindenképp visszagörgeti. */
async function dryRun(tx: Tx, fn: (sp: Tx) => Promise<unknown>): Promise<string[]> {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp as Tx);
      throw new DryRun();
    });
  } catch (e) {
    if (e instanceof DryRun) return [];
    if (e instanceof AppError) return [e.message, ...Object.values(e.fields ?? {})].filter((m, i, all) => m && all.indexOf(m) === i);
    throw e;
  }
  return [];
}

type QueueEntry = { documentId: string; kind: ApprovalKind; todoKey: string };

async function queue(db: Executor, companyId: string): Promise<QueueEntry[]> {
  const rows = await db
    .select({ documentId: integrationTodos.documentId, kind: integrationTodos.kind, key: integrationTodos.key })
    .from(integrationTodos)
    .where(and(eq(integrationTodos.companyId, companyId), isNull(integrationTodos.resolvedAt), inArray(integrationTodos.kind, Object.keys(KIND_OF_TODO))))
    .orderBy(asc(integrationTodos.createdAt));
  return rows.filter((r) => r.documentId).map((r) => ({ documentId: r.documentId!, kind: KIND_OF_TODO[r.kind]!, todoKey: r.key }));
}

async function reversalRecord(db: Executor, documentId: string) {
  const [r] = await db
    .select()
    .from(integrationRecords)
    .where(and(eq(integrationRecords.documentId, documentId), eq(integrationRecords.kind, "REVERSAL")))
    .orderBy(desc(integrationRecords.createdAt))
    .limit(1);
  return r ?? null;
}

async function purchaseRecord(db: Executor, documentId: string) {
  const [r] = await db.select().from(integrationRecords).where(and(eq(integrationRecords.documentId, documentId), eq(integrationRecords.kind, "PURCHASE")));
  return r ?? null;
}

/** Egy tétel áttekintése: a lényeg és az, hogy most könyvelhető-e. */
async function item(tx: Tx, companyId: string, e: QueueEntry, user: AuthUser): Promise<ApprovalItemDto | null> {
  const [doc] = await tx.select().from(documents).where(and(eq(documents.companyId, companyId), eq(documents.id, e.documentId)));
  if (!doc) return null;
  const lines = await tx
    .select({ accountNumber: accounts.number, side: journalLines.side, amount: journalLines.amount })
    .from(journalLines)
    .leftJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(eq(journalLines.documentId, doc.id))
    .orderBy(asc(journalLines.lineNo));
  const [partner] = doc.partnerId ? await tx.select({ name: partners.name }).from(partners).where(eq(partners.id, doc.partnerId)) : [];
  const total = lines.filter((l) => l.side === "D").reduce((s, l) => s + Math.abs(l.amount), 0);
  let problems: string[] = [];
  let date = doc.accountingDate;
  let dateChoice: ApprovalItemDto["dateChoice"] = null;
  if (e.kind === "REVERSAL") {
    const rec = await reversalRecord(tx, doc.id);
    date = rec?.receivedDate ?? doc.accountingDate;
    if (doc.status !== "POSTED") problems.push("A bizonylat nincs könyvelve.");
    else problems = await dryRun(tx, (sp) => reverseDocument(sp, companyId, doc.id, user, "proba", { accountingDate: date, reason: "próba" }, rec?.eventId ?? null));
  } else {
    if (doc.status === "POSTED") problems.push(`Már könyvelve (${doc.serialNumber}).`);
    else {
      const rec = e.kind === "PURCHASE" ? await purchaseRecord(tx, doc.id) : null;
      if (rec?.needsDateChoice) dateChoice = { receivedDate: rec.receivedDate, invoiceDate: rec.invoiceDate };
      problems = await dryRun(tx, (sp) => postDocument(sp, companyId, doc.id, user, "proba"));
    }
  }
  return {
    documentId: doc.id,
    kind: e.kind,
    date,
    partnerName: partner?.name ?? null,
    description: doc.description,
    externalNumber: doc.externalNumber,
    total,
    lines: lines.map((l) => ({ accountNumber: l.accountNumber, side: l.side, amount: l.amount })),
    // A dátumválasztás a jóváhagyáskor egyszerre megadható, ezért önmagában nem teszi hiányossá a tételt.
    complete: problems.length === 0,
    problems,
    dateChoice,
  };
}

export async function approvalGroups(db: Db, companyId: string, user: AuthUser): Promise<ApprovalGroupDto[]> {
  const entries = await queue(db, companyId);
  // Csak olvasunk: a próbakönyvelések egy visszagörgetett tranzakcióban futnak.
  const items: ApprovalItemDto[] = [];
  await db
    .transaction(async (tx) => {
      for (const e of entries) {
        const it = await item(tx, companyId, e, user);
        if (it) items.push(it);
      }
      throw new DryRun();
    })
    .catch((e: unknown) => {
      if (!(e instanceof DryRun)) throw e;
    });
  const groups = new Map<string, ApprovalGroupDto>();
  for (const it of items) {
    const key = `${it.kind}|${it.date}`;
    const g = groups.get(key) ?? { kind: it.kind, date: it.date, items: [], total: 0, completeCount: 0 };
    g.items.push(it);
    g.total += it.total;
    if (it.complete) g.completeCount++;
    groups.set(key, g);
  }
  const order: Record<ApprovalKind, number> = { PURCHASE: 0, COGS: 1, REVERSAL: 2 };
  return [...groups.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.date.localeCompare(b.date));
}

export async function approvalsRoutes(app: FastifyInstance, db: Db) {
  const base = "/api/companies/:companyId/integration/approvals";
  type P = { Params: { companyId: string } };

  app.get<P>(base, async (request) => {
    const { companyId } = request.params;
    const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
    return approvalGroups(db, companyId, user);
  });

  /**
   * A kijelölt tételek könyvelése egy ember kattintására. Tételenként külön tranzakció: ha egy közben
   * hibássá vált, az nem könyvelődik, a többi igen. Ugyanaz a kérés (batchId) kétszer sem könyvel kétszer.
   */
  app.post<P>(base, async (request): Promise<ApprovalResultDto> => {
    const { companyId } = request.params;
    const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
    if (user.id === SYSTEM_USER_ID) throw forbidden("A gépi felhasználó nem hagyhat jóvá.");
    const input = parseBody(approvalRequestSchema, request.body);

    return db.transaction(async (outer) => {
      // Ugyanazzal az azonosítóval egyszerre csak egy kérés fut; a megismételt kérés a korábbi eredményt kapja.
      await outer.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"approve-batch:" + input.batchId}, 0))`);
      const [done] = await outer
        .select({ after: auditLog.after })
        .from(auditLog)
        .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "integration.approve_batch"), eq(auditLog.entityId, input.batchId)))
        .limit(1);
      if (done) return (done.after as unknown as ApprovalResultDto);

      const entries = new Map((await queue(outer, companyId)).map((e) => [e.documentId, e]));
      const results: ApprovalResultDto["results"] = [];
      for (const documentId of [...new Set(input.documentIds)]) {
        const e = entries.get(documentId);
        if (!e) {
          results.push({ documentId, ok: false, serialNumber: null, message: "Nem jóváhagyásra váró tétel (már könyvelték, törölték, vagy nem a Készletből jött)." });
          continue;
        }
        try {
          // Mentőpont tételenként: a hibás tétel visszagörgetődik, a többi megmarad.
          const serial = await outer.transaction(async (tx) => {
            const t = tx as Tx;
            if (e.kind === "REVERSAL") {
              const rec = await reversalRecord(t, documentId);
              const id = await reverseDocument(t, companyId, documentId, user, request.ip, { accountingDate: rec!.receivedDate!, reason: `A forrás visszavonva: ${rec!.sourceLabel ?? ""}`.trim() }, rec!.eventId);
              const [s] = await t.select({ serial: documents.serialNumber }).from(documents).where(eq(documents.id, id));
              return s?.serial ?? null;
            }
            if (e.kind === "PURCHASE") {
              const rec = await purchaseRecord(t, documentId);
              if (rec?.needsDateChoice) {
                if (!input.purchaseDate) throw new AppError(422, "DATE_CHOICE", "Válassza ki a könyvelés dátumát (bevételezés vagy számla).");
                await chooseDate(t, companyId, documentId, input.purchaseDate, user.id, request.ip);
              }
            }
            const posted = await postDocument(t, companyId, documentId, user, request.ip);
            return posted.serialNumber;
          });
          results.push({ documentId, ok: true, serialNumber: serial, message: null });
        } catch (err) {
          // Az adatbázis védelmei (pl. lezárt időszak triggere) is tételhibának számítanak; a mentőpont miatt a többi tétel folytatható.
          if (err instanceof AppError) results.push({ documentId, ok: false, serialNumber: null, message: [err.message, ...Object.values(err.fields ?? {})].join(" ") });
          else if (pgErrorCode(err)) results.push({ documentId, ok: false, serialNumber: null, message: (err as Error).message });
          else throw err;
        }
      }
      const result: ApprovalResultDto = { batchId: input.batchId, results };
      await writeAudit(outer, {
        companyId,
        userId: user.id,
        action: "integration.approve_batch",
        entityType: "approval_batch",
        entityId: input.batchId,
        after: result as unknown as Record<string, unknown>,
        ip: request.ip,
      });
      return result;
    });
  });
}
