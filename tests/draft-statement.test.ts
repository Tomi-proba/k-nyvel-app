import { describe, expect, it } from "vitest";
import {
  buildDraftIncomeStatement,
  listAvailablePeriods,
  periodKeyForDate,
  periodLabel,
  periodRange,
  type DraftStatementInvoice,
} from "@/lib/draft-statement";

describe("periodKeyForDate / periodLabel / periodRange", () => {
  it("hónap kulcsot és magyar címkét ad", () => {
    const d = new Date(Date.UTC(2026, 8, 15)); // 2026-09-15
    expect(periodKeyForDate(d, "month")).toBe("2026-09");
    expect(periodLabel("2026-09", "month")).toBe("2026. szeptember");
  });

  it("negyedév kulcsot és római számos címkét ad", () => {
    const d = new Date(Date.UTC(2026, 8, 15)); // Q3
    expect(periodKeyForDate(d, "quarter")).toBe("2026-Q3");
    expect(periodLabel("2026-Q3", "quarter")).toBe("2026. III. negyedév");
  });

  it("év kulcsot ad", () => {
    const d = new Date(Date.UTC(2026, 0, 1));
    expect(periodKeyForDate(d, "year")).toBe("2026");
    expect(periodLabel("2026", "year")).toBe("2026");
  });

  it("a negyedév tartomány a helyes 3 hónapot fedi le", () => {
    const { start, end } = periodRange("2026-Q1", "quarter");
    expect(start.toISOString()).toBe(new Date(Date.UTC(2026, 0, 1)).toISOString());
    expect(end.toISOString()).toBe(new Date(Date.UTC(2026, 3, 1)).toISOString());
  });

  it("az év tartomány jan 1 - dec 31 (kizárólagos vég)", () => {
    const { start, end } = periodRange("2026", "year");
    expect(start.toISOString()).toBe(new Date(Date.UTC(2026, 0, 1)).toISOString());
    expect(end.toISOString()).toBe(new Date(Date.UTC(2027, 0, 1)).toISOString());
  });
});

describe("listAvailablePeriods", () => {
  it("egyedi, csökkenő sorrendű időszakokat ad vissza", () => {
    const dates = [
      new Date(Date.UTC(2026, 7, 5)),
      new Date(Date.UTC(2026, 8, 1)),
      new Date(Date.UTC(2026, 8, 20)),
    ];
    const periods = listAvailablePeriods(dates, "month");
    expect(periods.map((p) => p.key)).toEqual(["2026-09", "2026-08"]);
  });
});

describe("buildDraftIncomeStatement", () => {
  const invoices: DraftStatementInvoice[] = [
    { status: "CONFIRMED", direction: "INCOME", issueDate: "2026-09-05", netAmount: 100000, categoryName: "Értékesítés" },
    { status: "CONFIRMED", direction: "INCOME", issueDate: "2026-09-20", netAmount: 50000, categoryName: "Értékesítés" },
    { status: "CONFIRMED", direction: "EXPENSE", issueDate: "2026-09-10", netAmount: 30000, categoryName: "Bérleti díj" },
    { status: "CONFIRMED", direction: "EXPENSE", issueDate: "2026-09-12", netAmount: 12000, categoryName: "Iroda" },
    // ellenőrzésre vár — nem kerülhet be az eredménybe
    { status: "NEEDS_REVIEW", direction: "EXPENSE", issueDate: "2026-09-15", netAmount: 99999, categoryName: "Egyéb" },
    // másik hónap — nem tartozik a szeptemberi időszakhoz
    { status: "CONFIRMED", direction: "INCOME", issueDate: "2026-08-01", netAmount: 20000, categoryName: "Értékesítés" },
    // dátum nélküli — sosem szerepelhet egyik időszakban sem
    { status: "CONFIRMED", direction: "EXPENSE", issueDate: null, netAmount: 5000, categoryName: "Egyéb" },
  ];

  it("csak a jóváhagyott, az időszakba eső tételeket összegzi, nettó alapon", () => {
    const result = buildDraftIncomeStatement(invoices, "month", "2026-09");
    expect(result.incomeTotal).toBe(150000);
    expect(result.expenseTotal).toBe(42000);
    expect(result.estimatedResult).toBe(108000);
    expect(result.includedInvoiceCount).toBe(4);
  });

  it("jelzi a kizárt (nem jóváhagyott) tételek számát", () => {
    const result = buildDraftIncomeStatement(invoices, "month", "2026-09");
    expect(result.excludedNotConfirmedCount).toBe(1);
  });

  it("kategóriánként bontja a sorokat, csökkenő nettó szerint", () => {
    const result = buildDraftIncomeStatement(invoices, "month", "2026-09");
    expect(result.expenseLines).toEqual([
      { categoryName: "Bérleti díj", net: 30000 },
      { categoryName: "Iroda", net: 12000 },
    ]);
  });

  it("üres időszakra nulla összegeket ad, hiba nélkül", () => {
    const result = buildDraftIncomeStatement(invoices, "month", "2026-01");
    expect(result.incomeTotal).toBe(0);
    expect(result.expenseTotal).toBe(0);
    expect(result.estimatedResult).toBe(0);
    expect(result.includedInvoiceCount).toBe(0);
  });

  it("negyedéves granularitásra is helyesen összegez", () => {
    const result = buildDraftIncomeStatement(invoices, "quarter", "2026-Q3");
    // a Q3 = júl-szept, tehát a szeptemberi ÉS az augusztusi jóváhagyott tételek is beleesnek
    expect(result.incomeTotal).toBe(170000);
  });
});
