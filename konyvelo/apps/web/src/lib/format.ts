import { formatDateHu, monthLabelHu } from "@konyvelo/domain";

export { formatDateHu };

/** Időbélyeg magyar formában, helyi idő szerint: "2026.10.20. 14:05" */
export function formatDateTimeHu(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}. ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Üzleti év rövid megnevezése: "2026" vagy "2026.07.01.–2027.06.30." */
export function fiscalYearLabel(fy: { startDate: string; endDate: string }): string {
  if (fy.startDate.endsWith("-01-01") && fy.endDate.endsWith("-12-31") && fy.startDate.slice(0, 4) === fy.endDate.slice(0, 4)) {
    return fy.startDate.slice(0, 4);
  }
  return `${formatDateHu(fy.startDate)}–${formatDateHu(fy.endDate)}`;
}

export function periodLabel(p: { startDate: string; endDate: string }): string {
  return monthLabelHu(p.startDate);
}
