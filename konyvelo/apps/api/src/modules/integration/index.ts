import { createHash, randomInt } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { addDays, todayIso } from "@konyvelo/domain";
import { createHubClient, INBOUND_PATH, LINK_PATH, MODULE_LABELS, registryOf, validateEvent, verifyHubRequest, type InboundResult, type Module } from "@konyvelo/esemenyek";
import {
  INTEGRATION_ACCOUNT_KEYS,
  INTEGRATION_ACCOUNT_LABELS,
  integrationSettingsSchema,
  type DocumentIntegrationDto,
  type IntegrationStatusDto,
  type IntegrationTodoDto,
} from "@konyvelo/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeAudit } from "../../core/audit";
import { requireCompanyPermission } from "../../core/auth";
import type { Db, Executor, Tx } from "../../core/db";
import { AppError, assertUuid, conflict, notFound, parseBody, validationError } from "../../core/errors";
import type { AppModule } from "../../core/modules";
import {
  companies,
  documents,
  documentStockLines,
  integrationInbox,
  integrationLinkCodes,
  integrationOutbox,
  integrationProducts,
  integrationRecords,
  integrationSettings,
  integrationTodos,
  SYSTEM_USER_ID,
} from "../../core/schema";
import { listAccounts } from "../accounts";
import { reverseDocument } from "../documents";
import { approvalsRoutes } from "./approvals";
import { chooseDate } from "./dates";
import { applyInbound } from "./inbound";
import { refreshMappingTodo } from "./mapping";
import { openIntegrationTodos, resolveTodo } from "./todos";

/**
 * Integráció (I2, TERV.md F14): a Könyvelő az integrációs központon át kapcsolódik a többi modulhoz.
 *
 * - A központ felőli végpontok (`/api/integracio/v1/…`) aláírt kéréssel (HMAC, időbélyeg, egyszer
 *   használható nonce) védettek, munkamenet és CSRF-fejléc nélkül.
 * - Összekapcsolni csak a cég kezelője által készített, egyszer használható, lejáró kapcsolódási kóddal
 *   lehet; az adószám csak kiegészítő ellenőrzés (D13).
 */

const registry = registryOf();
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_TTL_HOURS = 24;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
const taxDigits = (t: string) => t.replace(/\D/g, "");

export async function settingsOf(db: Executor, companyId: string) {
  const [s] = await db.select().from(integrationSettings).where(eq(integrationSettings.companyId, companyId));
  return s ?? null;
}

/** A számla-hozzárendelés kitöltése az alapértelmezett számlatükör szerint (csak a még üres elemeké). */
async function defaultAccountMapping(db: Executor, companyId: string) {
  const all = await listAccounts(db, companyId);
  const out: Partial<Record<(typeof INTEGRATION_ACCOUNT_KEYS)[number], string>> = {};
  for (const k of INTEGRATION_ACCOUNT_KEYS) {
    const a = all.find((x) => x.number === INTEGRATION_ACCOUNT_LABELS[k].number && x.isActive && !x.hasChildren);
    if (a) out[k] = a.id;
  }
  return out;
}

// ---------- A központ felőli, aláírt végpontok ----------

function hubRoutes(app: FastifyInstance, db: Db, secret: string | null) {
  return app.register(async (scope) => {
    // Az aláírás a nyers törzsre vonatkozik: itt nem a JSON-értelmező dolgozik.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "string", bodyLimit: 2 * 1024 * 1024 }, (_req, body, done) => done(null, body));
    scope.setErrorHandler((err, request, reply) => {
      if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: [err.message, ...Object.values(err.fields ?? {})].join(" ") });
      request.log.error(err);
      return reply.code(500).send({ code: "INTERNAL", message: "A Könyvelő belső hibát jelzett; a központ később újrapróbálja." });
    });
    scope.addHook("preHandler", async (request) => {
      if (!secret) throw new AppError(404, "NOT_CONFIGURED", "Az integráció nincs beállítva ebben a Könyvelőben (KOZPONT_URL, KOZPONT_TITOK).");
      const body = typeof request.body === "string" ? request.body : "";
      const check = verifyHubRequest(request.headers, request.method, request.url, body, secret);
      if (!check.ok) throw new AppError(401, check.code, check.message);
      const fresh = await db.execute(sql`INSERT INTO integration_nonces (nonce) VALUES (${check.nonce}) ON CONFLICT DO NOTHING RETURNING nonce`);
      if (!fresh.rows.length) throw new AppError(401, "REPLAYED", "Ezt a kérést már egyszer fogadtuk (ismételt nonce).");
    });
    const json = (raw: unknown) => {
      try {
        return JSON.parse(String(raw ?? "")) as unknown;
      } catch {
        throw new AppError(400, "BAD_REQUEST", "A kérés törzse nem érvényes JSON.");
      }
    };

    /** Kapcsolódási kód beváltása (D13). */
    scope.post(LINK_PATH, async (request) => {
      const body = json(request.body) as { code?: unknown; taxNumber?: unknown };
      const code = normalizeCode(String(body.code ?? ""));
      const tax = taxDigits(String(body.taxNumber ?? ""));
      const invalid = () => new AppError(422, "INVALID_CODE", "A kapcsolódási kód érvénytelen, lejárt vagy már felhasználták, vagy nem ehhez a céghez tartozik.");
      if (code.length < 12) throw invalid();
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(integrationLinkCodes)
          .where(and(eq(integrationLinkCodes.codeHash, sha(code)), isNull(integrationLinkCodes.usedAt), isNull(integrationLinkCodes.revokedAt), gt(integrationLinkCodes.expiresAt, new Date())))
          .for("update");
        if (!row) throw invalid();
        const [company] = await tx.select().from(companies).where(eq(companies.id, row.companyId));
        // A kód mellé az adószám is egyezzen (teljes adószám), de az adószám önmagában soha nem elég.
        if (!company || taxDigits(company.taxNumber) !== tax) throw invalid();
        await tx.update(integrationLinkCodes).set({ usedAt: new Date() }).where(eq(integrationLinkCodes.id, row.id));
        const mapping = await defaultAccountMapping(tx, company.id);
        const existing = await settingsOf(tx, company.id);
        const linked = { linkedAt: new Date(), unlinkedAt: null, postingMode: "DRAFT_ONLY" as const, draftOnlyUntil: addMonths(todayIso(), 1), updatedAt: new Date(), updatedBy: SYSTEM_USER_ID };
        if (existing) {
          const fill = Object.fromEntries(INTEGRATION_ACCOUNT_KEYS.filter((k) => !existing[k] && mapping[k]).map((k) => [k, mapping[k]]));
          await tx.update(integrationSettings).set({ ...linked, ...fill }).where(eq(integrationSettings.companyId, company.id));
        } else {
          await tx.insert(integrationSettings).values({ companyId: company.id, ...linked, ...mapping });
        }
        await refreshMappingTodo(tx, company.id);
        await writeAudit(tx, {
          companyId: company.id,
          userId: SYSTEM_USER_ID,
          action: "integration.link",
          entityType: "company",
          entityId: company.id,
          after: { postingMode: "DRAFT_ONLY", draftOnlyUntil: linked.draftOnlyUntil, codeCreatedBy: row.createdBy },
          ip: request.ip,
        });
        return { companyRef: company.id, companyName: company.name, taxNumber: company.taxNumber };
      });
    });

    /** Az összekapcsolás bontása a központ felől. */
    scope.delete<{ Params: { companyRef: string } }>(`${LINK_PATH}/:companyRef`, async (request, reply) => {
      const { companyRef } = request.params;
      assertUuid(companyRef, "A cég nem található.");
      await db.transaction(async (tx) => {
        const s = await settingsOf(tx, companyRef);
        if (!s?.linkedAt || s.unlinkedAt) return;
        await tx.update(integrationSettings).set({ unlinkedAt: new Date(), updatedAt: new Date(), updatedBy: SYSTEM_USER_ID }).where(eq(integrationSettings.companyId, companyRef));
        await writeAudit(tx, { companyId: companyRef, userId: SYSTEM_USER_ID, action: "integration.unlink", entityType: "company", entityId: companyRef, after: { by: "központ" }, ip: request.ip });
      });
      return reply.code(204).send();
    });

    /** Egy esemény átadása: pontosan egyszer hat (a bejövő tábla bejegyzésével egy tranzakcióban). */
    scope.post(INBOUND_PATH, async (request): Promise<InboundResult> => {
      const body = json(request.body) as { event?: unknown; targetCompanyRef?: unknown };
      const v = validateEvent(body.event, registry);
      if (!v.ok) throw new AppError(422, "INVALID_EVENT", v.error);
      const event = v.event;
      if (event.source.module === "konyvelo") throw new AppError(422, "INVALID_EVENT", "A Könyvelő a saját eseményét nem fogadja.");
      const companyId = String(body.targetCompanyRef ?? "");
      assertUuid(companyId, "A cég nem található.");
      const settings = await settingsOf(db, companyId);
      if (!settings?.linkedAt || settings.unlinkedAt) throw new AppError(409, "NOT_LINKED", "A cég ebben a Könyvelőben nincs összekapcsolva a központtal.");
      return db.transaction(async (tx) => {
        // Ha egy párhuzamos átadás épp ugyanezt végzi, ez a beszúrás megvárja, és utána ütközést jelez.
        const inserted = await tx
          .insert(integrationInbox)
          .values({ eventId: event.id, companyId, eventType: `${event.type}@${event.version}`, outcome: "PENDING", result: {} })
          .onConflictDoNothing()
          .returning({ id: integrationInbox.eventId });
        if (!inserted.length) {
          const [prev] = await tx.select({ result: integrationInbox.result }).from(integrationInbox).where(eq(integrationInbox.eventId, event.id));
          return { ...((prev?.result ?? {}) as Partial<InboundResult>), outcome: "DUPLICATE" } as InboundResult;
        }
        const result = await applyInbound(tx, companyId, event, settings);
        await tx.update(integrationInbox).set({ outcome: result.outcome, result: result as unknown as Record<string, unknown> }).where(eq(integrationInbox.eventId, event.id));
        return result;
      });
    });
  });
}

function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

// ---------- Teendők ----------

/** Teendőfajták, amelyeket a felhasználó kézzel lezárhat (a többi a művelettel magától lezárul). */
const MANUAL_RESOLVE = new Set(["INVOICE_MISSING", "PARTNER", "SOURCE_WITHDRAWN", "INTRO_MONTH", "UNSUPPORTED", "MISSING_DATA", "STOCK_DISCREPANCY", "SOURCE_CHANGED"]);

// ---------- Útvonalak ----------

export const integrationModule: AppModule = {
  name: "integration",
  async register(app, { db, config }) {
    await hubRoutes(app, db, config.hub?.secret ?? null);
    const hub = config.hub ? createHubClient({ url: config.hub.url, module: "konyvelo", secret: config.hub.secret, timeoutMs: 5_000 }) : null;
    const base = "/api/companies/:companyId/integration";
    type P = { Params: { companyId: string } };

    app.get<P>(base, async (request): Promise<IntegrationStatusDto> => {
      const { companyId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      const s = await settingsOf(db, companyId);
      const [code] = await db
        .select({ expiresAt: integrationLinkCodes.expiresAt })
        .from(integrationLinkCodes)
        .where(and(eq(integrationLinkCodes.companyId, companyId), isNull(integrationLinkCodes.usedAt), isNull(integrationLinkCodes.revokedAt), gt(integrationLinkCodes.expiresAt, new Date())))
        .orderBy(desc(integrationLinkCodes.createdAt))
        .limit(1);
      const [ob] = await db
        .select({ n: sql<number>`count(*)::int`, oldest: sql<Date | null>`min(${integrationOutbox.createdAt})`, lastError: sql<string | null>`(array_agg(${integrationOutbox.lastError} ORDER BY ${integrationOutbox.createdAt} DESC))[1]` })
        .from(integrationOutbox)
        .where(and(eq(integrationOutbox.companyId, companyId), isNull(integrationOutbox.sentAt)));
      return {
        hubConfigured: Boolean(config.hub),
        linked: Boolean(s?.linkedAt && !s.unlinkedAt),
        linkedAt: s?.linkedAt && !s.unlinkedAt ? s.linkedAt.toISOString() : null,
        postingMode: s?.postingMode ?? "DRAFT_ONLY",
        draftOnlyUntil: s?.draftOnlyUntil ?? null,
        purchaseDateRule: s?.purchaseDateRule ?? "ASK",
        accounts: Object.fromEntries(INTEGRATION_ACCOUNT_KEYS.map((k) => [k, s?.[k] ?? null])) as IntegrationStatusDto["accounts"],
        activeCodeExpiresAt: code?.expiresAt.toISOString() ?? null,
        outbox: { waiting: ob?.n ?? 0, oldest: ob?.oldest ? new Date(ob.oldest).toISOString() : null, lastError: ob?.lastError ?? null },
      };
    });

    /** Egyszer használható kapcsolódási kód (24 óráig érvényes); a korábbi, fel nem használt kód érvényét veszti. */
    app.post<P>(`${base}/link-code`, async (request) => {
      const { companyId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "company:update");
      if (!config.hub) throw conflict("Az integrációs központ nincs beállítva ebben a Könyvelőben (KOZPONT_URL, KOZPONT_TITOK); lásd ELESITES.md.");
      const code = Array.from({ length: 16 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
      const expiresAt = new Date(Date.now() + CODE_TTL_HOURS * 3600_000);
      await db.transaction(async (tx) => {
        await tx.update(integrationLinkCodes).set({ revokedAt: new Date() }).where(and(eq(integrationLinkCodes.companyId, companyId), isNull(integrationLinkCodes.usedAt), isNull(integrationLinkCodes.revokedAt)));
        await tx.insert(integrationLinkCodes).values({ companyId, codeHash: sha(code), createdBy: user.id, expiresAt });
        await writeAudit(tx, { companyId, userId: user.id, action: "integration.link_code", entityType: "company", entityId: companyId, after: { expiresAt: expiresAt.toISOString() }, ip: request.ip });
      });
      return { code: `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12)}`, expiresAt: expiresAt.toISOString() };
    });

    /** Az összekapcsolás bontása a Könyvelő felől: nem keletkezik több esemény, és bejövőt sem fogad. */
    app.post<P>(`${base}/unlink`, async (request) => {
      const { companyId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "company:update");
      await db.transaction(async (tx) => {
        const s = await settingsOf(tx, companyId);
        if (!s?.linkedAt || s.unlinkedAt) throw conflict("A cég nincs összekapcsolva.");
        await tx.update(integrationSettings).set({ unlinkedAt: new Date(), updatedAt: new Date(), updatedBy: user.id }).where(eq(integrationSettings.companyId, companyId));
        await writeAudit(tx, { companyId, userId: user.id, action: "integration.unlink", entityType: "company", entityId: companyId, after: { by: "Könyvelő" }, ip: request.ip });
      });
      return { ok: true };
    });

    /** Mód, beszerzési dátumszabály és számla-hozzárendelés (Adminisztrátor, Vezető könyvelő). */
    app.put<P>(`${base}/settings`, async (request) => {
      const { companyId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "company:update");
      const input = parseBody(integrationSettingsSchema, request.body);
      const all = new Map((await listAccounts(db, companyId)).map((a) => [a.id, a]));
      const errors: Record<string, string> = {};
      for (const k of INTEGRATION_ACCOUNT_KEYS) {
        const id = input.accounts[k];
        if (!id) continue;
        const a = all.get(id);
        if (!a) errors[`accounts.${k}`] = "A számla nem található ebben a cégben.";
        else if (!a.isActive) errors[`accounts.${k}`] = `A(z) ${a.number} számla inaktív.`;
        else if (a.hasChildren) errors[`accounts.${k}`] = `A(z) ${a.number} gyűjtőszámla; válasszon alszámlát.`;
      }
      if (Object.keys(errors).length) throw validationError(errors);
      await db.transaction(async (tx) => {
        const before = await settingsOf(tx, companyId);
        if (!before?.linkedAt) throw conflict("Előbb kapcsolja össze a céget az integrációs központtal.");
        await tx
          .update(integrationSettings)
          .set({ postingMode: input.postingMode, purchaseDateRule: input.purchaseDateRule, ...input.accounts, updatedAt: new Date(), updatedBy: user.id })
          .where(eq(integrationSettings.companyId, companyId));
        const changed = (["postingMode", "purchaseDateRule", ...INTEGRATION_ACCOUNT_KEYS] as const).filter((k) =>
          k === "postingMode" || k === "purchaseDateRule" ? before[k] !== input[k] : before[k] !== input.accounts[k],
        );
        if (changed.length) {
          await writeAudit(tx, {
            companyId,
            userId: user.id,
            action: "integration.settings",
            entityType: "company",
            entityId: companyId,
            before: Object.fromEntries(changed.map((k) => [k, before[k]])),
            after: Object.fromEntries(changed.map((k) => [k, k === "postingMode" || k === "purchaseDateRule" ? input[k] : input.accounts[k]])),
            ip: request.ip,
          });
        }
        await refreshMappingTodo(tx, companyId);
        // A bevezető hónap emlékeztetője okafogyott, ha már átkapcsoltak.
        if (input.postingMode === "AUTO") {
          await tx
            .update(integrationTodos)
            .set({ resolvedAt: new Date(), resolvedBy: user.id })
            .where(and(eq(integrationTodos.companyId, companyId), eq(integrationTodos.kind, "INTRO_MONTH"), isNull(integrationTodos.resolvedAt)));
        }
      });
      return { ok: true };
    });

    app.get<P>(`${base}/todos`, async (request) => {
      const { companyId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      return openIntegrationTodos(db, companyId);
    });

    /** Tájékoztató Teendő kézi lezárása (a jóváhagyásra várók a könyveléssel zárulnak). */
    app.post<{ Params: { companyId: string; todoId: string } }>(`${base}/todos/:todoId/resolve`, async (request) => {
      const { companyId, todoId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      assertUuid(todoId, "A Teendő nem található.");
      await db.transaction(async (tx) => {
        const [t] = await tx.select().from(integrationTodos).where(and(eq(integrationTodos.companyId, companyId), eq(integrationTodos.id, todoId)));
        if (!t || t.resolvedAt) throw notFound("A Teendő nem található, vagy már lezárult.");
        if (!MANUAL_RESOLVE.has(t.kind)) throw conflict("Ez a Teendő a tétel könyvelésével vagy törlésével zárul le.");
        await resolveTodo(tx, companyId, t.key, user.id);
        await writeAudit(tx, { companyId, userId: user.id, action: "integration.todo_resolve", entityType: "integration_todo", entityId: t.id, after: { title: t.title }, ip: request.ip });
      });
      return { ok: true };
    });

    /** A Készlet termékei a termékkérdéshez (KK3). */
    app.get<P & { Querystring: { q?: string } }>(`${base}/products`, async (request) => {
      const { companyId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      const q = request.query.q?.trim();
      const like = q ? `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%` : null;
      const rows = await db
        .select()
        .from(integrationProducts)
        .where(and(eq(integrationProducts.companyId, companyId), eq(integrationProducts.active, true), like ? sql`(${integrationProducts.name} ILIKE ${like} OR ${integrationProducts.sku} ILIKE ${like})` : sql`true`))
        .orderBy(asc(integrationProducts.name))
        .limit(50);
      return rows.map((p) => ({ productId: p.productId, name: p.name, sku: p.sku, unit: p.unit, vatRate: p.vatRate === null ? null : Number(p.vatRate) }));
    });

    // ---------- A bizonylat integrációs adatai ----------

    type PD = { Params: { companyId: string; documentId: string } };
    const docBase = "/api/companies/:companyId/documents/:documentId/integration";

    app.get<PD>(docBase, async (request): Promise<DocumentIntegrationDto> => {
      const { companyId, documentId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      assertUuid(documentId, "A bizonylat nem található.");
      const [doc] = await db.select({ id: documents.id, status: documents.status }).from(documents).where(and(eq(documents.companyId, companyId), eq(documents.id, documentId)));
      if (!doc) throw notFound("A bizonylat nem található.");
      const records = await db.select().from(integrationRecords).where(eq(integrationRecords.documentId, documentId)).orderBy(asc(integrationRecords.createdAt));
      const stock = await db.select().from(documentStockLines).where(eq(documentStockLines.documentId, documentId)).orderBy(asc(documentStockLines.lineNo));
      const base = (m: string) => (m === "keszlet" ? config.moduleUrls.keszlet : m === "eafa" ? config.moduleUrls.eafa : null);
      const link = (m: string, url: string | null) => (url && base(m) ? `${base(m)}${url.startsWith("/") ? "" : "/"}${url}` : null);
      const origin = records.find((r) => r.kind === "PURCHASE" && r.needsDateChoice);
      const [openReversal] = doc.status === "POSTED" ? await db.select().from(integrationTodos).where(and(eq(integrationTodos.documentId, documentId), eq(integrationTodos.kind, "REVERSAL_APPROVAL"), isNull(integrationTodos.resolvedAt))) : [];
      const reversalRecord = openReversal ? records.filter((r) => r.kind === "REVERSAL").at(-1) : undefined;
      let targets: DocumentIntegrationDto["targets"] = null;
      if (hub && doc.status === "POSTED") {
        try {
          const links = await hub.links(companyId, "bizonylat", documentId);
          targets = links.filter((l) => l.direction === "to").map((l) => ({ module: l.module, moduleLabel: MODULE_LABELS[l.module as Module] ?? l.module, label: l.label, url: link(l.module, l.url) }));
        } catch {
          targets = null;
        }
      }
      return {
        sources: records
          .filter((r) => r.kind !== "REVERSAL")
          .map((r) => ({ module: r.sourceModule, moduleLabel: MODULE_LABELS[r.sourceModule as Module] ?? r.sourceModule, kind: r.kind, label: r.sourceLabel, url: link(r.sourceModule, r.sourceUrl), at: r.createdAt.toISOString() })),
        dateChoice: origin && doc.status === "DRAFT" ? { receivedDate: origin.receivedDate, invoiceDate: origin.invoiceDate } : null,
        reversal: reversalRecord ? { date: reversalRecord.receivedDate!, reason: reversalRecord.sourceLabel } : null,
        targets,
        stockLines: stock.map((s) => ({ productId: s.productId, productName: s.productName, quantity: Number(s.quantity), unit: s.unit, netAmount: s.netAmount, vatRate: s.vatRate === null ? null : Number(s.vatRate), vatAmount: s.vatAmount })),
        isCogs: records.some((r) => r.kind === "COGS"),
      };
    });

    /** Beszerzésnél a könyvelés dátumának választása (❓2): a bevételezés vagy a számla dátuma. */
    app.post<PD>(`${docBase}/date`, async (request) => {
      const { companyId, documentId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      const { choice } = parseBody(choiceSchema, request.body);
      await db.transaction((tx) => chooseDate(tx, companyId, documentId, choice, user.id, request.ip));
      return { ok: true };
    });

    /** Egy kattintásos sztornó (a forrást visszavonták; „csak piszkozat” módban vagy lezárt időszaknál). */
    app.post<PD>(`${docBase}/reverse`, async (request) => {
      const { companyId, documentId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      const { accountingDate } = parseBody(reverseDateSchema, request.body);
      const id = await db.transaction(async (tx) => {
        const [rec] = await tx
          .select()
          .from(integrationRecords)
          .where(and(eq(integrationRecords.companyId, companyId), eq(integrationRecords.documentId, documentId), eq(integrationRecords.kind, "REVERSAL")))
          .orderBy(desc(integrationRecords.createdAt))
          .limit(1);
        if (!rec) throw notFound("Ehhez a bizonylathoz nincs javasolt sztornó.");
        return reverseDocument(tx, companyId, documentId, user, request.ip, { accountingDate: accountingDate ?? rec.receivedDate!, reason: `A forrás visszavonva: ${rec.sourceLabel ?? ""}`.trim() }, rec.eventId);
      });
      return { id };
    });

    /** A rögzített bizonylat termék-sorai (KK3): csak piszkozaton, a Készlet termékei közül. */
    app.put<PD>(`${docBase}/stock-lines`, async (request) => {
      const { companyId, documentId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      const input = parseBody(stockLinesSchema, request.body);
      assertUuid(documentId, "A bizonylat nem található.");
      await db.transaction(async (tx) => {
        const [d] = await tx.select().from(documents).where(and(eq(documents.companyId, companyId), eq(documents.id, documentId))).for("update");
        if (!d) throw notFound("A bizonylat nem található.");
        if (d.status !== "DRAFT") throw conflict("Könyvelt bizonylat termékei nem módosíthatók.");
        if (!["SZSZ", "VSZ", "HELY"].includes(d.docType)) throw conflict("Terméket csak szállítói, vevő- és helyesbítő számlához lehet megadni.");
        const ids = [...new Set(input.lines.map((l) => l.productId))];
        const products = new Map(
          (ids.length ? await tx.select().from(integrationProducts).where(and(eq(integrationProducts.companyId, companyId), inArray(integrationProducts.productId, ids))) : []).map((p) => [p.productId, p]),
        );
        const errors: Record<string, string> = {};
        input.lines.forEach((l, i) => {
          const p = products.get(l.productId);
          if (!p) errors[`lines.${i}.productId`] = "A termék nem található a Készlet termékei között.";
          // Az eltérő áfakulcsot nem feltételezzük a termékéből, de nem is fogadjuk el kérdés nélkül (F5).
          else if (p.vatRate !== null && l.vatRate !== null && Number(p.vatRate) !== l.vatRate && !l.confirmVatDifference) {
            errors[`lines.${i}.vatRate`] = `Az áfakulcs (${l.vatRate}%) eltér a terméknél megadottól (${Number(p.vatRate)}%). Erősítse meg, ha szándékos.`;
          }
        });
        if (Object.keys(errors).length) throw validationError(errors);
        await tx.delete(documentStockLines).where(eq(documentStockLines.documentId, documentId));
        if (input.lines.length) {
          await tx.insert(documentStockLines).values(
            input.lines.map((l, i) => {
              const p = products.get(l.productId)!;
              return { documentId, lineNo: i + 1, productId: p.productId, productName: p.name, quantity: l.quantity, unit: p.unit, netAmount: l.netAmount, vatRate: l.vatRate, vatAmount: l.vatAmount };
            }),
          );
        }
        await writeAudit(tx, {
          companyId,
          userId: user.id,
          action: "document.stock_lines",
          entityType: "document",
          entityId: documentId,
          after: { lines: input.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, netAmount: l.netAmount })) },
          ip: request.ip,
        });
      });
      return { ok: true };
    });

    await approvalsRoutes(app, db);
  },
};

const choiceSchema = z.object({ choice: z.enum(["RECEIVED", "INVOICE"], { error: "Válassza ki a dátumot." }) });
const stockLinesSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().min(1, "Válasszon terméket."),
        quantity: z.number({ error: "Adja meg a mennyiséget." }).positive("A mennyiség legyen pozitív."),
        netAmount: z.number().int("Az összeg egész fillér legyen."),
        vatRate: z.number().min(0).max(100).nullable(),
        vatAmount: z.number().int("Az összeg egész fillér legyen."),
        confirmVatDifference: z.boolean().optional(),
      }),
    )
    .max(200),
});
const reverseDateSchema = z.object({ accountingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Érvénytelen dátum.").optional() });

