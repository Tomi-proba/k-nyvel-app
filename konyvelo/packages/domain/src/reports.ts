import { BALANCE_SHEET_LINES, INCOME_STATEMENT_LINES, INCOME_STATEMENT_REVENUE_LINES, type ReportLine } from "./report-lines";
import type { Filler } from "./money";

/**
 * Kimutatások összeállítása a számlák forgalmából (PLAN 4.10).
 *
 * Mérleg („A” változat): a számla egyenlege a tartozik vagy követel
 * egyenleghez rendelt mérlegsorra kerül; eszközsoron tartozik − követel,
 * forrássoron követel − tartozik az érték (így az eszköz-ellenszámlák,
 * pl. értékcsökkenés, csökkentik az eszközt). A tárgyévi, még le nem zárt
 * eredmény a D.VII Adózott eredmény, a korábbi le nem zárt éveké a D.IV
 * Eredménytartalék sorra kerül.
 *
 * Eredménykimutatás (összköltség-eljárás): bevétel jellegű soron
 * követel − tartozik, ráfordítás jellegűn tartozik − követel forgalom; az
 * A–D sorok számítottak.
 */

export type AccountTurnover = {
  number: string;
  name: string;
  debit: Filler;
  credit: Filler;
  bsLineDebit: string | null;
  bsLineCredit: string | null;
  isLine: string | null;
};

export type StatementLine = { code: string; label: string; depth: number; simplified: boolean; ofWhich: boolean; formula: boolean; value: Filler };

/** Melyik számla kerül a mérlegbe, illetve az eredménykimutatásba (Szt. 160. § (2)–(3)). */
const inBalanceSheet = (n: string) => "1234".includes(n[0]!) && !n.startsWith("49");
const inIncomeStatement = (n: string) => "589".includes(n[0]!);

function addWithAncestors(values: Map<string, Filler>, lines: readonly ReportLine[], code: string, amount: Filler) {
  let current: string | null = code;
  while (current) {
    values.set(current, (values.get(current) ?? 0) + amount);
    current = lines.find((l) => l.code === current)?.parent ?? null;
  }
}

const depthOf = (code: string) => code.split(".").length - 1;

export function buildIncomeStatement(accounts: readonly AccountTurnover[]) {
  const values = new Map<string, Filler>();
  const unmapped: Array<{ number: string; name: string; amount: Filler }> = [];
  for (const a of accounts) {
    if (!inIncomeStatement(a.number) || a.debit === a.credit) continue;
    if (!a.isLine) {
      if (!a.number.startsWith("59")) unmapped.push({ number: a.number, name: a.name, amount: a.debit - a.credit });
      continue;
    }
    const top = a.isLine.split(".")[0]!;
    addWithAncestors(values, INCOME_STATEMENT_LINES, a.isLine, INCOME_STATEMENT_REVENUE_LINES.has(top) ? a.credit - a.debit : a.debit - a.credit);
  }
  for (const l of INCOME_STATEMENT_LINES) {
    if (l.formula) values.set(l.code, l.formula.reduce((s, f) => s + f.sign * (values.get(f.code) ?? 0), 0));
  }
  const lines: StatementLine[] = INCOME_STATEMENT_LINES.map((l) => ({
    code: l.code,
    label: l.label,
    depth: depthOf(l.code),
    simplified: l.simplified || Boolean(l.formula),
    ofWhich: Boolean(l.ofWhich),
    formula: Boolean(l.formula),
    value: values.get(l.code) ?? 0,
  }));
  return { lines, result: values.get("D") ?? 0, unmapped };
}

/**
 * @param currentYearResult a tárgyév még le nem zárt eredménye (D.VII)
 * @param priorYearsResult a korábbi, még le nem zárt üzleti évek eredménye (D.IV Eredménytartalék); az évzárás után 0
 */
export function buildBalanceSheet(accounts: readonly AccountTurnover[], currentYearResult: Filler, priorYearsResult: Filler = 0) {
  const values = new Map<string, Filler>();
  const unmapped: Array<{ number: string; name: string; amount: Filler }> = [];
  for (const a of accounts) {
    if (!inBalanceSheet(a.number)) continue;
    const balance = a.debit - a.credit;
    if (balance === 0) continue;
    const code = balance > 0 ? a.bsLineDebit : a.bsLineCredit;
    const line = code ? BALANCE_SHEET_LINES.find((l) => l.code === code) : undefined;
    if (!line) {
      unmapped.push({ number: a.number, name: a.name, amount: balance });
      continue;
    }
    addWithAncestors(values, BALANCE_SHEET_LINES, line.code, line.side === "ASSET" ? balance : -balance);
  }
  if (currentYearResult !== 0) addWithAncestors(values, BALANCE_SHEET_LINES, "D.VII", currentYearResult);
  if (priorYearsResult !== 0) addWithAncestors(values, BALANCE_SHEET_LINES, "D.IV", priorYearsResult);
  const lines: StatementLine[] = BALANCE_SHEET_LINES.map((l) => ({
    code: l.code,
    label: l.label,
    depth: depthOf(l.code),
    simplified: l.simplified,
    ofWhich: Boolean(l.ofWhich),
    formula: false,
    value: values.get(l.code) ?? 0,
  }));
  const sum = (codes: string[]) => codes.reduce((s, c) => s + (values.get(c) ?? 0), 0);
  return { lines, assets: sum(["A", "B", "C"]), sources: sum(["D", "E", "F", "G"]), unmapped };
}

/** Ezer forintra kerekítés (fillérből): 0,5 felfelé, előjelhelyesen. */
export function toThousandHuf(filler: Filler): number {
  const ft = filler / 100;
  return Math.sign(ft) * Math.round(Math.abs(ft) / 1000);
}
