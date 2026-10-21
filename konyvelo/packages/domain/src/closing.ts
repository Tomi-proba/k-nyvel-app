import { parseDateHu, type IsoDate } from "./dates";
import { parseHufInput, type Filler } from "./money";
import type { NormalSide } from "./accounts";

/**
 * Zárás és nyitás (PLAN 4.9).
 *
 * Évzárás (Szt. 164. § (1) – a számlák technikai lezárása): az eredmény-
 * számlák (5–9. osztály) egyenlegét a 493 Adózott eredmény elszámolási
 * számlára vezetjük, onnan az eredményt a 419 Adózott eredmény számlára. A
 * mérlegszámlák egyenlege folyamatosan áthúzódik a következő évre; az új év
 * nyitásakor az előző évi eredmény a 419-ről a 413 Eredménytartalékba kerül
 * (Szt. 15. § (6) folytonosság, 37. § (2) a)).
 */

export const CLOSING_ACCOUNTS = { resultClearing: "493", result: "419", retained: "413", openingBalance: "491" } as const;

/** Eredményszámla az évzáráshoz: 5–9. számlaosztály. */
export const isResultAccount = (number: string) => "56789".includes(number[0]!);

export type ClosingLine = { accountId: string; side: NormalSide; amount: Filler };

/**
 * A záró bizonylat sorai. A result pozitív, ha nyereség (követel egyenleg).
 */
export function buildClosingLines(
  balances: ReadonlyArray<{ accountId: string; number: string; debit: Filler; credit: Filler }>,
  accounts: { clearingId: string; resultId: string },
): { lines: ClosingLine[]; result: Filler } {
  const lines: ClosingLine[] = [];
  let total = 0; // tartozik − követel az eredményszámlákon
  for (const b of balances) {
    if (!isResultAccount(b.number)) continue;
    const bal = b.debit - b.credit;
    if (bal === 0) continue;
    total += bal;
    lines.push({ accountId: b.accountId, side: bal > 0 ? "C" : "D", amount: Math.abs(bal) });
  }
  if (total !== 0) {
    const toClearing: NormalSide = total > 0 ? "D" : "C";
    const back: NormalSide = toClearing === "D" ? "C" : "D";
    lines.push({ accountId: accounts.clearingId, side: toClearing, amount: Math.abs(total) });
    lines.push({ accountId: accounts.clearingId, side: back, amount: Math.abs(total) });
    lines.push({ accountId: accounts.resultId, side: toClearing, amount: Math.abs(total) });
  }
  return { lines, result: -total };
}

/** Megőrzési idő (Szt. 169. §): óvatosan az üzleti év vége utáni 8. naptári év vége. */
export function retentionUntil(fiscalYearEnd: IsoDate): IsoDate {
  return `${Number(fiscalYearEnd.slice(0, 4)) + 8}-12-31`;
}

// ---------- Nyitó egyenlegek beillesztése (Excelből, főkönyvi kivonatból) ----------

export type PastedBalance = { line: number; number: string; debit: Filler; credit: Filler; error?: string };

const splitRow = (row: string) => row.split(/\t|;/).map((c) => c.trim());
const amount = (s: string | undefined): Filler | null => {
  if (!s) return 0;
  const r = parseHufInput(s);
  return r.ok ? r.value : null;
};

/**
 * Beillesztett főkönyvi kivonat: soronként számlaszám, (megnevezés),
 * tartozik, követel – tabulátorral (Excelből másolva) vagy pontosvesszővel
 * elválasztva. A fejléc- és üres sorokat kihagyja; a negatív összeget a másik
 * oldalra teszi.
 */
export function parseBalancePaste(text: string): PastedBalance[] {
  const out: PastedBalance[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const cells = splitRow(raw);
    if (!/^\d{1,8}$/.test(cells[0] ?? "")) return;
    const nums = cells.slice(1).filter((c, idx, arr) => idx >= arr.length - 2 || /^[-\d\s.,]*$/.test(c));
    const [d, c] = cells.length >= 4 ? [cells.at(-2), cells.at(-1)] : [nums[0], nums[1]];
    const debit = amount(d);
    const credit = amount(c);
    const row: PastedBalance = { line: i + 1, number: cells[0]!, debit: 0, credit: 0 };
    if (debit === null || credit === null) row.error = "Érvénytelen összeg.";
    else {
      const bal = debit - credit;
      row.debit = Math.max(bal, 0);
      row.credit = Math.max(-bal, 0);
    }
    if (!row.error && row.debit === 0 && row.credit === 0) return;
    out.push(row);
  });
  return out;
}

export type PastedOpenItem = { line: number; partner: string; externalNumber: string; dueDate: IsoDate | null; amount: Filler; error?: string };

/** Beillesztett nyitott tételek: partner (név vagy adószám); számlaszám; esedékesség; összeg. */
export function parseOpenItemsPaste(text: string, defaultYear?: number): PastedOpenItem[] {
  const out: PastedOpenItem[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const cells = splitRow(raw);
    if (cells.length < 4 || !cells[0]) return;
    const value = amount(cells[3]);
    const due = parseDateHu(cells[2] ?? "", defaultYear);
    if (value === null && i === 0) return; // fejléc
    const row: PastedOpenItem = { line: i + 1, partner: cells[0], externalNumber: cells[1] ?? "", dueDate: due, amount: value ?? 0 };
    if (value === null || value <= 0) row.error = "Érvénytelen vagy nem pozitív összeg.";
    else if (!due) row.error = "Érvénytelen esedékesség (ÉÉÉÉ.HH.NN.).";
    else if (!row.externalNumber) row.error = "Hiányzik a számlaszám.";
    out.push(row);
  });
  return out;
}
