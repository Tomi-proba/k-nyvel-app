import { describe, expect, it } from "vitest";
import { NBSP, formatHuf, parseHufInput } from "./money";

const ft = (s: string) => s.replace(/ /g, NBSP);

describe("Ft formázás", () => {
  it("ezres tagolás nem törő szóközzel", () => {
    expect(formatHuf(1_250_000)).toBe(ft("12 500 Ft"));
    expect(formatHuf(123_456_789_00)).toBe(ft("123 456 789 Ft"));
    expect(formatHuf(0)).toBe(ft("0 Ft"));
  });

  it("fillér csak akkor jelenik meg, ha van", () => {
    expect(formatHuf(1_250_050)).toBe(ft("12 500,50 Ft"));
    expect(formatHuf(1_250_000, { decimals: "always" })).toBe(ft("12 500,00 Ft"));
    expect(formatHuf(1_250_050, { decimals: "never" })).toBe(ft("12 501 Ft"));
  });

  it("negatív összeg", () => {
    expect(formatHuf(-1_250_000)).toBe(ft("-12 500 Ft"));
  });

  it("egység nélkül", () => {
    expect(formatHuf(100_000, { withUnit: false })).toBe(ft("1 000"));
  });

  it("nem egész fillért elutasít", () => {
    expect(() => formatHuf(1.5)).toThrow();
  });
});

describe("Ft bevitel", () => {
  it.each([
    ["12500", 1_250_000],
    ["12 500", 1_250_000],
    ["12 500 Ft", 1_250_000],
    ["12.500", 1_250_000],
    ["1.250.000", 125_000_000],
    ["12 500,5", 1_250_050],
    ["12 500,50", 1_250_050],
    ["12500.5", 1_250_050],
    ["12.500,25", 1_250_025],
    ["-1 000", -100_000],
    ["0", 0],
  ])("%s", (input, expected) => {
    expect(parseHufInput(input)).toEqual({ ok: true, value: expected });
  });

  it.each(["", "abc", "12,345", "1,2,3", "12.34.5", "--5"])("hibás: %s", (input) => {
    expect(parseHufInput(input).ok).toBe(false);
  });
});
