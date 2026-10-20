import { describe, expect, it } from "vitest";
import { addDays, addMonths, endOfMonth, formatDateHu, isValidIsoDate, parseDateHu } from "./dates";

describe("dátumok", () => {
  it("magyar formátumban jelenik meg", () => {
    expect(formatDateHu("2026-10-20")).toBe("2026.10.20.");
    expect(formatDateHu(null)).toBe("");
  });

  it.each([
    ["2026.10.20.", "2026-10-20"],
    ["2026.10.20", "2026-10-20"],
    ["2026. 10. 20.", "2026-10-20"],
    ["2026-10-20", "2026-10-20"],
    ["20261020", "2026-10-20"],
    ["2026.1.5", "2026-01-05"],
    ["10.20.", "2026-10-20"],
    ["10.20", "2026-10-20"],
  ])("rugalmas bevitel: %s", (input, expected) => {
    expect(parseDateHu(input, 2026)).toBe(expected);
  });

  it.each(["", "2026.02.30.", "2026.13.01", "abc", "20261", "10.20"])("érvénytelen bevitel: %s", (input) => {
    // Év nélküli bevitel csak megadott alapértelmezett évvel értelmezhető.
    expect(parseDateHu(input)).toBeNull();
  });

  it("szökőév", () => {
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
  });

  it("napok és hónapok hozzáadása", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-01", 12)).toBe("2027-03-01");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
  });
});
