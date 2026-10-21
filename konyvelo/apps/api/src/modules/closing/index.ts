import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { addDays, buildClosingLines, CLOSING_ACCOUNTS, formatDateHu, formatHuf, lineRole, monthLabelHu, retentionUntil } from "@konyvelo/domain";
import type { ClosingStatusDto } from "@konyvelo/shared";
import { writeAudit } from "../../core/audit";
import { requireCompanyPermission, type AuthUser } from "../../core/auth";
import { pgErrorCode, PG_RAISE, type Executor, type Tx } from "../../core/db";
import { assertUuid, conflict, notFound, parseBody, validationError } from "../../core/errors";
import type { AppModule } from "../../core/modules";
import { companies, documents, fiscalYears, partners, periods } from "../../core/schema";
import { listAccounts } from "../accounts";
import { createSystemDocument, reverseDocument } from "../documents";
import { reconciliation } from "../subledger";

const reasonSchema = z.object({
  reason: z.string({ error: "Az indoklás kötelező." }).trim().min(5, "Írja le röviden az indoklást (legalább 5 karakter).").max(500, "Legfeljebb 500 karakter."),
});
const closeYearSchema = z.object({ confirmName: z.string({ error: "Írja be a cég rövid nevét." }).trim() });

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Érvénytelen dátum.");
const filler = z.number().int().min(0);
export const openingSchema = z.object({
  date: iso,
  balances: z.array(z.object({ accountId: z.uuid(), debit: filler, credit: filler })).max(2000),
  openItems: z
    .array(
      z.object({
        accountId: z.uuid(),
        partnerId: z.uuid(),
        externalNumber: z.string().trim().min(1, "Hiányzik a számlaszám.").max(100),
        dueDate: iso,
        amount: z.number().int().positive(),
      }),
    )
    .max(5000)
    .default([]),
});

function mapDbError(err: unknown): never {
  if (pgErrorCode(err) === PG_RAISE) throw conflict((err as Error).message);
  throw err;
}

async function loadYear(db: Executor, companyId: string, fyId: string) {
  assertUuid(fyId, "Az üzleti év nem található.");
  const [fy] = await db.select().from(fiscalYears).where(and(eq(fiscalYears.companyId, companyId), eq(fiscalYears.id, fyId)));
  if (!fy) throw notFound("Az üzleti év nem található.");
  return fy;
}

async function nextYear(db: Executor, companyId: string, endDate: string) {
  const [n] = await db
    .select()
    .from(fiscalYears)
    .where(and(eq(fiscalYears.companyId, companyId), gt(fiscalYears.startDate, endDate)))
    .orderBy(asc(fiscalYears.startDate))
    .limit(1);
  return n ?? null;
}

async function draftCounts(db: Executor, companyId: string, from: string, to: string) {
  const r = await db.execute<{ n: string }>(sql`
    SELECT count(*) AS n FROM documents WHERE company_id = ${companyId} AND status = 'DRAFT' AND accounting_date BETWEEN ${from}::date AND ${to}::date`);
  return Number(r.rows[0]?.n ?? 0);
}

/** A zárási számlák (493, 419, 413, 491) a cég számlatükrében: léteznek, könyvelhetők, aktívak. */
async function closingAccounts(db: Executor, companyId: string) {
  const all = await listAccounts(db, companyId);
  const find = (n: string) => all.find((a) => a.number === n && !a.hasChildren && a.isActive);
  const missing = Object.values(CLOSING_ACCOUNTS).filter((n) => !find(n));
  return { find, missing, all };
}

/** A záró bizonylat sorai: az üzleti év eredményszámláinak egyenlege (a korábbi záró bizonylatok nélkül). */
async function closingPreview(db: Executor, companyId: string, fy: { startDate: string; endDate: string }) {
  const { find, missing, all } = await closingAccounts(db, companyId);
  const r = await db.execute<{ account_id: string; number: string; d: string | null; c: string | null }>(sql`
    SELECT a.id AS account_id, a.number, sum(l.amount) FILTER (WHERE l.side = 'D') AS d, sum(l.amount) FILTER (WHERE l.side = 'C') AS c
      FROM journal_lines l JOIN documents d ON d.id = l.document_id JOIN accounts a ON a.id = l.account_id
     WHERE l.company_id = ${companyId} AND d.status = 'POSTED' AND d.accounting_date BETWEEN ${fy.startDate}::date AND ${fy.endDate}::date
     GROUP BY a.id ORDER BY a.number`);
  const balances = r.rows.map((x) => ({ accountId: x.account_id, number: x.number, debit: Number(x.d ?? 0), credit: Number(x.c ?? 0) }));
  if (missing.length) return { missing, lines: [], result: 0, all };
  const { lines, result } = buildClosingLines(balances, { clearingId: find(CLOSING_ACCOUNTS.resultClearing)!.id, resultId: find(CLOSING_ACCOUNTS.result)!.id });
  return { missing, lines, result, all };
}

async function systemDocs(db: Executor, companyId: string, fyId: string, docType: "ZAR" | "NYIT") {
  return db
    .select({ id: documents.id, serialNumber: documents.serialNumber })
    .from(documents)
    .where(
      and(
        eq(documents.companyId, companyId),
        eq(documents.fiscalYearId, fyId),
        eq(documents.docType, docType),
        eq(documents.status, "POSTED"),
        sql`NOT EXISTS (SELECT 1 FROM documents r WHERE r.reverses_document_id = ${documents.id})`,
      ),
    );
}

export async function closingStatus(db: Executor, companyId: string, fyId: string): Promise<ClosingStatusDto> {
  const fy = await loadYear(db, companyId, fyId);
  const ps = await db.select().from(periods).where(eq(periods.fiscalYearId, fy.id)).orderBy(asc(periods.startDate));
  const counts = await db.execute<{ start_date: string; n: string }>(sql`
    SELECT p.start_date, count(d.id) AS n FROM periods p
      LEFT JOIN documents d ON d.company_id = p.company_id AND d.status = 'DRAFT' AND d.accounting_date BETWEEN p.start_date AND p.end_date
     WHERE p.fiscal_year_id = ${fy.id} GROUP BY p.start_date`);
  const draftsBy = new Map(counts.rows.map((r) => [r.start_date, Number(r.n)]));
  const next = await nextYear(db, companyId, fy.endDate);
  const preview = fy.status === "CLOSED" ? null : await closingPreview(db, companyId, fy);
  const rec = await reconciliation(db, companyId, fy.endDate);
  const byId = new Map((preview?.all ?? []).map((a) => [a.id, a]));
  return {
    fiscalYear: { id: fy.id, startDate: fy.startDate, endDate: fy.endDate, status: fy.status, closedAt: fy.closedAt?.toISOString() ?? null, retentionUntil: fy.retentionUntil },
    periods: ps.map((p) => ({ id: p.id, startDate: p.startDate, endDate: p.endDate, status: p.status, drafts: draftsBy.get(p.startDate) ?? 0, label: monthLabelHu(p.startDate) })),
    drafts: [...draftsBy.values()].reduce((s, n) => s + n, 0),
    reconciliationDifferences: rec.rows.filter((r) => r.difference !== 0).map((r) => ({ accountNumber: r.accountNumber, difference: r.difference })),
    missingAccounts: preview?.missing ?? [],
    nextFiscalYear: next ? { id: next.id, startDate: next.startDate, endDate: next.endDate, status: next.status } : null,
    preview: preview
      ? {
          result: preview.result,
          lines: preview.lines.map((l) => ({ accountNumber: byId.get(l.accountId)?.number ?? "", accountName: byId.get(l.accountId)?.name ?? "", side: l.side, amount: l.amount })),
        }
      : null,
    closingDocuments: [...(await systemDocs(db, companyId, fy.id, "ZAR")), ...(next ? await systemDocs(db, companyId, next.id, "NYIT") : [])],
  };
}

async function setPeriodStatus(tx: Tx, companyId: string, user: AuthUser, ip: string, periodId: string, status: "OPEN" | "CLOSED", reason?: string) {
  assertUuid(periodId, "Az időszak nem található.");
  const [p] = await tx.select().from(periods).where(and(eq(periods.companyId, companyId), eq(periods.id, periodId))).for("update");
  if (!p) throw notFound("Az időszak nem található.");
  if (p.status === status) throw conflict(status === "CLOSED" ? "Az időszak már le van zárva." : "Az időszak nyitott.");
  const [fy] = await tx.select().from(fiscalYears).where(eq(fiscalYears.id, p.fiscalYearId));
  if (fy!.status === "CLOSED") throw conflict("Lezárt üzleti év időszakai nem módosíthatók; előbb az évet kell újranyitni.");
  if (status === "CLOSED") {
    const n = await draftCounts(tx, companyId, p.startDate, p.endDate);
    if (n > 0) {
      throw conflict(`A(z) ${monthLabelHu(p.startDate)} időszakban ${n} piszkozat van. Könyvelje, törölje, vagy tegye át nyitott időszakba, mielőtt lezárja.`);
    }
  }
  await tx
    .update(periods)
    .set({ status, closedAt: status === "CLOSED" ? new Date() : null, closedBy: status === "CLOSED" ? user.id : null })
    .where(eq(periods.id, p.id));
  await writeAudit(tx, {
    companyId,
    userId: user.id,
    action: status === "CLOSED" ? "period.close" : "period.reopen",
    entityType: "period",
    entityId: p.id,
    after: { period: monthLabelHu(p.startDate), ...(reason ? { reason } : {}) },
    ip,
  });
}

export const closingModule: AppModule = {
  name: "closing",
  register(app, { db }) {
    const base = "/api/companies/:companyId";
    type PF = { Params: { companyId: string; fiscalYearId: string } };
    type PP = { Params: { companyId: string; periodId: string } };

    app.get<PF>(`${base}/fiscal-years/:fiscalYearId/closing`, async (request) => {
      const { companyId, fiscalYearId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      return closingStatus(db, companyId, fiscalYearId);
    });

    /** Havi időszak lezárása (K 5.3): utána oda könyvelni nem lehet. */
    app.post<PP>(`${base}/periods/:periodId/close`, async (request) => {
      const { companyId, periodId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "period:close");
      await db.transaction((tx) => setPeriodStatus(tx, companyId, user, request.ip, periodId, "CLOSED"));
      return { ok: true };
    });

    /** Feloldás csak Adminisztrátornak, indoklással; az audit naplóba kerül. */
    app.post<PP>(`${base}/periods/:periodId/reopen`, async (request) => {
      const { companyId, periodId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "period:reopen");
      const { reason } = parseBody(reasonSchema, request.body);
      await db.transaction((tx) => setPeriodStatus(tx, companyId, user, request.ip, periodId, "OPEN", reason));
      return { ok: true };
    });

    /** Zárlat indítása: innentől csak a mérlegfordulónapra lehet könyvelni (zárlati tételek). */
    app.post<PF>(`${base}/fiscal-years/:fiscalYearId/start-closing`, async (request) => {
      const { companyId, fiscalYearId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "period:close");
      await db.transaction(async (tx) => {
        const fy = await loadYear(tx, companyId, fiscalYearId);
        if (fy.status !== "OPEN") throw conflict("Az üzleti év már zárlati vagy lezárt állapotban van.");
        const n = await draftCounts(tx, companyId, fy.startDate, addDays(fy.endDate, -1));
        if (n > 0) throw conflict(`Az üzleti évben ${n} piszkozat van a fordulónap előtti napokra. Előbb könyvelje vagy törölje őket.`);
        await tx.update(fiscalYears).set({ status: "CLOSING" }).where(eq(fiscalYears.id, fy.id));
        await writeAudit(tx, { companyId, userId: user.id, action: "fiscal_year.start_closing", entityType: "fiscal_year", entityId: fy.id, after: { endDate: fy.endDate }, ip: request.ip });
      });
      return closingStatus(db, companyId, fiscalYearId);
    });

    /** Zárlat visszavonása (még évzárás előtt): az év újra nyitott. */
    app.post<PF>(`${base}/fiscal-years/:fiscalYearId/cancel-closing`, async (request) => {
      const { companyId, fiscalYearId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "period:close");
      await db.transaction(async (tx) => {
        const fy = await loadYear(tx, companyId, fiscalYearId);
        if (fy.status !== "CLOSING") throw conflict("Az üzleti év nincs zárlati állapotban.");
        await tx.update(fiscalYears).set({ status: "OPEN" }).where(eq(fiscalYears.id, fy.id));
        await writeAudit(tx, { companyId, userId: user.id, action: "fiscal_year.cancel_closing", entityType: "fiscal_year", entityId: fy.id, ip: request.ip });
      });
      return closingStatus(db, companyId, fiscalYearId);
    });

    /**
     * Évzárás (K 5.5): az eredményszámlák zárása a 493-on át a 419-re, az év
     * lezárása (megőrzési határidővel), a következő év nyitásakor az eredmény
     * átvezetése az eredménytartalékba. Megerősítés: a cég rövid nevének
     * begépelése.
     */
    app.post<PF>(`${base}/fiscal-years/:fiscalYearId/close`, async (request) => {
      const { companyId, fiscalYearId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "period:close");
      const { confirmName } = parseBody(closeYearSchema, request.body);
      await db
        .transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"closing:" + companyId}, 0))`);
          const fy = await loadYear(tx, companyId, fiscalYearId);
          const [company] = await tx.select({ shortName: companies.shortName }).from(companies).where(eq(companies.id, companyId));
          if (confirmName !== company!.shortName) throw validationError({ confirmName: `A megerősítéshez írja be pontosan: ${company!.shortName}` });
          if (fy.status !== "CLOSING") throw conflict("Évzárás előtt indítsa el a zárlatot (zárlati állapot).");
          const n = await draftCounts(tx, companyId, fy.startDate, fy.endDate);
          if (n > 0) throw conflict(`Az üzleti évben ${n} piszkozat van. Előbb könyvelje vagy törölje őket.`);
          const next = await nextYear(tx, companyId, fy.endDate);
          if (!next) throw conflict("Előbb hozza létre a következő üzleti évet: a nyitáskor oda kerül át az eredmény.");
          if (next.startDate !== addDays(fy.endDate, 1)) throw conflict("A következő üzleti évnek a fordulónapot követő napon kell kezdődnie.");
          const preview = await closingPreview(tx, companyId, fy);
          if (preview.missing.length) throw conflict(`Hiányoznak a zárási számlák a számlatükörből: ${preview.missing.join(", ")}.`);
          const { find } = await closingAccounts(tx, companyId);

          const zar = preview.lines.length
            ? await createSystemDocument(tx, companyId, user, request.ip, {
                docType: "ZAR",
                accountingDate: fy.endDate,
                description: `Évzárás: eredményszámlák zárása, adózott eredmény ${formatHuf(preview.result)}`,
                lines: preview.lines,
              })
            : null;
          await tx
            .update(fiscalYears)
            .set({ status: "CLOSED", closedAt: new Date(), closedBy: user.id, retentionUntil: retentionUntil(fy.endDate) })
            .where(eq(fiscalYears.id, fy.id));
          // Nyitás: az előző évi eredmény a 419-ről a 413 Eredménytartalékba (Szt. 37. § (2) a)).
          let nyit = null;
          if (preview.result !== 0) {
            const profit = preview.result > 0;
            nyit = await createSystemDocument(tx, companyId, user, request.ip, {
              docType: "NYIT",
              accountingDate: next.startDate,
              description: `Nyitás: ${fy.startDate.slice(0, 4)}. évi adózott eredmény átvezetése az eredménytartalékba`,
              lines: [
                { accountId: find(CLOSING_ACCOUNTS.result)!.id, side: profit ? "D" : "C", amount: Math.abs(preview.result) },
                { accountId: find(CLOSING_ACCOUNTS.retained)!.id, side: profit ? "C" : "D", amount: Math.abs(preview.result) },
              ],
            });
          }
          await writeAudit(tx, {
            companyId,
            userId: user.id,
            action: "fiscal_year.close",
            entityType: "fiscal_year",
            entityId: fy.id,
            after: { result: preview.result, closingDocument: zar?.serialNumber ?? null, openingDocument: nyit?.serialNumber ?? null, retentionUntil: retentionUntil(fy.endDate) },
            ip: request.ip,
          });
        })
        .catch(mapDbError);
      return closingStatus(db, companyId, fiscalYearId);
    });

    /** Év újranyitása (csak Adminisztrátor, indoklással): a záró és nyitó bizonylat sztornója. */
    app.post<PF>(`${base}/fiscal-years/:fiscalYearId/reopen`, async (request) => {
      const { companyId, fiscalYearId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "period:reopen");
      const { reason } = parseBody(reasonSchema, request.body);
      await db
        .transaction(async (tx) => {
          const fy = await loadYear(tx, companyId, fiscalYearId);
          if (fy.status !== "CLOSED") throw conflict("Az üzleti év nincs lezárva.");
          const next = await nextYear(tx, companyId, fy.endDate);
          if (next && next.status === "CLOSED") throw conflict("A következő üzleti év már lezárt; előbb azt kell újranyitni.");
          // A nyitó bizonylat sztornója a következő év első napjára, a záróé a fordulónapra (zárlati állapotban).
          for (const d of next ? await systemDocs(tx, companyId, next.id, "NYIT") : []) {
            const [doc] = await tx.select({ description: documents.description }).from(documents).where(eq(documents.id, d.id));
            if (doc?.description?.startsWith("Nyitás:")) await reverseDocument(tx, companyId, d.id, user, request.ip, { accountingDate: next!.startDate, reason: `Év újranyitása: ${reason}` });
          }
          await tx.update(fiscalYears).set({ status: "CLOSING", closedAt: null, closedBy: null }).where(eq(fiscalYears.id, fy.id));
          for (const d of await systemDocs(tx, companyId, fy.id, "ZAR")) {
            await reverseDocument(tx, companyId, d.id, user, request.ip, { accountingDate: fy.endDate, reason: `Év újranyitása: ${reason}` });
          }
          await tx.update(fiscalYears).set({ status: "OPEN" }).where(eq(fiscalYears.id, fy.id));
          await writeAudit(tx, { companyId, userId: user.id, action: "fiscal_year.reopen", entityType: "fiscal_year", entityId: fy.id, after: { reason }, ip: request.ip });
        })
        .catch(mapDbError);
      return closingStatus(db, companyId, fiscalYearId);
    });

    /**
     * Nyitó egyenlegek átvétele (meglévő cég indítása): a megadott napra egy
     * nyitó bizonylat a nem analitikás számlákkal, és nyitott tételenként egy
     * nyitó bizonylat a vevő/szállító számlákra – mind a 491 Nyitómérleg-
     * számlával szemben, amely összességében nullára jön ki.
     */
    app.post<{ Params: { companyId: string } }>(`${base}/opening-balances`, async (request, reply) => {
      const { companyId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "fiscalYear:manage");
      const input = parseBody(openingSchema, request.body);
      const result = await db
        .transaction(async (tx) => {
          const { find, all } = await closingAccounts(tx, companyId);
          const opening = find(CLOSING_ACCOUNTS.openingBalance);
          if (!opening) throw conflict("Hiányzik a 491 Nyitómérleg-számla a számlatükörből.");
          const byId = new Map(all.map((a) => [a.id, a]));
          const errors: Record<string, string> = {};
          let debit = 0;
          let credit = 0;
          input.balances.forEach((b, i) => {
            const a = byId.get(b.accountId);
            if (!a) errors[`balances.${i}`] = "Ismeretlen számla.";
            else if (a.hasChildren) errors[`balances.${i}`] = `A(z) ${a.number} gyűjtőszámla; alszámlára adja meg az egyenleget.`;
            else if (a.number.startsWith("49")) errors[`balances.${i}`] = `A(z) ${a.number} technikai számlára nem adható nyitó egyenleg.`;
            else if (b.debit && b.credit) errors[`balances.${i}`] = `A(z) ${a.number}: egy számlának csak egy oldalon lehet egyenlege.`;
            debit += b.debit;
            credit += b.credit;
          });
          if (debit !== credit) errors.balances = `A nyitó egyenlegek nem egyeznek: tartozik ${formatHuf(debit)}, követel ${formatHuf(credit)} (eltérés: ${formatHuf(Math.abs(debit - credit))}).`;
          // Vevő/szállító számlák: a nyitott tételek összege egyezzen a számla egyenlegével.
          const partnerIds = [...new Set(input.openItems.map((o) => o.partnerId))];
          const known = new Set(
            partnerIds.length ? (await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.companyId, companyId), inArray(partners.id, partnerIds)))).map((p) => p.id) : [],
          );
          for (const b of input.balances) {
            const a = byId.get(b.accountId);
            if (!a || (a.subledger !== "CUSTOMER" && a.subledger !== "SUPPLIER")) continue;
            const itemSide = a.subledger === "CUSTOMER" ? b.debit : b.credit;
            const otherSide = a.subledger === "CUSTOMER" ? b.credit : b.debit;
            const sum = input.openItems.filter((o) => o.accountId === a.id).reduce((s, o) => s + o.amount, 0);
            if (otherSide) errors[`subledger.${a.number}`] = `A(z) ${a.number} egyenlege a szokásossal ellentétes oldalon van (túlfizetés); ezt a nyitás után külön bizonylaton rögzítse.`;
            else if (sum !== itemSide) errors[`subledger.${a.number}`] = `A(z) ${a.number} nyitott tételeinek összege (${formatHuf(sum)}) nem egyezik a számla egyenlegével (${formatHuf(itemSide)}).`;
          }
          input.openItems.forEach((o, i) => {
            const a = byId.get(o.accountId);
            if (!a || (a.subledger !== "CUSTOMER" && a.subledger !== "SUPPLIER")) errors[`openItems.${i}`] = "Nyitott tétel csak vevő- vagy szállítószámlára adható meg.";
            else if (!input.balances.some((b) => b.accountId === o.accountId)) errors[`openItems.${i}`] = `A(z) ${a.number} számlának nincs nyitó egyenlege.`;
            else if (!known.has(o.partnerId)) errors[`openItems.${i}`] = "Ismeretlen partner.";
          });
          if (Object.keys(errors).length) throw validationError(errors, "A nyitó egyenlegek nem rögzíthetők. Kérjük, javítsa a jelzett hibákat.");

          const general = input.balances.filter((b) => {
            const sub = byId.get(b.accountId)?.subledger;
            return sub !== "CUSTOMER" && sub !== "SUPPLIER";
          });
          const net = general.reduce((s, b) => s + b.debit - b.credit, 0);
          const created: string[] = [];
          if (general.length) {
            const lines = general.map((b) => ({ accountId: b.accountId, side: (b.debit ? "D" : "C") as "D" | "C", amount: b.debit || b.credit }));
            if (net !== 0) lines.push({ accountId: opening.id, side: net > 0 ? "C" : "D", amount: Math.abs(net) });
            const doc = await createSystemDocument(tx, companyId, user, request.ip, {
              docType: "NYIT",
              accountingDate: input.date,
              description: `Nyitó egyenlegek átvétele (${formatDateHu(input.date)}, főkönyvi kivonat alapján)`,
              lines,
            });
            created.push(doc.serialNumber!);
          }
          for (const o of input.openItems) {
            const a = byId.get(o.accountId)!;
            const side = lineRole(a.subledger, "D") === "ITEM" ? "D" : "C";
            const doc = await createSystemDocument(tx, companyId, user, request.ip, {
              docType: "NYIT",
              accountingDate: input.date,
              description: `Nyitó tétel: ${o.externalNumber}`,
              partnerId: o.partnerId,
              externalNumber: o.externalNumber,
              dueDate: o.dueDate,
              lines: [
                { accountId: a.id, side, amount: o.amount, partnerId: o.partnerId },
                { accountId: opening.id, side: side === "D" ? "C" : "D", amount: o.amount },
              ],
            });
            created.push(doc.serialNumber!);
          }
          await writeAudit(tx, {
            companyId,
            userId: user.id,
            action: "opening.import",
            entityType: "document",
            entityId: null,
            after: { date: input.date, accounts: input.balances.length, openItems: input.openItems.length, documents: created.length, total: debit },
            ip: request.ip,
          });
          return created;
        })
        .catch(mapDbError);
      return reply.code(201).send({ documents: result });
    });
  },
};

