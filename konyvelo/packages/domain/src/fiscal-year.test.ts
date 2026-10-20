import { describe, expect, it } from "vitest";
import { generateMonthlyPeriods, suggestNextFiscalYear, validateFiscalYear } from "./fiscal-year";

const y2026 = { startDate: "2026-01-01", endDate: "2026-12-31" };

describe("üzleti év ellenőrzése", () => {
  it("naptári év rendben", () => {
    expect(validateFiscalYear(y2026, [])).toEqual([]);
  });

  it("rövidebb (töredék) év rendben", () => {
    expect(validateFiscalYear({ startDate: "2026-03-15", endDate: "2026-12-31" }, [])).toEqual([]);
  });

  it("12 hónapnál hosszabb csak indoklással", () => {
    const long = { startDate: "2025-11-10", endDate: "2026-12-31" };
    expect(validateFiscalYear(long, [])[0]?.message).toMatch(/legfeljebb 12 hónap/);
    expect(validateFiscalYear({ ...long, exceptionReason: "Előtársasági időszak (Szt. 11. § (5))" }, [])).toEqual([]);
  });

  it("pontosan 12 hónap eltérő mérlegfordulónappal", () => {
    expect(validateFiscalYear({ startDate: "2026-07-01", endDate: "2027-06-30" }, [])).toEqual([]);
    expect(validateFiscalYear({ startDate: "2026-07-01", endDate: "2027-07-01" }, [])).not.toEqual([]);
  });

  it("záró dátum nem lehet a kezdő előtt", () => {
    expect(validateFiscalYear({ startDate: "2026-05-01", endDate: "2026-04-30" }, [])[0]?.field).toBe("endDate");
  });

  it("átfedés tiltva", () => {
    const errors = validateFiscalYear({ startDate: "2026-06-01", endDate: "2027-05-31" }, [y2026]);
    expect(errors[0]?.message).toMatch(/átfedésben/);
  });

  it("folytonosság: csak közvetlenül utána vagy előtte", () => {
    expect(validateFiscalYear({ startDate: "2027-01-01", endDate: "2027-12-31" }, [y2026])).toEqual([]);
    expect(validateFiscalYear({ startDate: "2025-01-01", endDate: "2025-12-31" }, [y2026])).toEqual([]);
    const gap = validateFiscalYear({ startDate: "2028-01-01", endDate: "2028-12-31" }, [y2026]);
    expect(gap[0]?.message).toMatch(/folytonos/);
  });

  it("érvénytelen dátum", () => {
    expect(validateFiscalYear({ startDate: "2026-02-30", endDate: "2026-12-31" }, [])[0]?.field).toBe("startDate");
  });
});

describe("havi időszakok", () => {
  it("naptári év: 12 időszak", () => {
    const periods = generateMonthlyPeriods(y2026);
    expect(periods).toHaveLength(12);
    expect(periods[0]).toEqual({ startDate: "2026-01-01", endDate: "2026-01-31" });
    expect(periods[1]).toEqual({ startDate: "2026-02-01", endDate: "2026-02-28" });
    expect(periods[11]).toEqual({ startDate: "2026-12-01", endDate: "2026-12-31" });
  });

  it("töredék hónapok az elején és a végén", () => {
    const periods = generateMonthlyPeriods({ startDate: "2026-03-15", endDate: "2026-05-10" });
    expect(periods).toEqual([
      { startDate: "2026-03-15", endDate: "2026-03-31" },
      { startDate: "2026-04-01", endDate: "2026-04-30" },
      { startDate: "2026-05-01", endDate: "2026-05-10" },
    ]);
  });

  it("az időszakok hézag és átfedés nélkül lefedik az évet", () => {
    const range = { startDate: "2026-07-01", endDate: "2027-06-30" };
    const periods = generateMonthlyPeriods(range);
    expect(periods[0]!.startDate).toBe(range.startDate);
    expect(periods.at(-1)!.endDate).toBe(range.endDate);
    for (let i = 1; i < periods.length; i++) {
      const prevEnd = new Date(periods[i - 1]!.endDate + "T00:00:00Z");
      prevEnd.setUTCDate(prevEnd.getUTCDate() + 1);
      expect(periods[i]!.startDate).toBe(prevEnd.toISOString().slice(0, 10));
    }
  });
});

describe("következő üzleti év javaslat", () => {
  it("első év: a folyó naptári év", () => {
    expect(suggestNextFiscalYear([], "2026-10-20")).toEqual(y2026);
  });
  it("az utolsó után folytatja", () => {
    expect(suggestNextFiscalYear([y2026], "2026-10-20")).toEqual({ startDate: "2027-01-01", endDate: "2027-12-31" });
  });
});
