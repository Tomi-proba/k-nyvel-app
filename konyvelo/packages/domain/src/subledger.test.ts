import { describe, expect, it } from "vitest";
import { agingBucket, allocateSettlements, dailyClosings, lineRole, validateSettlementPlan, type PlanItem } from "./subledger";

describe("analitika", () => {
  it("a sor szerepe a számla analitikájából és oldalából", () => {
    expect(lineRole("CUSTOMER", "D")).toBe("ITEM");
    expect(lineRole("CUSTOMER", "C")).toBe("PAYMENT");
    expect(lineRole("SUPPLIER", "C")).toBe("ITEM");
    expect(lineRole("SUPPLIER", "D")).toBe("PAYMENT");
    expect(lineRole("BANK", "D")).toBeNull();
  });

  it("korosítás a fizetési határidőhöz képest", () => {
    expect(agingBucket("2026-10-20", "2026-10-20")).toBe("NOT_DUE");
    expect(agingBucket("2026-10-19", "2026-10-20")).toBe("D1_30");
    expect(agingBucket("2026-09-20", "2026-10-20")).toBe("D1_30");
    expect(agingBucket("2026-09-19", "2026-10-20")).toBe("D31_60");
    expect(agingBucket("2026-07-22", "2026-10-20")).toBe("D61_90");
    expect(agingBucket("2026-07-21", "2026-10-20")).toBe("D90_PLUS");
  });
});

describe("kiegyenlítés rögzítéskor", () => {
  const items: Record<string, PlanItem> = {
    i1: { lineId: "i1", accountId: "454", accountNumber: "454", partnerId: "p", open: 12700, label: "SZSZ-1" },
    i2: { lineId: "i2", accountId: "454", accountNumber: "454", partnerId: "p", open: 5000, label: "SZSZ-2" },
    x: { lineId: "x", accountId: "454", accountNumber: "454", partnerId: "masik", open: 100, label: "SZSZ-3" },
  };
  const sub = (id: string) => (id === "454" ? ("SUPPLIER" as const) : ("BANK" as const));
  const lines = [
    { id: "l1", accountId: "454", side: "D" as const, amount: 15000 },
    { id: "l2", accountId: "384", side: "C" as const, amount: 15000 },
  ];

  it("elfogadja a helyes tervet, és sorrendben szétosztja", () => {
    const plan = [
      { itemLineId: "i1", amount: 12700 },
      { itemLineId: "i2", amount: 2300 },
    ];
    expect(validateSettlementPlan(plan, lines, (id) => items[id], sub, "p")).toEqual({});
    expect(allocateSettlements(plan, lines, (id) => items[id]?.accountId, sub)).toEqual([
      { itemLineId: "i1", settlingLineId: "l1", amount: 12700 },
      { itemLineId: "i2", settlingLineId: "l1", amount: 2300 },
    ]);
  });

  it("hibák: túl nagy összeg, más partner, a sor összegénél több", () => {
    const e = validateSettlementPlan(
      [
        { itemLineId: "i1", amount: 13000 },
        { itemLineId: "x", amount: 100 },
      ],
      lines,
      (id) => items[id],
      sub,
      "p",
    );
    expect(e["settlements.0"]).toMatch(/nyitott összeg/);
    expect(e["settlements.1"]).toMatch(/másik partner/);
    const over = validateSettlementPlan(
      [
        { itemLineId: "i1", amount: 12700 },
        { itemLineId: "i2", amount: 5000 },
      ],
      lines,
      (id) => items[id],
      sub,
      "p",
    );
    expect(over.settlements).toMatch(/több, mint a bizonylaton a 454 számla/);
  });
});

describe("pénzeszközök", () => {
  it("napi záróegyenlegek", () => {
    expect(
      dailyClosings(1000, [
        { date: "2026-10-01", debit: 500, credit: 0 },
        { date: "2026-10-01", debit: 0, credit: 200 },
        { date: "2026-10-03", debit: 0, credit: 1500 },
      ]),
    ).toEqual([
      { date: "2026-10-01", closing: 1300 },
      { date: "2026-10-03", closing: -200 },
    ]);
  });
});
