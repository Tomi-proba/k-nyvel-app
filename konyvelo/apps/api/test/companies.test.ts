import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, PASSWORD, companyInput, createCompany, createTestApp, login, resetDatabase, setupAdmin, type TestContext } from "./helpers";

let ctx: TestContext;
let admin: Client;

beforeAll(async () => {
  await resetDatabase();
  ctx = await createTestApp();
  admin = await setupAdmin(ctx.app);
});
afterAll(async () => ctx.close());

describe("cégek", () => {
  it("létrehozás: a létrehozó Adminisztrátor lesz, az adószám normalizált", async () => {
    const input = companyInput({ taxNumber: "10773381244" });
    const res = await admin.post("/api/companies", input);
    expect(res.statusCode).toBe(201);
    const company = res.json();
    expect(company).toMatchObject({ taxNumber: "10773381-2-44", bookCurrency: "HUF", balanceSheetVariant: "A", incomeStatementMethod: "TOTAL_COST" });

    const list = (await admin.get("/api/companies")).json();
    expect(list).toHaveLength(1);
    expect(list[0].role).toBe("ADMIN");
  });

  it("hibás adószám: érthető magyar hibaüzenet", async () => {
    const res = await admin.post("/api/companies", companyInput({ taxNumber: "10773382-2-44" }));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.fields.taxNumber).toMatch(/ellenőrző számjegye hibás/);
  });

  it("ugyanazzal az adószámmal nem lehet két cég", async () => {
    const res = await admin.post("/api/companies", companyInput({ taxNumber: "10773381-2-44" }));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.fields.taxNumber).toMatch(/már van cég/);
  });

  it("csak forint lehet a könyvvezetés pénzneme (adatbázis-szintű védelem)", async () => {
    const { appQuery } = await import("./helpers");
    await expect(appQuery("UPDATE companies SET book_currency = 'EUR'")).rejects.toThrow();
  });

  it("módosítás: csak a változott mezők kerülnek az audit naplóba", async () => {
    const c = await createCompany(admin);
    const res = await admin.patch(`/api/companies/${c.id}`, { addressCity: "Szeged", name: "Minta Kereskedelmi Kft." });
    expect(res.statusCode).toBe(200);
    const log = (await admin.get(`/api/companies/${c.id}/audit-log`)).json();
    const update = log.entries.find((e: { action: string }) => e.action === "company.update");
    expect(update.before).toEqual({ addressCity: null });
    expect(update.after).toEqual({ addressCity: "Szeged" });
  });

  it("más felhasználó cégét nem látja (404, nem 403)", async () => {
    const c = await createCompany(admin);
    await admin.post(`/api/companies/${c.id}/members`, { email: "kulso@example.hu", name: "Külső Károly", role: "VIEWER", initialPassword: PASSWORD });
    const other = await login(ctx.app, "kulso@example.hu");
    const own = await createCompany(other);
    expect((await admin.get(`/api/companies/${own.id}`)).statusCode).toBe(404);
    expect((await admin.get(`/api/companies/nem-uuid`)).statusCode).toBe(404);
  });
});

describe("tagok és szerepkörök", () => {
  it("új felhasználó hozzáadása: első belépéskor jelszót kell cserélnie", async () => {
    const c = await createCompany(admin);
    const res = await admin.post(`/api/companies/${c.id}/members`, {
      email: "konyvelo@example.hu",
      name: "Könyvelő Kata",
      role: "ACCOUNTANT",
      initialPassword: PASSWORD,
    });
    expect(res.statusCode).toBe(201);
    const kata = await login(ctx.app, "konyvelo@example.hu");
    const me = (await kata.get("/api/auth/me")).json();
    expect(me.user.mustChangePassword).toBe(true);
    expect(me.companies.find((x: { id: string }) => x.id === c.id).role).toBe("ACCOUNTANT");

    const pw = await kata.post("/api/auth/password", { currentPassword: PASSWORD, newPassword: "uj-nagyon-titkos-jelszo" });
    expect(pw.statusCode).toBe(200);
    expect((await kata.get("/api/auth/me")).json().user.mustChangePassword).toBe(false);
  });

  it("új felhasználóhoz kötelező a név és a kezdő jelszó", async () => {
    const c = await createCompany(admin);
    const res = await admin.post(`/api/companies/${c.id}/members`, { email: "uj@example.hu", role: "VIEWER" });
    expect(res.statusCode).toBe(422);
    expect(Object.keys(res.json().error.fields).sort()).toEqual(["initialPassword", "name"]);
  });

  it("meglévő felhasználó másik céghez is hozzáadható, kétszer nem", async () => {
    const c = await createCompany(admin);
    expect((await admin.post(`/api/companies/${c.id}/members`, { email: "konyvelo@example.hu", role: "VIEWER" })).statusCode).toBe(201);
    expect((await admin.post(`/api/companies/${c.id}/members`, { email: "konyvelo@example.hu", role: "VIEWER" })).statusCode).toBe(409);
  });

  it("jogosultságok: a Megtekintő nem módosíthat, a Könyvelő nem kezelhet felhasználókat", async () => {
    const c = await createCompany(admin);
    await admin.post(`/api/companies/${c.id}/members`, { email: "nezo@example.hu", name: "Néző Nándor", role: "VIEWER", initialPassword: PASSWORD });
    await admin.post(`/api/companies/${c.id}/members`, { email: "konyvelo@example.hu", role: "ACCOUNTANT" });
    const viewer = await login(ctx.app, "nezo@example.hu");
    expect((await viewer.get(`/api/companies/${c.id}`)).statusCode).toBe(200);
    expect((await viewer.patch(`/api/companies/${c.id}`, { addressCity: "Pécs" })).statusCode).toBe(403);
    expect((await viewer.get(`/api/companies/${c.id}/audit-log`)).statusCode).toBe(403);

    const kata = await login(ctx.app, "konyvelo@example.hu", "uj-nagyon-titkos-jelszo");
    expect((await kata.get(`/api/companies/${c.id}/members`)).statusCode).toBe(403);
  });

  it("az utolsó Adminisztrátor nem fokozható le és nem távolítható el", async () => {
    const c = await createCompany(admin);
    const me = (await admin.get("/api/auth/me")).json().user;
    const demote = await admin.patch(`/api/companies/${c.id}/members/${me.id}`, { role: "VIEWER" });
    expect(demote.statusCode).toBe(409);
    expect(demote.json().error.message).toMatch(/legalább egy Adminisztrátora/);
    expect((await admin.delete(`/api/companies/${c.id}/members/${me.id}`)).statusCode).toBe(409);
  });

  it("szerepkör módosítása és eltávolítás naplózva", async () => {
    const c = await createCompany(admin);
    await admin.post(`/api/companies/${c.id}/members`, { email: "nezo@example.hu", role: "VIEWER" });
    const members = (await admin.get(`/api/companies/${c.id}/members`)).json();
    const nezo = members.find((m: { email: string }) => m.email === "nezo@example.hu");
    expect((await admin.patch(`/api/companies/${c.id}/members/${nezo.userId}`, { role: "CHIEF_ACCOUNTANT" })).statusCode).toBe(200);
    expect((await admin.delete(`/api/companies/${c.id}/members/${nezo.userId}`)).statusCode).toBe(200);
    const actions = (await admin.get(`/api/companies/${c.id}/audit-log`)).json().entries.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["member.update", "member.remove"]));
  });
});
