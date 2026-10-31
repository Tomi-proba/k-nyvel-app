import { sql } from "drizzle-orm";
import { formatHuf } from "@konyvelo/domain";
import type { InboundResult } from "@konyvelo/esemenyek";
import type { Executor, Tx } from "../../core/db";
import { openTodo, resolveTodo } from "./todos";

/**
 * Az eÁFA-ban beküldött áfabevallások (TERV.md F17.2, KE3). A Könyvelő ezekből figyelmeztet, ha egy áfás bizonylat
 * könyvelése ilyen időszakba esik; az utólagos változásokról az eÁFA gyűjtő Teendőt küld („önellenőrzés szükséges
 * lehet”), ami itt is megjelenik, és rendeződéskor lezárul. A program magától semmit nem könyvel át.
 */

export type VatPeriod = { start: string; end: string; kind: string; submittedAt: string };

export async function vatPeriods(db: Executor, companyId: string): Promise<VatPeriod[]> {
  const r = await db.execute<{ period_start: string; period_end: string; last_kind: string; submitted_at: Date }>(
    sql`SELECT period_start::text, period_end::text, last_kind, submitted_at FROM integration_vat_periods WHERE company_id = ${companyId} ORDER BY period_start`,
  );
  return r.rows.map((p) => ({ start: p.period_start, end: p.period_end, kind: p.last_kind, submittedAt: new Date(p.submitted_at).toISOString() }));
}

/** Ha a bizonylat áfás (466/467 sor) és valamelyik dátuma beküldött áfaidőszakba esik: a figyelmeztetés szövege. */
export async function submittedVatWarning(db: Executor, companyId: string, documentId: string): Promise<string | null> {
  const r = await db.execute<{ period_start: string; period_end: string }>(sql`
    SELECT p.period_start::text, p.period_end::text FROM documents d
      JOIN integration_vat_periods p ON p.company_id = d.company_id
       AND (coalesce(d.fulfillment_date, d.accounting_date) BETWEEN p.period_start AND p.period_end OR d.accounting_date BETWEEN p.period_start AND p.period_end)
     WHERE d.id = ${documentId} AND d.company_id = ${companyId}
       AND EXISTS (SELECT 1 FROM journal_lines l JOIN accounts a ON a.id = l.account_id
                    WHERE l.document_id = d.id AND (a.number LIKE '466%' OR a.number LIKE '467%'))
     ORDER BY p.period_start LIMIT 1`);
  const p = r.rows[0];
  if (!p) return null;
  return `Ez az áfás bizonylat a ${p.period_start} – ${p.period_end} közötti, az eÁFA-ban már beküldött áfabevallás időszakába esik: ott önellenőrzés lehet szükséges.`;
}

type Submitted = { declarationId: string; periodStart: string; periodEnd: string; frequency: string; kind: string; submittedAt: string };

export async function vatSubmitted(tx: Tx, companyId: string, p: Submitted): Promise<InboundResult> {
  await tx.execute(sql`
    INSERT INTO integration_vat_periods (company_id, period_start, period_end, frequency, last_kind, submitted_at, declaration_id)
    VALUES (${companyId}, ${p.periodStart}::date, ${p.periodEnd}::date, ${p.frequency}, ${p.kind}, ${p.submittedAt}::timestamptz, ${p.declarationId})
    ON CONFLICT (company_id, period_start) DO UPDATE SET period_end = EXCLUDED.period_end, frequency = EXCLUDED.frequency,
      last_kind = EXCLUDED.last_kind, submitted_at = EXCLUDED.submitted_at, declaration_id = EXCLUDED.declaration_id`);
  return { outcome: "APPLIED" };
}

type LaterChange = { periodStart: string; periodEnd: string; status: "OPEN" | "RESOLVED"; changes: number; outputVatEffect: number; inputVatEffect: number; resolution: string | null; note: string | null };

export async function vatLaterChange(tx: Tx, companyId: string, p: LaterChange): Promise<InboundResult> {
  const key = `afa-utolagos:${p.periodStart}`;
  if (p.status === "RESOLVED") {
    await resolveTodo(tx, companyId, key, null);
    return { outcome: "APPLIED" };
  }
  const net = p.outputVatEffect - p.inputVatEffect;
  await openTodo(tx, companyId, {
    key,
    kind: "VAT_SELF_CHECK",
    title: `A ${p.periodStart} – ${p.periodEnd} közötti, már beküldött áfabevallást ${p.changes} utólagos változás érinti (nettó áfahatás: ${formatHuf(net)}): az eÁFA-ban önellenőrzés szükséges lehet.`,
    detail: `Fizetendő áfa: ${formatHuf(p.outputVatEffect)}, levonható áfa: ${formatHuf(p.inputVatEffect)}. A beküldött bevallás nem változik magától; az eÁFA-ban dönthet: önellenőrzés, vagy indoklással „nem kell”.`,
  });
  return { outcome: "APPLIED" };
}
