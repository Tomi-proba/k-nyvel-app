import type { ReportCompany } from "@konyvelo/shared";
import { downloadCsv } from "./csv";

/**
 * Kimutatás exportja egy közös leírásból: CSV (egyszerű, bármilyen
 * táblázatkezelőbe) és formázott Excel (.xlsx: fejléc, ezres tagolás,
 * kiemelt összesítő sorok, rögzített fejlécsor, nyomtatási beállítás).
 * A számok forintban (vagy ezer forintban) értendők, már átváltva.
 */
export type ExportColumn = { header: string; numeric?: boolean; width?: number };
export type ExportRow = { cells: Array<string | number | null>; kind?: "subtotal" | "total" };
export type ExportSpec = {
  fileName: string;
  title: string;
  company: ReportCompany;
  period: string;
  notice?: string | null;
  footer?: string | null;
  /** Aláírási hely (mérleg, eredménykimutatás). */
  signature?: boolean;
  landscape?: boolean;
  columns: ExportColumn[];
  rows: ExportRow[];
};

/** Fillér → forint (a táblázatban számként). */
export const ftValue = (filler: number) => filler / 100;

function companyLines(c: ReportCompany): string[] {
  return [c.name, `Adószám: ${c.taxNumber}${c.registrationNumber ? ` · Cégjegyzékszám: ${c.registrationNumber}` : ""}`, ...(c.address ? [c.address] : [])];
}

export function exportCsv(spec: ExportSpec): void {
  const num = (v: string | number | null) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",")) : v);
  downloadCsv(`${spec.fileName}.csv`, [
    ...companyLines(spec.company).map((l) => [l]),
    [spec.title],
    [spec.period],
    ...(spec.notice ? [[spec.notice]] : []),
    [],
    spec.columns.map((c) => c.header),
    ...spec.rows.map((r) => r.cells.map(num)),
    ...(spec.footer ? [[], [spec.footer]] : []),
  ]);
}

export async function exportXlsx(spec: ExportSpec): Promise<void> {
  // Csak letöltéskor töltjük be (nagy könyvtár), így a program indulását nem lassítja.
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Könyvelő";
  wb.created = new Date();
  const ws = wb.addWorksheet(spec.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "), {
    pageSetup: { paperSize: 9, orientation: spec.landscape ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
    headerFooter: { oddFooter: "&L&8" + spec.company.name + "&R&8&P / &N" },
  });
  const n = spec.columns.length;
  const allInteger = spec.rows.every((r) => r.cells.every((v) => typeof v !== "number" || Number.isInteger(v)));
  const numFmt = allInteger ? "#,##0" : "#,##0.00";

  companyLines(spec.company).forEach((l, i) => {
    const row = ws.addRow([l]);
    if (i === 0) row.font = { bold: true };
  });
  ws.addRow([]);
  const title = ws.addRow([spec.title]);
  title.font = { bold: true, size: 14 };
  ws.mergeCells(title.number, 1, title.number, n);
  title.alignment = { horizontal: "center" };
  const period = ws.addRow([spec.period]);
  ws.mergeCells(period.number, 1, period.number, n);
  period.alignment = { horizontal: "center" };
  if (spec.notice) {
    const notice = ws.addRow([spec.notice]);
    ws.mergeCells(notice.number, 1, notice.number, n);
    notice.font = { bold: true };
    notice.alignment = { horizontal: "center" };
  }
  ws.addRow([]);

  const header = ws.addRow(spec.columns.map((c) => c.header));
  header.font = { bold: true };
  header.alignment = { vertical: "middle", wrapText: true };
  header.eachCell((cell, col) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7EAF0" } };
    cell.border = { bottom: { style: "thin" } };
    if (spec.columns[col - 1]?.numeric) cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
  });
  ws.views = [{ state: "frozen", ySplit: header.number }];

  for (const r of spec.rows) {
    const row = ws.addRow(r.cells.map((v) => (v === null ? null : v)));
    spec.columns.forEach((c, i) => {
      if (c.numeric) row.getCell(i + 1).numFmt = numFmt;
    });
    if (r.kind) {
      row.font = { bold: true };
      for (let i = 1; i <= n; i++) {
        const cell = row.getCell(i);
        if (r.kind === "subtotal") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F7" } };
        else cell.border = { top: { style: "thin" }, bottom: { style: "double" } };
      }
    }
  }
  spec.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width ?? (c.numeric ? 16 : 30);
  });

  if (spec.footer) {
    ws.addRow([]);
    ws.addRow([spec.footer]).font = { italic: true };
  }
  if (spec.signature) {
    ws.addRow([]);
    ws.addRow([]);
    const sig = ws.addRow(["Kelt: ……………………, ………… év …… hó …… nap"]);
    sig.getCell(n).value = spec.company.representativeName ?? "………………………………";
    sig.getCell(n).alignment = { horizontal: "center" };
    sig.getCell(n).border = { top: { style: "thin" } };
    const role = ws.addRow([]);
    role.getCell(n).value = "a vállalkozás képviselője";
    role.getCell(n).alignment = { horizontal: "center" };
  }

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${spec.fileName}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
