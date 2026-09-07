import * as XLSX from "xlsx";
import { invoiceDirectionLabels, invoiceStatusLabels } from "@/lib/format";

export type ExportInvoiceRow = {
  issueDate: Date | null;
  dueDate: Date | null;
  direction: string;
  partnerNameRaw: string | null;
  partnerTaxNumber: string | null;
  categoryName: string | null;
  netAmount: unknown;
  vatAmount: unknown;
  vatRate: unknown;
  grossAmount: unknown;
  currency: string;
  status: string;
  fileName: string;
};

const HEADERS = [
  "Számla kelte",
  "Fizetési határidő",
  "Irány",
  "Partner neve",
  "Partner adószáma",
  "Kategória",
  "Nettó",
  "ÁFA",
  "ÁFA kulcs (%)",
  "Bruttó",
  "Pénznem",
  "Státusz",
  "Fájlnév",
];

/** Melyik oszlopok tartalmaznak számot (0-indexelve) — ezekre kell a
 * CSV-ben a magyar tizedesvessző-konverzió, az XLSX-ben pedig valódi
 * szám típus, hogy Excelben összegezhetők legyenek. */
const NUMERIC_COLUMN_INDEXES = [6, 7, 8, 9];

function dateStr(d: Date | null): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

function toNumberOrEmpty(v: unknown): number | "" {
  if (v === null || v === undefined) return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : "";
}

function toRowArray(inv: ExportInvoiceRow): (string | number)[] {
  return [
    dateStr(inv.issueDate),
    dateStr(inv.dueDate),
    invoiceDirectionLabels[inv.direction] ?? inv.direction,
    inv.partnerNameRaw ?? "",
    inv.partnerTaxNumber ?? "",
    inv.categoryName ?? "",
    toNumberOrEmpty(inv.netAmount),
    toNumberOrEmpty(inv.vatAmount),
    toNumberOrEmpty(inv.vatRate),
    toNumberOrEmpty(inv.grossAmount),
    inv.currency,
    invoiceStatusLabels[inv.status] ?? inv.status,
    inv.fileName,
  ];
}

/** Könyvelőbarát oszlopszerkezetű .xlsx export buffer — a számoszlopok
 * valódi szám típusúak, így Excelben közvetlenül összegezhetők. */
export function buildInvoicesXlsx(invoices: ExportInvoiceRow[]): Buffer {
  const rows = [HEADERS, ...invoices.map(toRowArray)];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = [
    { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 28 }, { wch: 16 },
    { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
    { wch: 8 }, { wch: 16 }, { wch: 28 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Bizonylatok");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function csvEscape(value: string): string {
  if (value.includes(";") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Pontosvesszővel elválasztott CSV, magyar Excel-lokalizációhoz igazítva
 * (a magyar Excel a vesszőt tizedesjelként, a pontosvesszőt oszlopelválasztóként
 * várja). UTF-8 BOM-mal, hogy az ékezetek Excelben is helyesen jelenjenek meg.
 */
export function buildInvoicesCsv(invoices: ExportInvoiceRow[]): string {
  const rows = [HEADERS, ...invoices.map(toRowArray)];
  const csvBody = rows
    .map((row) =>
      row
        .map((cell, index) => {
          if (typeof cell === "number") {
            const asString = NUMERIC_COLUMN_INDEXES.includes(index)
              ? String(cell).replace(".", ",")
              : String(cell);
            return csvEscape(asString);
          }
          return csvEscape(cell);
        })
        .join(";")
    )
    .join("\r\n");
  return "﻿" + csvBody;
}
