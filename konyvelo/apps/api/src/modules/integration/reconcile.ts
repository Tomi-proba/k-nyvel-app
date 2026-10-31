import { sql } from "drizzle-orm";
import {
  RECONCILE_TODO_STATUSES,
  reconcileReportSchema,
  reconcileRequestSchema,
  vatReconcileRequestSchema,
  type KonyveloAnswer,
  type KonyveloVatAnswer,
  type ReconcileReport,
  type ReconcileResult,
} from "@konyvelo/esemenyek";
import type { Db, Executor, Tx } from "../../core/db";
import { AppError } from "../../core/errors";
import { integrationReconciliations } from "../../core/schema";
import { openTodo, resolveTodo } from "./todos";

/**
 * Egyeztető ellenőrzések a Könyvelő oldalán (TERV.md F16, I4.2).
 *
 * - `answerReconcile`: a központ kérdésére a Könyvelő saját számai (a 261 egyenlege, a 814 forgalma, a
 *   jóváhagyásra váró Készlet-tételek hatása, a Készletből jött tételek, a kifizetettség, a kimenő sor).
 *   Csak könyvelt bizonylatokból, ugyanúgy, ahogy a mérleg és az eredménykimutatás számol.
 * - `storeReport`: a központ eredménye; a nem rendben lévő ellenőrzésből Teendő lesz a Kezdőlapon, a
 *   rendben lévőé lezárul. A program magától soha nem javít a könyvelésen.
 */

// Állandó listák SQL-be (a Drizzle a JS-tömböt egyenként kifejtett paraméterekké alakítaná).
const AMOUNT_KINDS = sql.raw("('PURCHASE', 'COGS', 'RETURN', 'INVENTORY', 'CASH')");
const PAID_KINDS = sql.raw("('PURCHASE', 'PURCHASE_LINK', 'SALE_LINK')");
/** Azonosítók tömbje egyetlen paraméterként (a kérés sémája már ellenőrizte, hogy mind UUID). */
const uuidArray = (ids: readonly string[]) => sql`string_to_array(${ids.join(",")}, ',')::uuid[]`;

const n = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export async function answerReconcile(db: Db, raw: unknown): Promise<KonyveloAnswer> {
  const parsed = reconcileRequestSchema.safeParse(raw);
  if (!parsed.success) throw new AppError(422, "INVALID_REQUEST", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const req = parsed.data;
  const companyId = req.companyRef;
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) throw new AppError(404, "NOT_FOUND", "A cég nem található.");
  const s = await db.execute<{ linked_at: Date | null; unlinked_at: Date | null; inventory_account_id: string | null; cogs_account_id: string | null }>(
    sql`SELECT linked_at, unlinked_at, inventory_account_id, cogs_account_id FROM integration_settings WHERE company_id = ${companyId}`,
  );
  const settings = s.rows[0];
  if (!settings?.linked_at || settings.unlinked_at) throw new AppError(409, "NOT_LINKED", "A cég ebben a Könyvelőben nincs összekapcsolva a központtal.");
  // Számla nélkül nincs mit összevetni: a központ ezt „nem futott”-ként mutatja (a hiányzó hozzárendelés külön Teendő).
  if (!settings.inventory_account_id || !settings.cogs_account_id) {
    throw new AppError(409, "MISSING_MAPPING", "A Könyvelőben nincs megadva a készlet- vagy az ELÁBÉ-számla (Integráció → Számla-hozzárendelés).");
  }
  const inv = settings.inventory_account_id;
  const cogs = settings.cogs_account_id;

  // Egyenleg és forgalom: csak könyvelt bizonylatból. A 814-nél az évzáró (ZAR) nélkül, mint az eredménykimutatásban.
  const sums = await db.execute<{ balance: string; turnover: string }>(sql`
    SELECT coalesce(sum(CASE WHEN l.side = 'D' THEN l.amount ELSE -l.amount END) FILTER (WHERE l.account_id = ${inv} AND d.accounting_date <= ${req.asOf}::date), 0)::text AS balance,
           coalesce(sum(CASE WHEN l.side = 'D' THEN l.amount ELSE -l.amount END) FILTER (
             WHERE l.account_id = ${cogs} AND d.accounting_date BETWEEN ${req.from}::date AND ${req.to}::date AND d.doc_type <> 'ZAR'), 0)::text AS turnover
      FROM journal_lines l JOIN documents d ON d.id = l.document_id
     WHERE l.company_id = ${companyId} AND d.status = 'POSTED' AND l.account_id IN (${inv}, ${cogs})`);

  // A könyvelt automatikus bizonylatok (a tűréshez): a 261-et érintők összesen, a 814-et érintők az időszakban.
  const counts = await db.execute<{ inventory: string; cogs: string }>(sql`
    SELECT count(DISTINCT d.id) FILTER (WHERE l.account_id = ${inv} AND d.accounting_date <= ${req.asOf}::date)::text AS inventory,
           count(DISTINCT d.id) FILTER (WHERE l.account_id = ${cogs} AND d.accounting_date BETWEEN ${req.from}::date AND ${req.to}::date)::text AS cogs
      FROM documents d JOIN journal_lines l ON l.document_id = d.id
     WHERE d.company_id = ${companyId} AND d.status = 'POSTED'
       AND EXISTS (SELECT 1 FROM integration_records r WHERE r.document_id = d.id AND r.source_module = 'keszlet' AND r.kind IN ${AMOUNT_KINDS})`);

  // Jóváhagyásra váró Készlet-tételek: a piszkozatok hatása, és a javasolt (még nem könyvelt) sztornók hatása.
  const pending = await db.execute<{ cnt: string; inventory: string; cogs: string; oldest: Date | null }>(sql`
    WITH drafts AS (
      SELECT DISTINCT d.id, d.accounting_date, r.created_at FROM documents d JOIN integration_records r ON r.document_id = d.id
       WHERE d.company_id = ${companyId} AND d.status = 'DRAFT' AND r.source_module = 'keszlet' AND r.kind IN ${AMOUNT_KINDS}
    ), reversals AS (
      SELECT DISTINCT d.id, ${req.asOf}::date AS accounting_date, t.created_at FROM integration_todos t JOIN documents d ON d.id = t.document_id
       WHERE t.company_id = ${companyId} AND t.kind = 'REVERSAL_APPROVAL' AND t.resolved_at IS NULL AND d.status = 'POSTED'
         AND NOT EXISTS (SELECT 1 FROM documents s WHERE s.reverses_document_id = d.id AND s.status = 'POSTED')
    )
    SELECT ((SELECT count(*) FROM drafts) + (SELECT count(*) FROM reversals))::text AS cnt,
           (coalesce((SELECT sum(CASE WHEN l.side = 'D' THEN l.amount ELSE -l.amount END) FROM journal_lines l JOIN drafts x ON x.id = l.document_id WHERE l.account_id = ${inv}), 0)
            - coalesce((SELECT sum(CASE WHEN l.side = 'D' THEN l.amount ELSE -l.amount END) FROM journal_lines l JOIN reversals x ON x.id = l.document_id WHERE l.account_id = ${inv}), 0))::text AS inventory,
           (coalesce((SELECT sum(CASE WHEN l.side = 'D' THEN l.amount ELSE -l.amount END) FROM journal_lines l JOIN drafts x ON x.id = l.document_id
                       WHERE l.account_id = ${cogs} AND x.accounting_date BETWEEN ${req.from}::date AND ${req.to}::date), 0)
            - coalesce((SELECT sum(CASE WHEN l.side = 'D' THEN l.amount ELSE -l.amount END) FROM journal_lines l JOIN reversals x ON x.id = l.document_id
                       JOIN documents o ON o.id = l.document_id WHERE l.account_id = ${cogs} AND o.accounting_date BETWEEN ${req.from}::date AND ${req.to}::date), 0))::text AS cogs,
           least((SELECT min(created_at) FROM drafts), (SELECT min(created_at) FROM reversals)) AS oldest`);

  // A Készletből jött tételek: a kért események, az időszakban keletkezettek vagy könyveltek, és minden piszkozat.
  const records = await db.execute<{
    event_id: string;
    kind: string;
    source_record_type: string;
    source_record_id: string;
    document_id: string | null;
    serial_number: string | null;
    status: string | null;
    reversed: boolean;
    amount: string | null;
    expected_amount: string | null;
    created_at: Date;
  }>(sql`
    SELECT r.event_id, r.kind, r.source_record_type, r.source_record_id, r.document_id, d.serial_number, d.status,
           EXISTS (SELECT 1 FROM documents s WHERE s.reverses_document_id = d.id AND s.status = 'POSTED') AS reversed,
           (SELECT sum(l.amount) FROM journal_lines l WHERE l.document_id = d.id AND l.side = 'D')::text AS amount,
           r.expected_amount::text AS expected_amount, r.created_at
      FROM integration_records r LEFT JOIN documents d ON d.id = r.document_id
     WHERE r.company_id = ${companyId} AND r.source_module = 'keszlet' AND r.kind <> 'REVERSAL'
       AND (r.event_id = ANY(${uuidArray(req.events)}) OR r.created_at >= ${req.from}::date OR d.accounting_date >= ${req.from}::date OR d.status = 'DRAFT')
     ORDER BY r.created_at LIMIT 40000`);

  // Kifizetettség: a Készlet-forrású vevő- és szállítói számlák nyitott összege (mint a folyószámla).
  const paid = await db.execute<{ source_record_type: string; source_record_id: string; document_id: string; serial_number: string | null; open: string }>(sql`
    SELECT DISTINCT r.source_record_type, r.source_record_id, d.id AS document_id, d.serial_number,
           (SELECT coalesce(sum(greatest(abs(l.amount) - coalesce((SELECT sum(s.amount) FROM settlements s WHERE l.id IN (s.item_line_id, s.settling_line_id)), 0), 0)), 0)
              FROM journal_lines l JOIN accounts a ON a.id = l.account_id
             WHERE l.document_id = d.id AND ((a.subledger = 'CUSTOMER' AND l.side = 'D') OR (a.subledger = 'SUPPLIER' AND l.side = 'C')))::text AS open
      FROM integration_records r JOIN documents d ON d.id = r.document_id
     WHERE r.company_id = ${companyId} AND r.source_module = 'keszlet' AND r.kind IN ${PAID_KINDS} AND d.status = 'POSTED'
       AND NOT EXISTS (SELECT 1 FROM documents s WHERE s.reverses_document_id = d.id AND s.status = 'POSTED')
       AND EXISTS (SELECT 1 FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.document_id = d.id AND a.subledger IN ('CUSTOMER', 'SUPPLIER'))
     LIMIT 40000`);

  const todos = await db.execute<{ cnt: string; oldest: Date | null }>(
    sql`SELECT count(*)::text AS cnt, min(created_at) AS oldest FROM integration_todos WHERE company_id = ${companyId} AND resolved_at IS NULL AND key NOT LIKE 'egyeztetes:%'`,
  );
  const missing = req.events.length
    ? await db.execute<{ id: string }>(sql`
        SELECT e.id::text AS id FROM unnest(${uuidArray(req.events)}) AS e(id)
         WHERE NOT EXISTS (SELECT 1 FROM integration_inbox i WHERE i.event_id = e.id AND i.company_id = ${companyId})`)
    : { rows: [] };
  const outbox = await db.execute<{ waiting: string; oldest: Date | null }>(
    sql`SELECT count(*)::text AS waiting, min(created_at) AS oldest FROM integration_outbox WHERE company_id = ${companyId} AND sent_at IS NULL`,
  );

  const p = pending.rows[0]!;
  return {
    module: "konyvelo",
    inventoryBalance: n(sums.rows[0]?.balance),
    cogsTurnover: n(sums.rows[0]?.turnover),
    postedCount: { inventory: n(counts.rows[0]?.inventory), cogs: n(counts.rows[0]?.cogs) },
    pending: { count: n(p.cnt), inventory: n(p.inventory), cogs: n(p.cogs), oldest: iso(p.oldest) },
    records: records.rows.map((r) => ({
      eventId: r.event_id,
      kind: r.kind,
      sourceRecordType: r.source_record_type,
      sourceRecordId: r.source_record_id,
      documentId: r.document_id,
      serialNumber: r.serial_number,
      status: !r.document_id || !r.status ? "DELETED" : r.status === "DRAFT" ? "DRAFT" : r.reversed ? "REVERSED" : "POSTED",
      amount: r.amount === null ? null : n(r.amount),
      expectedAmount: r.expected_amount === null ? null : n(r.expected_amount),
      createdAt: new Date(r.created_at).toISOString(),
    })),
    paid: paid.rows.map((x) => ({ sourceRecordType: x.source_record_type, sourceRecordId: x.source_record_id, documentId: x.document_id, serialNumber: x.serial_number, open: n(x.open) })),
    openTodos: { count: n(todos.rows[0]?.cnt), oldest: iso(todos.rows[0]?.oldest) },
    missingEvents: missing.rows.map((m) => m.id),
    // A Könyvelő kimenő sora nem ad fel véglegesen: a hibás tételt is újrapróbálja (failed = 0).
    outbox: { waiting: n(outbox.rows[0]?.waiting), failed: 0, oldest: iso(outbox.rows[0]?.oldest) },
  };
}

/** A Teendő szövege az eredményből (az érintett tételek közül legfeljebb 10). */
function todoDetail(r: ReconcileResult): string | null {
  const lines = [r.detail, ...r.items.slice(0, 10).map((i) => `• ${i.label}`), r.items.length > 10 ? `… és további ${r.items.length - 10} tétel` : null].filter(Boolean);
  return lines.length ? lines.join("\n").slice(0, 4000) : null;
}

/**
 * A központ eredménye: eltárolja (csak az újabbat), és ellenőrzésenként Teendőt nyit vagy zár
 * (`egyeztetes:E1` …). A „nem futott” ellenőrzés a korábbi Teendőt nem zárja le.
 */
export async function storeReport(tx: Tx, raw: unknown): Promise<{ stored: boolean }> {
  const parsed = reconcileReportSchema.safeParse(raw);
  if (!parsed.success) throw new AppError(422, "INVALID_REPORT", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const rep: ReconcileReport = parsed.data;
  const companyId = rep.companyRef;
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) throw new AppError(404, "NOT_FOUND", "A cég nem található.");
  const existing = await tx.execute<{ at: Date; run_id: string }>(sql`SELECT at, run_id FROM integration_reconciliations WHERE company_id = ${companyId} FOR UPDATE`);
  const prev = existing.rows[0];
  // Egy régebbi kör eredménye nem írja felül az újabbat (ugyanaz a kör frissülhet, pl. a nyitó különbség elfogadása után).
  if (prev && prev.run_id !== rep.runId && new Date(prev.at).getTime() > Date.parse(rep.at)) return { stored: false };
  const values = { companyId, runId: rep.runId, at: new Date(rep.at), asOf: rep.asOf, periodFrom: rep.from, periodTo: rep.to, results: rep.results, receivedAt: new Date() };
  await tx.insert(integrationReconciliations).values(values).onConflictDoUpdate({ target: integrationReconciliations.companyId, set: values });
  for (const r of rep.results) {
    const key = `egyeztetes:${r.check}`;
    if (r.status === "NEM_FUTOTT") continue;
    if (RECONCILE_TODO_STATUSES.includes(r.status)) {
      await openTodo(tx, companyId, { key, kind: "RECONCILIATION", title: r.title, detail: todoDetail(r) });
    } else {
      await resolveTodo(tx, companyId, key, null);
    }
  }
  return { stored: true };
}

export type ReconciliationView = {
  runId: string;
  at: string;
  asOf: string;
  from: string;
  to: string;
  results: ReconcileResult[];
  receivedAt: string;
};

export async function latestReport(db: Executor, companyId: string): Promise<ReconciliationView | null> {
  const r = await db.execute<{ run_id: string; at: Date; as_of: string; period_from: string; period_to: string; results: ReconcileResult[]; received_at: Date }>(
    sql`SELECT run_id, at, as_of::text, period_from::text, period_to::text, results, received_at FROM integration_reconciliations WHERE company_id = ${companyId}`,
  );
  const x = r.rows[0];
  if (!x) return null;
  return { runId: x.run_id, at: new Date(x.at).toISOString(), asOf: x.as_of, from: x.period_from, to: x.period_to, results: x.results, receivedAt: new Date(x.received_at).toISOString() };
}

// ---------- Áfa-egyeztetés (I5, TERV.md F17.3) ----------

/**
 * A Könyvelő áfaszámai az eÁFA bevallási időszakaira, könyvelt bizonylatokból, a könyvelés napja szerint. Áfás
 * bizonylat: amelynek 466-os vagy 467-es sora van; kivéve az áfa-elszámolás átvezetését (468) és az évnyitást/-zárást.
 */
export async function answerVatReconcile(db: Db, raw: unknown): Promise<KonyveloVatAnswer> {
  const parsed = vatReconcileRequestSchema.safeParse(raw);
  if (!parsed.success) throw new AppError(422, "INVALID_REQUEST", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const req = parsed.data;
  const companyId = req.companyRef;
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) throw new AppError(404, "NOT_FOUND", "A cég nem található.");
  const s = await db.execute<{ linked_at: Date | null; unlinked_at: Date | null }>(sql`SELECT linked_at, unlinked_at FROM integration_settings WHERE company_id = ${companyId}`);
  if (!s.rows[0]?.linked_at || s.rows[0].unlinked_at) throw new AppError(409, "NOT_LINKED", "A cég ebben a Könyvelőben nincs összekapcsolva a központtal.");
  const periods: KonyveloVatAnswer["periods"] = [];
  for (const p of req.periods) {
    const docs = await db.execute<{ id: string; serial_number: string | null; external_number: string | null; tax_number: string | null; accounting_date: string; posted_at: Date; output: string; input: string; settlement: boolean }>(sql`
      SELECT d.id, d.serial_number, d.external_number, pa.tax_number, d.accounting_date::text, coalesce(d.posted_at, d.created_at) AS posted_at,
             coalesce(sum(CASE WHEN a.number LIKE '467%' THEN (CASE WHEN l.side = 'C' THEN l.amount ELSE -l.amount END) ELSE 0 END), 0)::text AS output,
             coalesce(sum(CASE WHEN a.number LIKE '466%' THEN (CASE WHEN l.side = 'D' THEN l.amount ELSE -l.amount END) ELSE 0 END), 0)::text AS input,
             bool_or(a.number LIKE '468%') AS settlement
        FROM documents d JOIN journal_lines l ON l.document_id = d.id JOIN accounts a ON a.id = l.account_id
        LEFT JOIN partners pa ON pa.id = d.partner_id
       WHERE d.company_id = ${companyId} AND d.status = 'POSTED' AND d.doc_type NOT IN ('NYIT', 'ZAR')
         AND d.accounting_date BETWEEN ${p.from}::date AND ${p.to}::date
       GROUP BY d.id, pa.tax_number
      HAVING bool_or(a.number LIKE '466%' OR a.number LIKE '467%')
       ORDER BY d.accounting_date, d.serial_number LIMIT 40000`);
    const vat = docs.rows.filter((d) => !d.settlement);
    periods.push({
      from: p.from,
      to: p.to,
      output: vat.reduce((sum, d) => sum + n(d.output), 0),
      input: vat.reduce((sum, d) => sum + n(d.input), 0),
      settlementDocuments: docs.rows.length - vat.length,
      documents: vat.map((d) => ({
        documentId: d.id,
        serialNumber: d.serial_number,
        externalNumber: d.external_number,
        partnerTaxNumber: d.tax_number,
        accountingDate: d.accounting_date,
        postedAt: new Date(d.posted_at).toISOString(),
        output: n(d.output),
        input: n(d.input),
      })),
    });
  }
  const missing = req.events.length
    ? await db.execute<{ id: string }>(sql`SELECT e.id::text AS id FROM unnest(${uuidArray(req.events)}) AS e(id)
        WHERE NOT EXISTS (SELECT 1 FROM integration_inbox i WHERE i.event_id = e.id AND i.company_id = ${companyId})`)
    : { rows: [] };
  const outbox = await db.execute<{ waiting: string; oldest: Date | null }>(
    sql`SELECT count(*)::text AS waiting, min(created_at) AS oldest FROM integration_outbox WHERE company_id = ${companyId} AND sent_at IS NULL`,
  );
  return {
    module: "konyvelo",
    periods,
    missingEvents: missing.rows.map((m) => m.id),
    outbox: { waiting: n(outbox.rows[0]?.waiting), failed: 0, oldest: iso(outbox.rows[0]?.oldest) },
  };
}
