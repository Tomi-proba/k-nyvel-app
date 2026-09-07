const currencyFormatter = new Intl.NumberFormat("hu-HU", {
  style: "currency",
  currency: "HUF",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("hu-HU", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "—";
  return currencyFormatter.format(n);
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return dateFormatter.format(d);
}

export const invoiceStatusLabels: Record<string, string> = {
  UPLOADED: "Feltöltve",
  PROCESSING: "Feldolgozás alatt",
  NEEDS_REVIEW: "Ellenőrzésre vár",
  CONFIRMED: "Jóváhagyva",
  ERROR: "Hiba",
};

export const invoiceStatusColors: Record<string, string> = {
  UPLOADED: "bg-slate-100 text-slate-600",
  PROCESSING: "bg-blue-100 text-blue-700",
  NEEDS_REVIEW: "bg-amber-100 text-amber-700",
  CONFIRMED: "bg-emerald-100 text-emerald-700",
  ERROR: "bg-red-100 text-red-700",
};

export const invoiceDirectionLabels: Record<string, string> = {
  INCOME: "Bevétel",
  EXPENSE: "Kiadás",
};

export const HU_MONTHS = [
  "január", "február", "március", "április", "május", "június",
  "július", "augusztus", "szeptember", "október", "november", "december",
];
