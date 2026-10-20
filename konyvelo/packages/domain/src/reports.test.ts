import { describe, expect, it } from "vitest";
import { defaultReportMapping } from "./report-mapping";
import { buildBalanceSheet, buildIncomeStatement, toThousandHuf, type AccountTurnover } from "./reports";

const ft = (n: number) => n * 100;
const acc = (number: string, debit: number, credit: number): AccountTurnover => {
  const m = defaultReportMapping(number);
  return { number, name: number, debit: ft(debit), credit: ft(credit), bsLineDebit: m.bsDebit, bsLineCredit: m.bsCredit, isLine: m.isLine };
};

// Az öt valós példa (lásd az API „valos-peldak” tesztjét) számlaforgalma, plusz alapítás és tárgyi eszköz.
const year = [
  acc("413", 0, 0),
  acc("411", 0, 3000000), // jegyzett tőke
  acc("3841", 3000000 + 254000, 127000 + 2350 + 800000), // bank
  acc("1311", 800000, 0), // gép
  acc("1319", 0, 100000), // értékcsökkenés (eszköz-ellenszámla)
  acc("571", 100000, 0), // értékcsökkenési leírás
  acc("522", 100000, 0),
  acc("532", 2350, 0),
  acc("466", 27000, 0),
  acc("467", 0, 54000),
  acc("454", 127000, 127000),
  acc("311", 254000, 254000),
  acc("912", 0, 200000),
];

describe("eredménykimutatás (összköltség-eljárás)", () => {
  it("sorok, számított eredmények", () => {
    const is = buildIncomeStatement(year);
    const v = Object.fromEntries(is.lines.map((l) => [l.code, l.value / 100]));
    expect(v).toMatchObject({ I: 200000, "I.01": 200000, IV: 102350, "IV.06": 100000, "IV.07": 2350, VI: 100000, A: -2350, B: 0, C: -2350, D: -2350 });
    expect(is.result).toBe(-ft(2350));
    expect(is.unmapped).toEqual([]);
  });
});

describe("mérleg („A” változat)", () => {
  it("eszközök = források, az eredmény a D.VII soron", () => {
    const result = buildIncomeStatement(year).result;
    const bs = buildBalanceSheet(year, result);
    const v = Object.fromEntries(bs.lines.map((l) => [l.code, l.value / 100]));
    expect(v).toMatchObject({
      "A.II": 700000, // 800 000 gép − 100 000 értékcsökkenés
      "B.II": 27000, // előzetesen felszámított áfa
      "B.IV": 2324650,
      "D.I": 3000000,
      "D.VII": -2350,
      "F.III": 54000,
    });
    expect(bs.assets).toBe(bs.sources);
    expect(bs.assets).toBe(ft(700000 + 27000 + 2324650));
    expect(bs.unmapped).toEqual([]);
  });

  it("a hozzárendelés nélküli számla egyenlege hibaként jelenik meg", () => {
    const bs = buildBalanceSheet([{ ...acc("3841", 100, 0), bsLineDebit: null }], 0);
    expect(bs.unmapped).toEqual([{ number: "3841", name: "3841", amount: ft(100) }]);
  });

  it("ezer forintra kerekítés", () => {
    expect([toThousandHuf(ft(1499)), toThousandHuf(ft(1500)), toThousandHuf(-ft(2350)), toThousandHuf(ft(2324650))]).toEqual([1, 2, -2, 2325]);
  });
});
