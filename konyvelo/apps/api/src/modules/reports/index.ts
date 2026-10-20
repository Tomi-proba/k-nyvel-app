import { and, desc, eq, lt, sql } from "drizzle-orm";
import {
  ACCOUNT_CLASSES,
  addDays,
  addMonths,
  buildBalanceSheet,
  buildIncomeStatement,
  formatDateHu,
  todayIso,
  type AccountTurnover,
  type DocumentType,
  type StatementLine,
} from "@konyvelo/domain";
import type { JournalDto, LedgerDto, ReportCompany, StatementDto, TrialBalanceDto, TrialBalanceRow } from "@konyvelo/shared";
import { requireCompanyPermission } from "../../core/auth";
import type { Executor } from "../../core/db";
import { assertUuid, notFound, validationError } from "../../core/errors";
import type { AppModule } from "../../core/modules";
import { accounts, companies, fiscalYears, partners } from "../../core/schema";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const JOURNAL_LIMIT = 20_000;
/** Mérlegszámla (1–4. osztály, a 49 évnyitó/évzáró nélkül): az egyenlege áthúzódik az üzleti évek között. */
const IS_BS = sql`(left(a.number, 1) IN ('1','2','3','4') AND left(a.number, 2) <> '49')`;
const SIGNED = sql`CASE l.side WHEN 'D' THEN l.amount ELSE -l.amount END`;

async function companyHeader(db: Executor, companyId: string): Promise<ReportCompany> {
  const [c] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!c) throw notFound("A cég nem található.");
  const address = [c.addressPostalCode, c.addressCity, c.addressLine].filter(Boolean).join(" ") || null;
  return { name: c.name, taxNumber: c.taxNumber, registrationNumber: c.registrationNumber, address, representativeName: c.representativeName, audited: c.audited };
}

async function fiscalYearOf(db: Executor, companyId: string, date: string) {
  const [fy] = await db
    .select()
    .from(fiscalYears)
    .where(and(eq(fiscalYears.companyId, companyId), sql`${date}::date BETWEEN ${fiscalYears.startDate} AND ${fiscalYears.endDate}`));
  return fy ?? null;
}

function dateParam(v: string | undefined, field: string, fallback?: string): string {
  if (v && ISO.test(v)) return v;
  if (fallback) return fallback;
  throw validationError({ [field]: "Adjon meg érvényes dátumot (ÉÉÉÉ.HH.NN.)." });
}

/** Számlánkénti tartozik/követel forgalom a megadott feltételekkel (csak könyvelt bizonylatok). */
async function turnovers(db: Executor, companyId: string, where: ReturnType<typeof sql>): Promise<AccountTurnover[]> {
  const r = await db.execute<{ number: string; name: string; bs_line_debit: string | null; bs_line_credit: string | null; is_line: string | null; d: string | null; c: string | null }>(sql`
    SELECT a.number, a.name, a.bs_line_debit, a.bs_line_credit, a.is_line,
           sum(l.amount) FILTER (WHERE l.side = 'D') AS d, sum(l.amount) FILTER (WHERE l.side = 'C') AS c
      FROM journal_lines l JOIN documents d ON d.id = l.document_id JOIN accounts a ON a.id = l.account_id
     WHERE l.company_id = ${companyId} AND d.status = 'POSTED' AND ${where}
     GROUP BY a.id ORDER BY a.number`);
  return r.rows.map((x) => ({
    number: x.number,
    name: x.name,
    bsLineDebit: x.bs_line_debit,
    bsLineCredit: x.bs_line_credit,
    isLine: x.is_line,
    debit: Number(x.d ?? 0),
    credit: Number(x.c ?? 0),
  }));
}

async function incomeStatementFor(db: Executor, companyId: string, from: string, to: string) {
  return buildIncomeStatement(await turnovers(db, companyId, sql`d.accounting_date BETWEEN ${from}::date AND ${to}::date`));
}

/** Mérleg egy fordulónapra: mérlegszámlák teljes egyenlege; tárgyévi és korábbi, még le nem zárt eredmény. */
async function balanceSheetFor(db: Executor, companyId: string, asOf: string) {
  const fy = await fiscalYearOf(db, companyId, asOf);
  const start = fy?.startDate ?? `${asOf.slice(0, 4)}-01-01`;
  const bsAccounts = await turnovers(db, companyId, sql`${IS_BS} AND d.accounting_date <= ${asOf}::date`);
  const current = await incomeStatementFor(db, companyId, start, asOf);
  const prior = buildIncomeStatement(await turnovers(db, companyId, sql`d.accounting_date < ${start}::date`));
  return { ...buildBalanceSheet(bsAccounts, current.result, prior.result), isUnmapped: current.unmapped };
}

/** A tárgyévi sorok mellé az előző évi érték (ha van előző év). */
function mergeLines(cur: readonly StatementLine[], prev: readonly StatementLine[] | null): StatementDto["lines"] {
  const p = prev ? new Map(prev.map((l) => [l.code, l.value])) : null;
  return cur.map((l) => ({ ...l, previous: p ? (p.get(l.code) ?? 0) : null }));
}

export const reportsModule: AppModule = {
  name: "reports",
  register(app, { db }) {
    const base = "/api/companies/:companyId/reports";
    type Q = { Params: { companyId: string }; Querystring: Record<string, string | undefined> };

    /** Főkönyvi kivonat (Szt. 164. § (2)): nyitó, időszaki és halmozott forgalom, záró egyenleg számlánként. */
    app.get<Q>(`${base}/trial-balance`, async (request): Promise<TrialBalanceDto> => {
      const { companyId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      const to = dateParam(request.query.to, "to", todayIso());
      const fy = await fiscalYearOf(db, companyId, to);
      if (!fy) throw validationError({ to: `A dátum (${formatDateHu(to)}) egyik üzleti évbe sem esik.` });
      const from = dateParam(request.query.from, "from", fy.startDate);
      if (from < fy.startDate || from > to) throw validationError({ from: `Az időszaknak az üzleti éven belül kell lennie (${formatDateHu(fy.startDate)} – ${formatDateHu(fy.endDate)}).` });
      const r = await db.execute<{ id: string; number: string; name: string; cls: number; od: string; oc: string; pd: string; pc: string; cd: string; cc: string }>(sql`
        WITH x AS (
          SELECT a.id, a.number, a.name, a.account_class AS cls, l.side, l.amount, d.accounting_date AS dt, ${IS_BS} AS bs
            FROM journal_lines l JOIN documents d ON d.id = l.document_id JOIN accounts a ON a.id = l.account_id
           WHERE l.company_id = ${companyId} AND d.status = 'POSTED' AND d.accounting_date <= ${to}::date
        )
        SELECT id, number, name, cls,
               coalesce(sum(amount) FILTER (WHERE side = 'D' AND dt < ${from}::date AND (bs OR dt >= ${fy.startDate}::date)), 0) AS od,
               coalesce(sum(amount) FILTER (WHERE side = 'C' AND dt < ${from}::date AND (bs OR dt >= ${fy.startDate}::date)), 0) AS oc,
               coalesce(sum(amount) FILTER (WHERE side = 'D' AND dt >= ${from}::date), 0) AS pd,
               coalesce(sum(amount) FILTER (WHERE side = 'C' AND dt >= ${from}::date), 0) AS pc,
               coalesce(sum(amount) FILTER (WHERE side = 'D' AND dt >= ${fy.startDate}::date), 0) AS cd,
               coalesce(sum(amount) FILTER (WHERE side = 'C' AND dt >= ${fy.startDate}::date), 0) AS cc
          FROM x GROUP BY id, number, name, cls ORDER BY number`);
      const dc = (d: number, c: number) => ({ debit: d, credit: c });
      const bal = (d: number, c: number) => (d >= c ? dc(d - c, 0) : dc(0, c - d));
      const rows: TrialBalanceRow[] = r.rows
        .map((x) => {
          const [od, oc, pd, pc, cd, cc] = [x.od, x.oc, x.pd, x.pc, x.cd, x.cc].map(Number) as [number, number, number, number, number, number];
          const opening = bal(od, oc);
          return {
            accountId: x.id,
            number: x.number,
            name: x.name,
            accountClass: Number(x.cls),
            opening,
            period: dc(pd, pc),
            cumulative: dc(cd, cc),
            closing: bal(od + pd, oc + pc),
          };
        })
        .filter((x) => x.opening.debit || x.opening.credit || x.period.debit || x.period.credit || x.cumulative.debit || x.cumulative.credit);
      // Korábbi évek le nem zárt eredménye (az eredményszámlák egyenlege az üzleti év előtt).
      const prior = await db.execute<{ s: string | null }>(sql`
        SELECT sum(${SIGNED}) AS s FROM journal_lines l JOIN documents d ON d.id = l.document_id JOIN accounts a ON a.id = l.account_id
         WHERE l.company_id = ${companyId} AND d.status = 'POSTED' AND NOT ${IS_BS} AND d.accounting_date < ${fy.startDate}::date`);
      const priorSigned = Number(prior.rows[0]?.s ?? 0);
      // Az eredményszámlák egyenlegének oldalán (nyereség: követel, veszteség: tartozik).
      const unclosedPriorResult = priorSigned === 0 ? null : bal(Math.max(priorSigned, 0), Math.max(-priorSigned, 0));
      const zero = () => ({ opening: dc(0, 0), period: dc(0, 0), cumulative: dc(0, 0), closing: dc(0, 0) });
      const add = (t: ReturnType<typeof zero>, x: TrialBalanceRow) => {
        for (const k of ["opening", "period", "cumulative", "closing"] as const) {
          t[k].debit += x[k].debit;
          t[k].credit += x[k].credit;
        }
      };
      const totals = zero();
      const byClass = new Map<number, ReturnType<typeof zero>>();
      if (unclosedPriorResult) {
        for (const k of ["opening", "closing"] as const) {
          totals[k].debit += unclosedPriorResult.debit;
          totals[k].credit += unclosedPriorResult.credit;
        }
      }
      for (const x of rows) {
        add(totals, x);
        if (!byClass.has(x.accountClass)) byClass.set(x.accountClass, zero());
        add(byClass.get(x.accountClass)!, x);
      }
      return {
        company: await companyHeader(db, companyId),
        from,
        to,
        fiscalYear: { startDate: fy.startDate, endDate: fy.endDate },
        rows,
        unclosedPriorResult,
        classTotals: [...byClass].map(([accountClass, t]) => ({ accountClass, label: ACCOUNT_CLASSES[accountClass] ?? "", ...t })),
        totals,
      };
    });

    /** Naplófőkönyv: a könyvelt tételek időrendben, tartozik és követel oldallal. */
    app.get<Q>(`${base}/journal`, async (request): Promise<JournalDto> => {
      const { companyId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      const to = dateParam(request.query.to, "to", todayIso());
      const from = dateParam(request.query.from, "from", addDays(to, -30));
      const r = await db.execute<{ document_id: string; serial_number: string; doc_type: DocumentType; accounting_date: string; partner_name: string | null; description: string | null; number: string; name: string; side: "D" | "C"; amount: string }>(sql`
        SELECT d.id AS document_id, d.serial_number, d.doc_type, d.accounting_date, p.name AS partner_name, coalesce(l.description, d.description) AS description,
               a.number, a.name, l.side, l.amount
          FROM journal_lines l JOIN documents d ON d.id = l.document_id JOIN accounts a ON a.id = l.account_id LEFT JOIN partners p ON p.id = d.partner_id
         WHERE l.company_id = ${companyId} AND d.status = 'POSTED' AND d.accounting_date BETWEEN ${from}::date AND ${to}::date
         ORDER BY d.accounting_date, d.posted_at, d.id, l.line_no
         LIMIT ${JOURNAL_LIMIT + 1}`);
      const rows = r.rows.slice(0, JOURNAL_LIMIT).map((x) => ({
        documentId: x.document_id,
        serialNumber: x.serial_number,
        docType: x.doc_type,
        date: x.accounting_date,
        partnerName: x.partner_name,
        description: x.description,
        accountNumber: x.number,
        accountName: x.name,
        debit: x.side === "D" ? Number(x.amount) : 0,
        credit: x.side === "C" ? Number(x.amount) : 0,
      }));
      return {
        company: await companyHeader(db, companyId),
        from,
        to,
        rows,
        totals: { debit: rows.reduce((s, x) => s + x.debit, 0), credit: rows.reduce((s, x) => s + x.credit, 0) },
        truncated: r.rows.length > JOURNAL_LIMIT,
      };
    });

    /** Karton: egy számla vagy egy partner tételei futó egyenleggel. */
    app.get<Q>(`${base}/ledger`, async (request): Promise<LedgerDto> => {
      const { companyId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      const { accountId, partnerId } = request.query;
      if (!accountId && !partnerId) throw validationError({ accountId: "Válasszon számlát vagy partnert." });
      if (accountId) assertUuid(accountId, "A számla nem található.");
      if (partnerId) assertUuid(partnerId, "A partner nem található.");
      const to = dateParam(request.query.to, "to", todayIso());
      const fy = await fiscalYearOf(db, companyId, to);
      const from = dateParam(request.query.from, "from", fy?.startDate ?? addDays(to, -30));
      const [account] = accountId ? await db.select().from(accounts).where(and(eq(accounts.companyId, companyId), eq(accounts.id, accountId))) : [];
      const [partner] = partnerId ? await db.select().from(partners).where(and(eq(partners.companyId, companyId), eq(partners.id, partnerId))) : [];
      if (accountId && !account) throw notFound("A számla nem található.");
      if (partnerId && !partner) throw notFound("A partner nem található.");
      const filter = sql`l.company_id = ${companyId} AND d.status = 'POSTED'
        ${accountId ? sql`AND l.account_id = ${accountId}` : sql``} ${partnerId ? sql`AND l.partner_id = ${partnerId}` : sql``}`;
      const startOfYear = fy?.startDate ?? from;
      const open = await db.execute<{ s: string | null }>(sql`
        SELECT sum(${SIGNED}) AS s FROM journal_lines l JOIN documents d ON d.id = l.document_id JOIN accounts a ON a.id = l.account_id
         WHERE ${filter} AND d.accounting_date < ${from}::date AND (${IS_BS} OR d.accounting_date >= ${startOfYear}::date)`);
      const r = await db.execute<{ document_id: string; serial_number: string; accounting_date: string; number: string; partner_name: string | null; description: string | null; side: "D" | "C"; amount: string }>(sql`
        SELECT d.id AS document_id, d.serial_number, d.accounting_date, a.number, p.name AS partner_name, coalesce(l.description, d.description) AS description, l.side, l.amount
          FROM journal_lines l JOIN documents d ON d.id = l.document_id JOIN accounts a ON a.id = l.account_id LEFT JOIN partners p ON p.id = l.partner_id
         WHERE ${filter} AND d.accounting_date BETWEEN ${from}::date AND ${to}::date
         ORDER BY d.accounting_date, d.posted_at, d.id, l.line_no`);
      const opening = Number(open.rows[0]?.s ?? 0);
      let balance = opening;
      const rows = r.rows.map((x) => {
        const debit = x.side === "D" ? Number(x.amount) : 0;
        const credit = x.side === "C" ? Number(x.amount) : 0;
        balance += debit - credit;
        return { documentId: x.document_id, serialNumber: x.serial_number, date: x.accounting_date, accountNumber: x.number, partnerName: x.partner_name, description: x.description, debit, credit, balance };
      });
      return {
        company: await companyHeader(db, companyId),
        account: account ? { id: account.id, number: account.number, name: account.name } : null,
        partner: partner ? { id: partner.id, name: partner.name } : null,
        from,
        to,
        opening,
        rows,
        totals: { debit: rows.reduce((s, x) => s + x.debit, 0), credit: rows.reduce((s, x) => s + x.credit, 0) },
        closing: balance,
      };
    });

    /** Mérleg („A” változat) egy fordulónapra, az előző üzleti év fordulónapjának adataival. */
    app.get<Q>(`${base}/balance-sheet`, async (request): Promise<StatementDto> => {
      const { companyId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      const asOf = dateParam(request.query.asOf, "asOf", todayIso());
      const fy = await fiscalYearOf(db, companyId, asOf);
      const [prevFy] = fy
        ? await db.select().from(fiscalYears).where(and(eq(fiscalYears.companyId, companyId), lt(fiscalYears.endDate, fy.startDate))).orderBy(desc(fiscalYears.endDate)).limit(1)
        : [];
      const cur = await balanceSheetFor(db, companyId, asOf);
      const prev = prevFy ? await balanceSheetFor(db, companyId, prevFy.endDate) : null;
      return {
        company: await companyHeader(db, companyId),
        from: null,
        to: asOf,
        previous: prevFy ? { from: null, to: prevFy.endDate } : null,
        lines: mergeLines(cur.lines, prev?.lines ?? null),
        totals: { assets: cur.assets, sources: cur.sources, previousAssets: prev?.assets ?? null, previousSources: prev?.sources ?? null },
        unmapped: [...cur.unmapped, ...cur.isUnmapped],
      };
    });

    /** Eredménykimutatás (összköltség-eljárás) egy időszakra, az egy évvel korábbi időszak adataival. */
    app.get<Q>(`${base}/income-statement`, async (request): Promise<StatementDto> => {
      const { companyId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      const to = dateParam(request.query.to, "to", todayIso());
      const fy = await fiscalYearOf(db, companyId, to);
      const from = dateParam(request.query.from, "from", fy?.startDate ?? `${to.slice(0, 4)}-01-01`);
      if (from > to) throw validationError({ from: "A kezdő dátum nem lehet későbbi a záró dátumnál." });
      const prevFrom = addMonths(from, -12);
      const prevTo = addMonths(to, -12);
      const cur = await incomeStatementFor(db, companyId, from, to);
      const prevFy = await fiscalYearOf(db, companyId, prevTo);
      const prev = prevFy ? await incomeStatementFor(db, companyId, prevFrom, prevTo) : null;
      return {
        company: await companyHeader(db, companyId),
        from,
        to,
        previous: prev ? { from: prevFrom, to: prevTo } : null,
        lines: mergeLines(cur.lines, prev?.lines ?? null),
        totals: null,
        unmapped: cur.unmapped,
      };
    });
  },
};
