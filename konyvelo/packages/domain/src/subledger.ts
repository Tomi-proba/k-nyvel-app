import type { NormalSide, Subledger } from "./accounts";
import { formatHuf, type Filler } from "./money";
import type { IsoDate } from "./dates";

/**
 * Vevő- és szállítóanalitika, pénzeszközök (PLAN 4.6–4.7).
 *
 * Nyitott tétel: vevőanalitikás számlán a tartozik, szállítóanalitikás
 * számlán a követel oldali sor (a számla). Kiegyenlítő tétel: az ellenkező
 * oldali sor (fizetés, jóváírás, beszámítás, leírás). A nyitott összeg az
 * eredeti összeg és a hozzá párosított kiegyenlítések különbsége – mindig
 * számolt érték (Szt. 65. § (6)–(7), K 4.4).
 */

export type LineRole = "ITEM" | "PAYMENT";
export type OpenItemKind = "RECEIVABLE" | "PAYABLE";

export function lineRole(subledger: Subledger, side: NormalSide): LineRole | null {
  if (subledger === "CUSTOMER") return side === "D" ? "ITEM" : "PAYMENT";
  if (subledger === "SUPPLIER") return side === "C" ? "ITEM" : "PAYMENT";
  return null;
}

export function itemKind(subledger: Subledger): OpenItemKind | null {
  return subledger === "CUSTOMER" ? "RECEIVABLE" : subledger === "SUPPLIER" ? "PAYABLE" : null;
}

export const OPEN_ITEM_KIND_LABELS: Record<OpenItemKind, string> = { RECEIVABLE: "Vevőkövetelés", PAYABLE: "Szállítói tartozás" };

// ---------- Korosítás ----------

export type AgingBucket = "NOT_DUE" | "D1_30" | "D31_60" | "D61_90" | "D90_PLUS";
export const AGING_BUCKETS: readonly AgingBucket[] = ["NOT_DUE", "D1_30", "D31_60", "D61_90", "D90_PLUS"];
export const AGING_LABELS: Record<AgingBucket, string> = {
  NOT_DUE: "Nem lejárt",
  D1_30: "1–30 napja lejárt",
  D31_60: "31–60 napja",
  D61_90: "61–90 napja",
  D90_PLUS: "90 napon túl",
};

/** Napok száma a-tól b-ig (b − a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function agingBucket(dueDate: IsoDate, asOf: IsoDate): AgingBucket {
  const late = daysBetween(dueDate, asOf);
  if (late <= 0) return "NOT_DUE";
  if (late <= 30) return "D1_30";
  if (late <= 60) return "D31_60";
  if (late <= 90) return "D61_90";
  return "D90_PLUS";
}

// ---------- Kiegyenlítés rögzítéskor ----------

export type PlanLine = { accountId: string | null; side: NormalSide | null; amount: Filler | null };
export type PlanItem = { lineId: string; accountId: string; accountNumber: string; partnerId: string | null; open: Filler; label: string };

/**
 * A bizonylaton kiválasztott kiegyenlítések ellenőrzése: a tétel a
 * bizonylat partneréé, nem egyenlíthető ki többször, mint a nyitott összege,
 * és számlánként a kiegyenlítések összege nem haladhatja meg a bizonylat
 * kiegyenlítő oldali sorainak összegét.
 */
export function validateSettlementPlan(
  plan: ReadonlyArray<{ itemLineId: string; amount: Filler }>,
  lines: readonly PlanLine[],
  itemOf: (lineId: string) => PlanItem | undefined,
  subledgerOf: (accountId: string) => Subledger | undefined,
  partnerId: string | null,
): Record<string, string> {
  const e: Record<string, string> = {};
  const perAccount = new Map<string, Filler>();
  const seen = new Set<string>();
  plan.forEach((p, i) => {
    const item = itemOf(p.itemLineId);
    if (!item) return void (e[`settlements.${i}`] = "A kiválasztott tétel már nem nyitott, vagy nem található.");
    if (seen.has(p.itemLineId)) return void (e[`settlements.${i}`] = `${item.label}: kétszer választotta ki.`);
    seen.add(p.itemLineId);
    if (item.partnerId !== partnerId) return void (e[`settlements.${i}`] = `${item.label}: másik partner tétele.`);
    if (!(p.amount > 0)) return void (e[`settlements.${i}`] = `${item.label}: adjon meg pozitív összeget.`);
    if (p.amount > item.open) return void (e[`settlements.${i}`] = `${item.label}: legfeljebb a nyitott összeg (${formatHuf(item.open)}) egyenlíthető ki.`);
    perAccount.set(item.accountId, (perAccount.get(item.accountId) ?? 0) + p.amount);
  });
  for (const [accountId, sum] of perAccount) {
    const sub = subledgerOf(accountId);
    const capacity = lines
      .filter((l) => l.accountId === accountId && l.side && sub && lineRole(sub, l.side) === "PAYMENT")
      .reduce((s, l) => s + (l.amount ?? 0), 0);
    if (sum > capacity) {
      const number = plan.map((p) => itemOf(p.itemLineId)).find((it) => it?.accountId === accountId)?.accountNumber ?? "";
      e.settlements = `A kiválasztott tételek összege (${formatHuf(sum)}) több, mint a bizonylaton a ${number} számla kiegyenlítő oldalán lévő összeg (${formatHuf(capacity)}).`;
    }
  }
  return e;
}

/**
 * A terv szétosztása a bizonylat kiegyenlítő sorai között (számlánként,
 * sorrendben): [{ itemLineId, settlingLineId, amount }].
 */
export function allocateSettlements<L extends { id: string; accountId: string | null; side: NormalSide | null; amount: Filler }>(
  plan: ReadonlyArray<{ itemLineId: string; amount: Filler }>,
  lines: readonly L[],
  itemAccountOf: (lineId: string) => string | undefined,
  subledgerOf: (accountId: string) => Subledger | undefined,
): Array<{ itemLineId: string; settlingLineId: string; amount: Filler }> {
  const capacity = new Map(
    lines
      .filter((l) => l.accountId && l.side && lineRole(subledgerOf(l.accountId) ?? "NONE", l.side) === "PAYMENT")
      .map((l) => [l.id, l.amount] as const),
  );
  const out: Array<{ itemLineId: string; settlingLineId: string; amount: Filler }> = [];
  for (const p of plan) {
    let rest = p.amount;
    const account = itemAccountOf(p.itemLineId);
    for (const l of lines) {
      if (rest <= 0) break;
      const cap = capacity.get(l.id) ?? 0;
      if (l.accountId !== account || cap <= 0) continue;
      const take = Math.min(cap, rest);
      out.push({ itemLineId: p.itemLineId, settlingLineId: l.id, amount: take });
      capacity.set(l.id, cap - take);
      rest -= take;
    }
  }
  return out;
}

// ---------- Pénztár, bank ----------

export type MoneyRow = { date: IsoDate; debit: Filler; credit: Filler };

/** Napi záróegyenlegek a nyitó egyenlegből és a mozgásokból (dátum szerint rendezve). */
export function dailyClosings(opening: Filler, rows: readonly MoneyRow[]): Array<{ date: IsoDate; closing: Filler }> {
  const out: Array<{ date: IsoDate; closing: Filler }> = [];
  let bal = opening;
  for (const r of rows) {
    bal += r.debit - r.credit;
    const last = out.at(-1);
    if (last && last.date === r.date) last.closing = bal;
    else out.push({ date: r.date, closing: bal });
  }
  return out;
}
