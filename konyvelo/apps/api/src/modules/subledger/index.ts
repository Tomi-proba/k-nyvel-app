import { and, eq, sql } from "drizzle-orm";
import { addDays, daysBetween, dailyClosings, formatDateHu, formatHuf, lineRole, todayIso, type DocumentType, type Subledger } from "@konyvelo/domain";
import {
  settlementCreateSchema,
  type MoneyRegisterDto,
  type OpenItemDto,
  type OpenItemsResponse,
  type ReconciliationResponse,
  type UnappliedDto,
} from "@konyvelo/shared";
import { writeAudit } from "../../core/audit";
import { requireCompanyPermission } from "../../core/auth";
import { pgErrorCode, PG_RAISE, type Executor } from "../../core/db";
import { assertUuid, conflict, notFound, parseBody, validationError } from "../../core/errors";
import type { AppModule } from "../../core/modules";
import { accounts, companies, settlements } from "../../core/schema";
import { emitSettlementsCreated, emitSettlementsRemoved } from "../integration/outbox";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const FAR_FUTURE = "9999-12-31";

type Row = {
  line_id: string;
  document_id: string;
  serial_number: string | null;
  external_number: string | null;
  doc_type: DocumentType;
  description: string | null;
  partner_id: string | null;
  partner_name: string | null;
  account_id: string;
  account_number: string;
  subledger: "CUSTOMER" | "SUPPLIER";
  side: "D" | "C";
  amount: string;
  accounting_date: string;
  issue_date: string | null;
  due_date: string | null;
  settled: string;
};

/**
 * Vevő- és szállítóanalitika egy adott napra: a könyvelt, nem sztornó
 * bizonylatok analitikás sorai a hozzájuk párosított összeggel. A párosítás
 * a két bizonylat közül a későbbi könyvelési napon számít.
 */
export async function openItems(
  db: Executor,
  companyId: string,
  opts: { asOf?: string; partnerId?: string; kind?: "RECEIVABLE" | "PAYABLE" } = {},
): Promise<OpenItemsResponse> {
  const asOf = opts.asOf ?? FAR_FUTURE;
  const result = await db.execute<Row>(sql`
    WITH st AS (
      SELECT s.item_line_id, s.settling_line_id, s.amount
        FROM settlements s
        JOIN journal_lines li ON li.id = s.item_line_id JOIN documents di ON di.id = li.document_id
        JOIN journal_lines ls ON ls.id = s.settling_line_id JOIN documents ds ON ds.id = ls.document_id
       WHERE s.company_id = ${companyId} AND greatest(di.accounting_date, ds.accounting_date) <= ${asOf}::date
    )
    SELECT l.id AS line_id, d.id AS document_id, d.serial_number, d.external_number, d.doc_type, d.description,
           l.partner_id, p.name AS partner_name, a.id AS account_id, a.number AS account_number, a.subledger, l.side, l.amount,
           d.accounting_date, d.issue_date, d.due_date,
           coalesce((SELECT sum(st.amount) FROM st WHERE l.id IN (st.item_line_id, st.settling_line_id)), 0) AS settled
      FROM journal_lines l
      JOIN documents d ON d.id = l.document_id
      JOIN accounts a ON a.id = l.account_id
      LEFT JOIN partners p ON p.id = l.partner_id
     WHERE l.company_id = ${companyId} AND d.status = 'POSTED' AND d.doc_type <> 'SZT'
       AND a.subledger IN ('CUSTOMER', 'SUPPLIER') AND d.accounting_date <= ${asOf}::date
       ${opts.partnerId ? sql`AND l.partner_id = ${opts.partnerId}` : sql``}
       ${opts.kind ? sql`AND a.subledger = ${opts.kind === "RECEIVABLE" ? "CUSTOMER" : "SUPPLIER"}` : sql``}
     ORDER BY coalesce(d.due_date, d.accounting_date), d.serial_number, l.line_no`);
  const today = opts.asOf ?? todayIso();
  const items: OpenItemDto[] = [];
  const unapplied: UnappliedDto[] = [];
  for (const r of result.rows) {
    const amount = Number(r.amount);
    const settled = Number(r.settled);
    const base = {
      lineId: r.line_id,
      documentId: r.document_id,
      serialNumber: r.serial_number,
      externalNumber: r.external_number,
      docType: r.doc_type,
      description: r.description,
      partnerId: r.partner_id,
      partnerName: r.partner_name,
      accountId: r.account_id,
      accountNumber: r.account_number,
      kind: r.subledger === "CUSTOMER" ? ("RECEIVABLE" as const) : ("PAYABLE" as const),
      accountingDate: r.accounting_date,
      issueDate: r.issue_date,
      amount,
      settled,
    };
    if (lineRole(r.subledger, r.side) === "ITEM") {
      if (amount - settled <= 0) continue;
      const dueDate = r.due_date ?? r.accounting_date;
      items.push({ ...base, dueDate, open: amount - settled, daysOverdue: Math.max(0, daysBetween(dueDate, today)) });
    } else if (amount - settled > 0) {
      unapplied.push({ ...base, unapplied: amount - settled });
    }
  }
  return { asOf: opts.asOf ?? today, items, unapplied };
}

/**
 * Pénztár: a bizonylat könyvelése után sem lehet negatív a pénztár egyenlege
 * egyik napon sem a könyvelés napjától kezdve (PLAN 4.7). Az első negatív
 * napot adja vissza.
 */
export async function firstNegativeCash(db: Executor, accountId: string, includeDocumentId: string, fromDate: string): Promise<{ date: string; balance: number } | null> {
  const r = await db.execute<{ accounting_date: string; running: string }>(sql`
    SELECT accounting_date, running FROM (
      SELECT d.accounting_date,
             sum(sum(CASE l.side WHEN 'D' THEN l.amount ELSE -l.amount END)) OVER (ORDER BY d.accounting_date) AS running
        FROM journal_lines l JOIN documents d ON d.id = l.document_id
       WHERE l.account_id = ${accountId} AND (d.status = 'POSTED' OR d.id = ${includeDocumentId})
       GROUP BY d.accounting_date
    ) x
    WHERE accounting_date >= ${fromDate}::date AND running < 0
    ORDER BY accounting_date LIMIT 1`);
  const row = r.rows[0];
  return row ? { date: row.accounting_date, balance: Number(row.running) } : null;
}

type MoneyLine = { document_id: string; serial_number: string; doc_type: DocumentType; accounting_date: string; partner_name: string | null; description: string | null; d: string; c: string };

export async function moneyRegister(db: Executor, companyId: string, accountId: string, from: string, to: string): Promise<MoneyRegisterDto> {
  const [acc] = await db.select().from(accounts).where(and(eq(accounts.companyId, companyId), eq(accounts.id, accountId)));
  if (!acc || (acc.subledger !== "BANK" && acc.subledger !== "CASH")) throw notFound("A pénzeszközszámla nem található.");
  const [company] = await db.select({ limit: companies.cashClosingLimit }).from(companies).where(eq(companies.id, companyId));
  const signed = sql`CASE l.side WHEN 'D' THEN l.amount ELSE -l.amount END`;
  const open = await db.execute<{ s: string | null }>(sql`
    SELECT sum(${signed}) AS s FROM journal_lines l JOIN documents d ON d.id = l.document_id
     WHERE l.account_id = ${accountId} AND d.status = 'POSTED' AND d.accounting_date < ${from}::date`);
  const lines = await db.execute<MoneyLine>(sql`
    SELECT d.id AS document_id, d.serial_number, d.doc_type, d.accounting_date, p.name AS partner_name, d.description,
           sum(CASE WHEN l.side = 'D' THEN l.amount ELSE 0 END) AS d, sum(CASE WHEN l.side = 'C' THEN l.amount ELSE 0 END) AS c
      FROM journal_lines l JOIN documents d ON d.id = l.document_id LEFT JOIN partners p ON p.id = d.partner_id
     WHERE l.account_id = ${accountId} AND d.status = 'POSTED' AND d.accounting_date BETWEEN ${from}::date AND ${to}::date
     GROUP BY d.id, p.name
     ORDER BY d.accounting_date, d.posted_at, d.id`);
  const opening = Number(open.rows[0]?.s ?? 0);
  let balance = opening;
  const rows = lines.rows.map((r) => {
    const debit = Number(r.d);
    const credit = Number(r.c);
    balance += debit - credit;
    return {
      documentId: r.document_id,
      serialNumber: r.serial_number,
      docType: r.doc_type,
      date: r.accounting_date,
      partnerName: r.partner_name,
      description: r.description,
      debit,
      credit,
      balance,
    };
  });
  const limit = acc.subledger === "CASH" ? (company?.limit ?? null) : null;
  return {
    accountId: acc.id,
    accountNumber: acc.number,
    accountName: acc.name,
    subledger: acc.subledger,
    from,
    to,
    opening,
    closing: balance,
    rows,
    days: dailyClosings(opening, rows).map((d) => ({ ...d, overLimit: limit != null && d.closing > limit, negative: d.closing < 0 })),
    limit,
  };
}

/** Egyeztetés (K 4.2): főkönyvi egyenleg és analitika számlánként egy adott napra. */
export async function reconciliation(db: Executor, companyId: string, asOf: string): Promise<ReconciliationResponse> {
  const ledger = await db.execute<{ id: string; number: string; name: string; subledger: Subledger; d: string | null; c: string | null }>(sql`
    SELECT a.id, a.number, a.name, a.subledger,
           sum(l.amount) FILTER (WHERE l.side = 'D' AND d.status = 'POSTED' AND d.accounting_date <= ${asOf}::date) AS d,
           sum(l.amount) FILTER (WHERE l.side = 'C' AND d.status = 'POSTED' AND d.accounting_date <= ${asOf}::date) AS c
      FROM accounts a
      LEFT JOIN journal_lines l ON l.account_id = a.id
      LEFT JOIN documents d ON d.id = l.document_id
     WHERE a.company_id = ${companyId} AND a.subledger <> 'NONE'
     GROUP BY a.id
     HAVING count(l.id) > 0 OR a.is_active
     ORDER BY a.number`);
  const sub = await openItems(db, companyId, { asOf });
  const analytic = new Map<string, number>();
  for (const i of sub.items) analytic.set(i.accountId, (analytic.get(i.accountId) ?? 0) + i.open);
  for (const u of sub.unapplied) analytic.set(u.accountId, (analytic.get(u.accountId) ?? 0) - u.unapplied);
  const rows = ledger.rows
    .filter((r) => r.subledger !== "NONE")
    .map((r) => {
      const d = Number(r.d ?? 0);
      const c = Number(r.c ?? 0);
      const value = r.subledger === "SUPPLIER" ? c - d : d - c;
      const subBal = r.subledger === "CUSTOMER" || r.subledger === "SUPPLIER" ? (analytic.get(r.id) ?? 0) : null;
      return {
        accountId: r.id,
        accountNumber: r.number,
        accountName: r.name,
        subledger: r.subledger as "CUSTOMER" | "SUPPLIER" | "BANK" | "CASH",
        ledger: value,
        subledgerBalance: subBal,
        difference: subBal === null ? 0 : value - subBal,
      };
    });
  return { asOf, rows };
}

export const subledgerModule: AppModule = {
  name: "subledger",
  register(app, { db }) {
    type P = { Params: { companyId: string } };

    app.get<P & { Querystring: { asOf?: string; partnerId?: string; kind?: string } }>("/api/companies/:companyId/open-items", async (request) => {
      const { companyId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      const { asOf, partnerId, kind } = request.query;
      if (partnerId) assertUuid(partnerId);
      return openItems(db, companyId, {
        asOf: asOf && ISO.test(asOf) ? asOf : undefined,
        partnerId,
        kind: kind === "RECEIVABLE" || kind === "PAYABLE" ? kind : undefined,
      });
    });

    /** Utólagos párosítás: egy párosítatlan fizetés és egy nyitott tétel összekapcsolása (könyvelést nem érint). */
    app.post<P>("/api/companies/:companyId/settlements", async (request, reply) => {
      const { companyId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      const input = parseBody(settlementCreateSchema, request.body);
      const created = await db
        .transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"settlements:" + companyId}, 0))`);
          const all = await openItems(tx, companyId);
          const item = all.items.find((i) => i.lineId === input.itemLineId);
          const pay = all.unapplied.find((u) => u.lineId === input.settlingLineId);
          if (!item) throw validationError({ itemLineId: "A tétel nem nyitott, vagy nem található." });
          if (!pay) throw validationError({ settlingLineId: "A fizetés már teljesen párosítva van, vagy nem található." });
          if (item.accountId !== pay.accountId || item.partnerId !== pay.partnerId) {
            throw validationError({ settlingLineId: "Csak azonos számlán és partneren lévő tételek párosíthatók." });
          }
          if (input.amount > Math.min(item.open, pay.unapplied)) {
            throw validationError({ amount: `Legfeljebb ${formatHuf(Math.min(item.open, pay.unapplied))} párosítható.` });
          }
          const [row] = await tx
            .insert(settlements)
            .values({ companyId, itemLineId: item.lineId, settlingLineId: pay.lineId, amount: input.amount, source: "MANUAL", createdBy: user.id })
            .returning();
          await emitSettlementsCreated(tx, companyId, [row!], todayIso());
          await writeAudit(tx, {
            companyId,
            userId: user.id,
            action: "settlement.create",
            entityType: "settlement",
            entityId: row!.id,
            after: { item: item.serialNumber, payment: pay.serialNumber, amount: input.amount },
            ip: request.ip,
          });
          return row!;
        })
        .catch((err: unknown) => {
          if (pgErrorCode(err) === PG_RAISE) throw conflict((err as Error).message);
          throw err;
        });
      return reply.code(201).send({ id: created.id });
    });

    app.delete<{ Params: { companyId: string; settlementId: string } }>("/api/companies/:companyId/settlements/:settlementId", async (request) => {
      const { companyId, settlementId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      assertUuid(settlementId, "A párosítás nem található.");
      await db
        .transaction(async (tx) => {
          const [row] = await tx.select().from(settlements).where(and(eq(settlements.companyId, companyId), eq(settlements.id, settlementId)));
          if (!row) throw notFound("A párosítás nem található.");
          await tx.delete(settlements).where(eq(settlements.id, row.id));
          await emitSettlementsRemoved(tx, companyId, [row], "MANUAL");
          await writeAudit(tx, {
            companyId,
            userId: user.id,
            action: "settlement.delete",
            entityType: "settlement",
            entityId: row.id,
            before: { itemLineId: row.itemLineId, settlingLineId: row.settlingLineId, amount: row.amount, source: row.source },
            ip: request.ip,
          });
        })
        .catch((err: unknown) => {
          if (pgErrorCode(err) === PG_RAISE) throw conflict((err as Error).message);
          throw err;
        });
      return { ok: true };
    });

    app.get<P & { Querystring: { asOf?: string } }>("/api/companies/:companyId/reconciliation", async (request) => {
      const { companyId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      const asOf = request.query.asOf && ISO.test(request.query.asOf) ? request.query.asOf : todayIso();
      return reconciliation(db, companyId, asOf);
    });

    app.get<{ Params: { companyId: string; accountId: string }; Querystring: { from?: string; to?: string } }>(
      "/api/companies/:companyId/money/:accountId",
      async (request) => {
        const { companyId, accountId } = request.params;
        await requireCompanyPermission(db, request, companyId, "company:read");
        assertUuid(accountId, "A pénzeszközszámla nem található.");
        const to = request.query.to && ISO.test(request.query.to) ? request.query.to : todayIso();
        const from = request.query.from && ISO.test(request.query.from) ? request.query.from : addDays(to, -30);
        if (from > to) throw validationError({ from: `A kezdő dátum (${formatDateHu(from)}) nem lehet későbbi a záró dátumnál.` });
        return moneyRegister(db, companyId, accountId, from, to);
      },
    );
  },
};

/** A Kezdőlap pénztár-figyelmeztetései: az elmúlt 30 nap túllépései. */
export async function cashOverLimit(db: Executor, companyId: string) {
  const [company] = await db.select({ limit: companies.cashClosingLimit }).from(companies).where(eq(companies.id, companyId));
  if (company?.limit == null) return [];
  const cash = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.companyId, companyId), eq(accounts.subledger, "CASH")));
  const to = todayIso();
  const out: Array<{ accountId: string; accountNumber: string; date: string; closing: number; limit: number }> = [];
  for (const a of cash) {
    const reg = await moneyRegister(db, companyId, a.id, addDays(to, -30), to);
    for (const d of reg.days) if (d.overLimit) out.push({ accountId: a.id, accountNumber: reg.accountNumber, date: d.date, closing: d.closing, limit: company.limit });
  }
  return out;
}

