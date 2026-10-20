import { describe, expect, it } from "vitest";
import { companyCreateSchema, fieldErrorsFromZod, loginSchema, setupSchema } from "./schemas";
import { hasPermission } from "./roles";

const validCompany = {
  name: "Minta Kft.",
  shortName: "Minta",
  taxNumber: "10773381244",
  reportType: "SIMPLIFIED_ANNUAL",
  fxRateSource: "MNB",
};

describe("cég séma", () => {
  it("normalizálja az adószámot", () => {
    const r = companyCreateSchema.parse(validCompany);
    expect(r.taxNumber).toBe("10773381-2-44");
  });

  it("magyar hibaüzenetek mezőnként", () => {
    const r = companyCreateSchema.safeParse({ ...validCompany, name: "  ", taxNumber: "123", communityVatNumber: "DE1" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const f = fieldErrorsFromZod(r.error);
      expect(f.name).toBe("Cégnév: kötelező mező.");
      expect(f.taxNumber).toMatch(/12345678-1-12/);
      expect(f.communityVatNumber).toMatch(/HU12345678/);
    }
  });

  it("üres opcionális mező null lesz", () => {
    const r = companyCreateSchema.parse({ ...validCompany, addressCity: "" });
    expect(r.addressCity).toBeNull();
  });
});

describe("hitelesítési sémák", () => {
  it("e-mail kisbetűsítve", () => {
    expect(loginSchema.parse({ email: " Admin@Example.HU ", password: "x" }).email).toBe("admin@example.hu");
  });
  it("rövid jelszó elutasítva", () => {
    const r = setupSchema.safeParse({ name: "A", email: "a@b.hu", password: "rovid" });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrorsFromZod(r.error).password).toMatch(/legalább 12/);
  });
});

describe("jogosultságok", () => {
  it("szerepkörök szerint", () => {
    expect(hasPermission("ADMIN", "period:reopen")).toBe(true);
    expect(hasPermission("CHIEF_ACCOUNTANT", "period:reopen")).toBe(false);
    expect(hasPermission("CHIEF_ACCOUNTANT", "period:close")).toBe(true);
    expect(hasPermission("ACCOUNTANT", "ledger:post")).toBe(true);
    expect(hasPermission("ACCOUNTANT", "members:manage")).toBe(false);
    expect(hasPermission("VIEWER", "ledger:post")).toBe(false);
  });
});
