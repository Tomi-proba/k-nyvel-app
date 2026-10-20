import { describe, expect, it } from "vitest";
import { buildAccountTree } from "./accounts";
import { DEFAULT_CHART } from "./default-chart";
import {
  BALANCE_SHEET_LINES,
  INCOME_STATEMENT_LINES,
  isBalanceSheetLine,
  isIncomeStatementLine,
  simplifiedAncestor,
} from "./report-lines";

describe("kimutatássorok (Szt. 1. és 2. melléklet)", () => {
  it("mérleg: egyszerűsített szint = nagybetűs és római számos sorok (Szt. 96. § (2))", () => {
    const simplified = BALANCE_SHEET_LINES.filter((l) => l.simplified).map((l) => l.code);
    expect(simplified).toEqual([
      "A", "A.I", "A.II", "A.III", "A.IV",
      "B", "B.I", "B.II", "B.III", "B.IV",
      "C",
      "D", "D.I", "D.II", "D.III", "D.IV", "D.V", "D.VI", "D.VII",
      "E",
      "F", "F.I", "F.II", "F.III",
      "G",
    ]);
  });

  it("mérleg: minden sor szülője létezik, az oldal helyes", () => {
    const codes = new Set(BALANCE_SHEET_LINES.map((l) => l.code));
    for (const l of BALANCE_SHEET_LINES) if (l.parent) expect(codes.has(l.parent), l.code).toBe(true);
    expect(BALANCE_SHEET_LINES.find((l) => l.code === "B.IV.2")?.side).toBe("ASSET");
    expect(BALANCE_SHEET_LINES.find((l) => l.code === "F.III.4")?.side).toBe("SOURCE");
  });

  it("eredménykimutatás: egyszerűsített szint és képletek", () => {
    const simplified = INCOME_STATEMENT_LINES.filter((l) => l.simplified).map((l) => l.code);
    expect(simplified).toEqual(["I", "II", "III", "IV", "V", "VI", "VII", "A", "VIII", "IX", "B", "C", "X", "X/1", "D"]);
    const a = INCOME_STATEMENT_LINES.find((l) => l.code === "A")!;
    expect(a.formula).toEqual([
      { code: "I", sign: 1 }, { code: "II", sign: 1 }, { code: "III", sign: 1 },
      { code: "IV", sign: -1 }, { code: "V", sign: -1 }, { code: "VI", sign: -1 }, { code: "VII", sign: -1 },
    ]);
    expect(INCOME_STATEMENT_LINES.find((l) => l.code === "D")!.formula).toEqual([
      { code: "C", sign: 1 }, { code: "X", sign: -1 }, { code: "X/1", sign: 1 },
    ]);
  });

  it("részletes sor összesítése az egyszerűsített sorba", () => {
    expect(simplifiedAncestor("B.II.1", BALANCE_SHEET_LINES)).toBe("B.II");
    expect(simplifiedAncestor("C.2", BALANCE_SHEET_LINES)).toBe("C");
    expect(simplifiedAncestor("IV.06", INCOME_STATEMENT_LINES)).toBe("IV");
    expect(simplifiedAncestor("VII.E", INCOME_STATEMENT_LINES)).toBe("VII");
  });
});

describe("alapértelmezett számlatükör hozzárendelése", () => {
  const postable = buildAccountTree(DEFAULT_CHART).filter((a) => !a.hasChildren);

  it("minden könyvelhető mérlegszámla (1–4. osztály, 49 kivételével) mérlegsorhoz rendelt", () => {
    for (const a of postable.filter((x) => "1234".includes(x.number[0]!) && !x.number.startsWith("49"))) {
      expect(a.bsDebit && isBalanceSheetLine(a.bsDebit), `${a.number} tartozik`).toBeTruthy();
      expect(a.bsCredit && isBalanceSheetLine(a.bsCredit), `${a.number} követel`).toBeTruthy();
      expect(a.isLine, a.number).toBeNull();
    }
  });

  it("minden könyvelhető eredményszámla (5., 8., 9. osztály) eredménykimutatás-sorhoz rendelt (59 kivételével)", () => {
    for (const a of postable.filter((x) => "589".includes(x.number[0]!) && !x.number.startsWith("59"))) {
      expect(a.isLine && isIncomeStatementLine(a.isLine), a.number).toBeTruthy();
      expect(a.bsDebit, a.number).toBeNull();
    }
  });

  it("nyilvántartási, évnyitó/záró és költséghely-számlák sehová", () => {
    for (const n of ["01", "09", "491", "492", "493", "59", "6", "7"]) {
      const a = DEFAULT_CHART.find((x) => x.number === n)!;
      expect([a.bsDebit, a.bsCredit, a.isLine], n).toEqual([null, null, null]);
    }
  });

  it("jellemző hozzárendelések", () => {
    const by = Object.fromEntries(DEFAULT_CHART.map((a) => [a.number, a]));
    expect(by["311"]).toMatchObject({ bsDebit: "B.II.1", bsCredit: "F.III.9" });
    expect(by["454"]).toMatchObject({ bsDebit: "B.II.6", bsCredit: "F.III.4" });
    expect(by["384"]).toMatchObject({ bsDebit: "B.IV.2", bsCredit: "F.III.2" });
    expect(by["466"]).toMatchObject({ bsDebit: "B.II.6", bsCredit: "F.III.9" });
    expect(by["119"]).toMatchObject({ bsDebit: "A.I", bsCredit: "A.I" });
    expect(by["522"]!.isLine).toBe("IV.06");
    expect(by["814"]!.isLine).toBe("IV.08");
    expect(by["912"]!.isLine).toBe("I.01");
    expect(by["966"]!.isLine).toBe("III.E");
    expect(by["891"]!.isLine).toBe("X");
  });
});
