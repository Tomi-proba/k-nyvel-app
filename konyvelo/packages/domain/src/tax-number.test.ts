import { describe, expect, it } from "vitest";
import { taxNumberCheckDigit, validateTaxNumber } from "./tax-number";

describe("adószám", () => {
  it("ellenőrző számjegy", () => {
    expect(taxNumberCheckDigit("1077338")).toBe(1);
    expect(taxNumberCheckDigit("1053791")).toBe(4);
  });

  it("helyes adószámok, kötőjellel vagy anélkül", () => {
    expect(validateTaxNumber("10773381-2-44")).toEqual({ ok: true, normalized: "10773381-2-44" });
    expect(validateTaxNumber("10537914444")).toEqual({ ok: true, normalized: "10537914-4-44" });
  });

  it("hibás ellenőrző számjegy", () => {
    const r = validateTaxNumber("10773382-2-44");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/ellenőrző számjegye/);
  });

  it("hibás forma, áfakód, területi kód", () => {
    expect(validateTaxNumber("1234").ok).toBe(false);
    expect(validateTaxNumber("10773381-7-44").ok).toBe(false);
    expect(validateTaxNumber("10773381-2-00").ok).toBe(false);
  });
});
