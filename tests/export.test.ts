import { describe, expect, it } from "vitest";
import { buildInvoicesCsv, buildInvoicesXlsx, type ExportInvoiceRow } from "@/lib/export";

const sampleRow: ExportInvoiceRow = {
  issueDate: new Date("2026-08-15T00:00:00Z"),
  dueDate: new Date("2026-08-29T00:00:00Z"),
  direction: "EXPENSE",
  partnerNameRaw: "Teszt Kft.",
  partnerTaxNumber: "12345678-1-42",
  categoryName: "Iroda",
  netAmount: "10000.50",
  vatAmount: "2700.14",
  vatRate: "27",
  grossAmount: "12700.64",
  currency: "HUF",
  status: "CONFIRMED",
  fileName: "szamla.pdf",
};

describe("CSV export", () => {
  it("könyvelőbarát fejlécet ír, pontosvesszővel elválasztva", () => {
    const csv = buildInvoicesCsv([sampleRow]);
    const firstLine = csv.replace(/^﻿/, "").split("\r\n")[0];
    expect(firstLine).toBe(
      "Számla kelte;Fizetési határidő;Irány;Partner neve;Partner adószáma;Kategória;Nettó;ÁFA;ÁFA kulcs (%);Bruttó;Pénznem;Státusz;Fájlnév"
    );
  });

  it("a magyar Excel-konvenció szerint vesszőt használ tizedesjelként", () => {
    const csv = buildInvoicesCsv([sampleRow]);
    const dataLine = csv.split("\r\n")[1];
    expect(dataLine).toContain("12700,64");
    expect(dataLine).not.toContain("12700.64");
  });

  it("UTF-8 BOM-mal kezdődik az Excel-kompatibilitáshoz", () => {
    const csv = buildInvoicesCsv([sampleRow]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("üres listára csak a fejlécsort adja vissza", () => {
    const csv = buildInvoicesCsv([]);
    expect(csv.replace(/^﻿/, "").split("\r\n")).toHaveLength(1);
  });
});

describe("XLSX export", () => {
  it("érvényes, nem üres buffert ad vissza", () => {
    const buffer = buildInvoicesXlsx([sampleRow]);
    expect(buffer.length).toBeGreaterThan(0);
    // XLSX (zip) fájlok "PK" magic byte-okkal kezdődnek
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });
});
