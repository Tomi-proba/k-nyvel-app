import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, PASSWORD, appQuery, createCompany, createTestApp, login, nextTaxNumber, resetDatabase, setupAdmin, type TestContext } from "./helpers";

let ctx: TestContext;
let admin: Client;
let companyId: string;
let acc: Record<string, string>;

beforeAll(async () => {
  await resetDatabase();
  ctx = await createTestApp();
  admin = await setupAdmin(ctx.app);
  companyId = (await createCompany(admin)).id;
  const accounts: Array<{ id: string; number: string }> = (await admin.get(`/api/companies/${companyId}/accounts`)).json();
  acc = Object.fromEntries(accounts.map((a) => [a.number, a.id]));
});
afterAll(async () => ctx.close());

const url = () => `/api/companies/${companyId}/partners`;

describe("partnerek", () => {
  it("szállító létrehozása alapértelmezett kontírozással", async () => {
    const tax = nextTaxNumber();
    const res = await admin.post(url(), {
      kind: "SUPPLIER",
      name: "Irodaszer Kft.",
      taxNumber: tax.replace(/-/g, ""),
      bankAccount: "117730161111101800000000",
      paymentTermsDays: 15,
      defaultPayableAccountId: acc["454"],
      defaultExpenseAccountId: acc["514"],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ taxNumber: tax, bankAccount: "11773016-11111018-00000000", country: "HU", status: "ACTIVE" });
  });

  it("azonos adószámmal nem lehet két partner", async () => {
    const tax = nextTaxNumber();
    expect((await admin.post(url(), { kind: "CUSTOMER", name: "A Kft.", taxNumber: tax })).statusCode).toBe(201);
    const dup = await admin.post(url(), { kind: "SUPPLIER", name: "B Kft.", taxNumber: tax });
    expect(dup.statusCode).toBe(422);
    expect(dup.json().error.fields.taxNumber).toMatch(/már van partner/);
  });

  it("hibás adatok magyar hibaüzenettel", async () => {
    const res = await admin.post(url(), {
      kind: "CUSTOMER",
      name: "",
      taxNumber: "12345678-1-11",
      bankAccount: "123",
      email: "nem-email",
      paymentTermsDays: 400,
    });
    expect(res.statusCode).toBe(422);
    const f = res.json().error.fields;
    expect(f.name).toMatch(/kötelező/);
    expect(f.taxNumber).toMatch(/ellenőrző számjegye/);
    expect(f.bankAccount).toMatch(/bankszámlaszám formája/);
    expect(f.email).toMatch(/e-mail/);
    expect(f.paymentTermsDays).toMatch(/365/);
  });

  it("magánszemélynél nincs adószám (adattakarékosság)", async () => {
    const res = await admin.post(url(), { kind: "CUSTOMER", name: "Kiss Péter", isPrivatePerson: true, taxNumber: nextTaxNumber() });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.fields.taxNumber).toMatch(/Magánszemélynél/);
    const ok = await admin.post(url(), { kind: "CUSTOMER", name: "Kiss Péter", isPrivatePerson: true, city: "Eger" });
    expect(ok.statusCode).toBe(201);
    // Utólagos módosítással sem kerülhet adószám magánszemélyhez.
    const patch = await admin.patch(`${url()}/${ok.json().id}`, { taxNumber: nextTaxNumber() });
    expect(patch.statusCode).toBe(422);
    // Az adatbázis is tiltja.
    await expect(appQuery("UPDATE partners SET tax_number = '10773381-2-44' WHERE id = $1", [ok.json().id])).rejects.toThrow();
  });

  it("külföldi partner: közösségi adószám, magyar adószám nem", async () => {
    const res = await admin.post(url(), { kind: "SUPPLIER", name: "Muster GmbH", country: "de", communityVatNumber: "DE123456789", bankAccount: "DE89370400440532013000" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ country: "DE", bankAccount: "DE89 3704 0044 0532 0130 00" });
    const bad = await admin.post(url(), { kind: "SUPPLIER", name: "X GmbH", country: "DE", taxNumber: nextTaxNumber() });
    expect(bad.statusCode).toBe(422);
  });

  it("alapértelmezett számlák ellenőrzése: szerep, gyűjtőszámla, idegen cég", async () => {
    const res = await admin.post(url(), {
      kind: "BOTH",
      name: "Vegyes Kft.",
      defaultReceivableAccountId: acc["454"],
      defaultPayableAccountId: acc["45"],
      defaultRevenueAccountId: acc["514"],
    });
    expect(res.statusCode).toBe(422);
    const f = res.json().error.fields;
    expect(f.defaultReceivableAccountId).toMatch(/vevőanalitikás/);
    expect(f.defaultPayableAccountId).toMatch(/gyűjtőszámla/);
    expect(f.defaultRevenueAccountId).toMatch(/9\. számlaosztály/);

    const other = await createCompany(admin);
    const otherAcc: Array<{ id: string; number: string }> = (await admin.get(`/api/companies/${other.id}/accounts`)).json();
    const foreign = await admin.post(url(), { kind: "CUSTOMER", name: "Y Kft.", defaultReceivableAccountId: otherAcc.find((a) => a.number === "311")!.id });
    expect(foreign.statusCode).toBe(422);
    expect(foreign.json().error.fields.defaultReceivableAccountId).toMatch(/nem található/);
  });

  it("keresés névre (ékezet nélkül is) és adószámra, szűrés típusra", async () => {
    const tax = nextTaxNumber();
    await admin.post(url(), { kind: "CUSTOMER", name: "Építő Zrt.", taxNumber: tax });
    const byName: Array<{ name: string }> = (await admin.get(`${url()}?q=epito`)).json();
    expect(byName.map((p) => p.name)).toEqual(["Építő Zrt."]);
    const byTax: Array<{ name: string }> = (await admin.get(`${url()}?q=${tax.slice(0, 6)}`)).json();
    expect(byTax.map((p) => p.name)).toContain("Építő Zrt.");
    const suppliers: Array<{ kind: string }> = (await admin.get(`${url()}?kind=SUPPLIER`)).json();
    expect(suppliers.every((p) => p.kind === "SUPPLIER" || p.kind === "BOTH")).toBe(true);
  });

  it("részleges módosítás nem írja felül a nem küldött mezőket", async () => {
    const p = (await admin.post(url(), { kind: "SUPPLIER", name: "Wien GmbH", country: "AT", communityVatNumber: "ATU12345678" })).json();
    const priv = (await admin.post(url(), { kind: "CUSTOMER", name: "Nagy Éva", isPrivatePerson: true })).json();
    expect((await admin.patch(`${url()}/${p.id}`, { name: "Wien Handels GmbH" })).json()).toMatchObject({ country: "AT", name: "Wien Handels GmbH" });
    expect((await admin.patch(`${url()}/${priv.id}`, { city: "Vác" })).json()).toMatchObject({ isPrivatePerson: true, city: "Vác" });
  });

  it("inaktiválás, törlés, naplózás", async () => {
    const p = (await admin.post(url(), { kind: "CUSTOMER", name: "Ideiglenes Bt." })).json();
    expect((await admin.patch(`${url()}/${p.id}`, { status: "INACTIVE" })).json().status).toBe("INACTIVE");
    expect((await admin.get(`${url()}?status=ACTIVE`)).json().some((x: { id: string }) => x.id === p.id)).toBe(false);
    expect((await admin.delete(`${url()}/${p.id}`)).statusCode).toBe(200);
    expect((await admin.get(`${url()}/${p.id}`)).statusCode).toBe(404);
    const actions = (await admin.get(`/api/companies/${companyId}/audit-log?limit=200`)).json().entries.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["partner.create", "partner.update", "partner.delete"]));
  });

  it("jogosultság: a Könyvelő kezelhet partnert, a Megtekintő nem", async () => {
    await admin.post(`/api/companies/${companyId}/members`, { email: "kata@example.hu", name: "Könyvelő Kata", role: "ACCOUNTANT", initialPassword: PASSWORD });
    await admin.post(`/api/companies/${companyId}/members`, { email: "nezo@example.hu", name: "Néző Nándor", role: "VIEWER", initialPassword: PASSWORD });
    const kata = await login(ctx.app, "kata@example.hu");
    const nezo = await login(ctx.app, "nezo@example.hu");
    expect((await kata.post(url(), { kind: "CUSTOMER", name: "Kata partnere" })).statusCode).toBe(201);
    expect((await nezo.post(url(), { kind: "CUSTOMER", name: "Néző partnere" })).statusCode).toBe(403);
    expect((await nezo.get(url())).statusCode).toBe(200);
  });
});
