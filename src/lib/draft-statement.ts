/**
 * "Tervezet pénzügyi kimutatás" — egyszerű, IO-mentes aggregációs logika.
 *
 * FONTOS, jogilag is releváns tervezési döntések (lásd a felhasználói
 * kérést, amire ez a modul épül):
 *  - Csak a `CONFIRMED` (a user által jóváhagyott) bizonylatok kerülnek be a
 *    számításba. Az OCR-ből még ellenőrzésre váró/hibás tételek nem, mert
 *    ezek adatai nem megbízhatóak — a kizárt tételek számát külön jelezzük,
 *    hogy a user tudja, a tervezet nem teljes.
 *  - A számítás NETTÓ összegeken alapul (ÁFA nélkül), mert az ÁFA
 *    gazdaságilag nem saját bevétel/kiadás, hanem az államnak beszedett/
 *    visszaigényelt összeg — egy eredménykimutatás-tervezetben ennek
 *    kihagyása szakmailag helyesebb, mint a bruttó összegek használata.
 *  - Nincs benne écs-elszámolás, időbeli elhatárolás vagy egyéb összetett
 *    számviteli logika — ez szándékos: a cél egy gyors, durva becslés, nem
 *    hivatalos könyvelés (lásd a jogi figyelmeztetést, ami minden nézethez/
 *    exporthoz társul, ahol ez a modul eredménye megjelenik).
 */

export type PeriodGranularity = "month" | "quarter" | "year";

export type PeriodOption = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

const ROMAN_QUARTER = ["I", "II", "III", "IV"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function periodKeyForDate(date: Date, granularity: PeriodGranularity): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth(); // 0-11
  if (granularity === "month") return `${y}-${pad2(m + 1)}`;
  if (granularity === "quarter") return `${y}-Q${Math.floor(m / 3) + 1}`;
  return `${y}`;
}

export function periodLabel(key: string, granularity: PeriodGranularity): string {
  if (granularity === "month") {
    const [y, m] = key.split("-");
    return `${y}. ${HU_MONTHS[Number(m) - 1]}`;
  }
  if (granularity === "quarter") {
    const [y, q] = key.split("-Q");
    return `${y}. ${ROMAN_QUARTER[Number(q) - 1]}. negyedév`;
  }
  return key;
}

export function periodRange(key: string, granularity: PeriodGranularity): { start: Date; end: Date } {
  if (granularity === "month") {
    const [y, m] = key.split("-").map(Number);
    return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
  }
  if (granularity === "quarter") {
    const [y, q] = key.split("-Q").map(Number);
    const startMonth = (q - 1) * 3;
    return { start: new Date(Date.UTC(y, startMonth, 1)), end: new Date(Date.UTC(y, startMonth + 3, 1)) };
  }
  const y = Number(key);
  return { start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y + 1, 0, 1)) };
}

// Helyi másolat (nem importáljuk a formatot, hogy a lib önmagában, DOM/Next
// nélkül is tesztelhető maradjon — a formátum-string mindkét helyen azonos).
const HU_MONTHS = [
  "január", "február", "március", "április", "május", "június",
  "július", "augusztus", "szeptember", "október", "november", "december",
];

/**
 * Az összes elérhető (adatokkal rendelkező) időszak listája, csökkenő
 * sorrendben — ebből épül fel az időszak-választó UI.
 */
export function listAvailablePeriods(dates: Date[], granularity: PeriodGranularity): PeriodOption[] {
  const seen = new Map<string, Date>();
  for (const d of dates) {
    const key = periodKeyForDate(d, granularity);
    if (!seen.has(key)) seen.set(key, d);
  }
  return Array.from(seen.keys())
    .map((key) => ({ key, label: periodLabel(key, granularity), ...periodRange(key, granularity) }))
    .sort((a, b) => b.start.getTime() - a.start.getTime());
}

export type DraftStatementInvoice = {
  status: string;
  direction: "INCOME" | "EXPENSE";
  issueDate: Date | string | null;
  netAmount: number | string | null;
  categoryName: string | null;
};

export type DraftStatementLine = {
  categoryName: string;
  net: number;
};

export type DraftIncomeStatement = {
  granularity: PeriodGranularity;
  periodKey: string;
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  incomeLines: DraftStatementLine[];
  incomeTotal: number;
  expenseLines: DraftStatementLine[];
  expenseTotal: number;
  estimatedResult: number;
  includedInvoiceCount: number;
  /** A periódusba eső, de még nem jóváhagyott (ezért kihagyott) bizonylatok száma. */
  excludedNotConfirmedCount: number;
};

function toNumber(v: number | string | null): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function toDate(v: Date | string | null): Date | null {
  if (!v) return null;
  const d = typeof v === "string" ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? null : d;
}

function groupByCategory(invoices: DraftStatementInvoice[]): DraftStatementLine[] {
  const totals = new Map<string, number>();
  for (const inv of invoices) {
    const name = inv.categoryName ?? "Kategorizálatlan";
    totals.set(name, (totals.get(name) ?? 0) + toNumber(inv.netAmount));
  }
  return Array.from(totals.entries())
    .map(([categoryName, net]) => ({ categoryName, net }))
    .sort((a, b) => b.net - a.net);
}

/**
 * Tervezet eredménykimutatás felépítése egy adott időszakra.
 */
export function buildDraftIncomeStatement(
  allInvoices: DraftStatementInvoice[],
  granularity: PeriodGranularity,
  periodKey: string
): DraftIncomeStatement {
  const { start, end } = periodRange(periodKey, granularity);

  const withinPeriod = allInvoices.filter((inv) => {
    const d = toDate(inv.issueDate);
    return d !== null && d >= start && d < end;
  });

  const confirmed = withinPeriod.filter((inv) => inv.status === "CONFIRMED");
  const income = confirmed.filter((inv) => inv.direction === "INCOME");
  const expense = confirmed.filter((inv) => inv.direction === "EXPENSE");

  const incomeLines = groupByCategory(income);
  const expenseLines = groupByCategory(expense);
  const incomeTotal = incomeLines.reduce((sum, l) => sum + l.net, 0);
  const expenseTotal = expenseLines.reduce((sum, l) => sum + l.net, 0);

  return {
    granularity,
    periodKey,
    periodLabel: periodLabel(periodKey, granularity),
    periodStart: start,
    periodEnd: end,
    incomeLines,
    incomeTotal,
    expenseLines,
    expenseTotal,
    estimatedResult: incomeTotal - expenseTotal,
    includedInvoiceCount: confirmed.length,
    excludedNotConfirmedCount: withinPeriod.length - confirmed.length,
  };
}
