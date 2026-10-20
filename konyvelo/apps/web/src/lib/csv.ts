/**
 * CSV-letöltés a magyar Excel számára: pontosvessző elválasztó, tizedesvessző,
 * UTF-8 BOM (hogy az ékezetek jól jelenjenek meg).
 */
export function csvAmount(filler: number): string {
  const v = filler / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",");
}

export function downloadCsv(fileName: string, rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): void {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = "﻿" + rows.map((r) => r.map(esc).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
