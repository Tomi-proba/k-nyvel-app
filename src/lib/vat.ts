/**
 * ÁFA-számítási és havi összesítő segédfüggvények.
 * Tisztán függvényszerű logika (nincs DB/IO), így könnyen unit tesztelhető.
 */

export function roundToTwoDecimals(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Bruttó összeg nettóból és ÁFA kulcsból (pl. 27 = 27%). */
export function calculateGrossFromNet(net: number, vatRatePercent: number): number {
  return roundToTwoDecimals(net * (1 + vatRatePercent / 100));
}

/** ÁFA összeg nettóból és ÁFA kulcsból. */
export function calculateVatFromNet(net: number, vatRatePercent: number): number {
  return roundToTwoDecimals(net * (vatRatePercent / 100));
}

/** Nettó összeg bruttóból és ÁFA kulcsból ("felülről visszaszámolva"). */
export function calculateNetFromGross(gross: number, vatRatePercent: number): number {
  return roundToTwoDecimals(gross / (1 + vatRatePercent / 100));
}

export type InvoiceLike = {
  direction: "INCOME" | "EXPENSE";
  issueDate: Date | string | null;
  netAmount: number | string | null;
  vatAmount: number | string | null;
  grossAmount: number | string | null;
};

export type MonthlySummary = {
  /** "YYYY-MM" formátumban. */
  month: string;
  incomeNet: number;
  incomeVat: number;
  incomeGross: number;
  expenseNet: number;
  expenseVat: number;
  expenseGross: number;
  /** bevétel bruttó - kiadás bruttó */
  balanceGross: number;
  /** befizetendő ÁFA becslés: fizetendő (bevétel után) - levonható (kiadás után) */
  vatBalance: number;
  invoiceCount: number;
};

function toNumber(value: number | string | null): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

function monthKey(date: Date | string | null): string | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Havi bontású bevétel/kiadás/ÁFA összesítő. Csak azokat a számlákat veszi
 * figyelembe, amelyeknek van `issueDate`-je — a még feldolgozás alatt lévő
 * (dátum nélküli) bizonylatok nem szerepelnek egyik hónapban sem, amíg a
 * user meg nem erősíti az adatokat.
 */
export function summarizeByMonth(invoices: InvoiceLike[]): MonthlySummary[] {
  const byMonth = new Map<string, MonthlySummary>();

  for (const inv of invoices) {
    const key = monthKey(inv.issueDate);
    if (!key) continue;

    let summary = byMonth.get(key);
    if (!summary) {
      summary = {
        month: key,
        incomeNet: 0,
        incomeVat: 0,
        incomeGross: 0,
        expenseNet: 0,
        expenseVat: 0,
        expenseGross: 0,
        balanceGross: 0,
        vatBalance: 0,
        invoiceCount: 0,
      };
      byMonth.set(key, summary);
    }

    const net = toNumber(inv.netAmount);
    const vat = toNumber(inv.vatAmount);
    const gross = toNumber(inv.grossAmount);

    if (inv.direction === "INCOME") {
      summary.incomeNet = roundToTwoDecimals(summary.incomeNet + net);
      summary.incomeVat = roundToTwoDecimals(summary.incomeVat + vat);
      summary.incomeGross = roundToTwoDecimals(summary.incomeGross + gross);
    } else {
      summary.expenseNet = roundToTwoDecimals(summary.expenseNet + net);
      summary.expenseVat = roundToTwoDecimals(summary.expenseVat + vat);
      summary.expenseGross = roundToTwoDecimals(summary.expenseGross + gross);
    }
    summary.invoiceCount += 1;
  }

  for (const summary of byMonth.values()) {
    summary.balanceGross = roundToTwoDecimals(summary.incomeGross - summary.expenseGross);
    summary.vatBalance = roundToTwoDecimals(summary.incomeVat - summary.expenseVat);
  }

  return Array.from(byMonth.values()).sort((a, b) => b.month.localeCompare(a.month));
}
