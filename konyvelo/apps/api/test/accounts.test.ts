import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CHART } from "@konyvelo/domain";
import { Client, PASSWORD, appQuery, createCompany, createTestApp, login, resetDatabase, setupAdmin, type TestContext } from "./helpers";

let ctx: TestContext;
let admin: Client;

beforeAll(async () => {
  await resetDatabase();
  ctx = await createTestApp();
  admin = await setupAdmin(ctx.app);
});
afterAll(async () => ctx.close());

type Acc = { id: string; number: string; name: string; hasChildren: boolean; level: number; subledger: string; nature: string; normalSide: string; isActive: boolean };
const list = async (companyId: string): Promise<Acc[]> => (await admin.get(`/api/companies/${companyId}/accounts`)).json();

describe("számlatükör", () => {
  it("új cég az alapértelmezett számlatükörrel indul", async () => {
    const c = await createCompany(admin);
    const accounts = await list(c.id);
    expect(accounts).toHaveLength(DEFAULT_CHART.length);
    const by = Object.fromEntries(accounts.map((a) => [a.number, a]));
    expect(by["38"]).toMatchObject({ level: 1, hasChildren: true });
    expect(by["384"]).toMatchObject({ level: 2, hasChildren: false, subledger: "BANK" });
    expect(by["466"]).toMatchObject({ name: "Előzetesen felszámított általános forgalmi adó", bsLineDebit: "B.II.6", bsLineCredit: "F.III.9" });
    expect(by["522"]).toMatchObject({ isLine: "IV.06", bsLineDebit: null });
  });

  it("kimutatássor: alszámla örökli, módosítható, hibás kód elutasítva", async () => {
    const c = await createCompany(admin);
    const created = (await admin.post(`/api/companies/${c.id}/accounts`, { number: "5221", name: "Irodabérlet" })).json();
    expect(created).toMatchObject({ isLine: "IV.06" });
    const upd = await admin.patch(`/api/companies/${c.id}/accounts/${created.id}`, { isLine: "IV.07" });
    expect(upd.json()).toMatchObject({ isLine: "IV.07" });
    const bad = await admin.patch(`/api/companies/${c.id}/accounts/${created.id}`, { isLine: "XYZ", bsLineDebit: "Q.1" });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.fields).toMatchObject({ isLine: "Ismeretlen eredménykimutatás-sor.", bsLineDebit: "Ismeretlen mérlegsor." });
  });

  it("alszámla: jelleg és analitika a szülőtől öröklődik, a szülő gyűjtőszámla lesz", async () => {
    const c = await createCompany(admin);
    const res = await admin.post(`/api/companies/${c.id}/accounts`, { number: "3841", name: "OTP forint számla" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ number: "3841", subledger: "BANK", nature: "ASSET", normalSide: "D", level: 3, parentNumber: "384" });
    const by = Object.fromEntries((await list(c.id)).map((a) => [a.number, a]));
    expect(by["384"]!.hasChildren).toBe(true);
  });

  it("hibás és foglalt számlaszám magyar hibaüzenettel", async () => {
    const c = await createCompany(admin);
    const bad = await admin.post(`/api/companies/${c.id}/accounts`, { number: "38A", name: "X" });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.fields.number).toMatch(/1–8 számjegy/);
    const dup = await admin.post(`/api/companies/${c.id}/accounts`, { number: "384", name: "Másik" });
    expect(dup.statusCode).toBe(422);
    expect(dup.json().error.fields.number).toMatch(/már létezik/);
  });

  it("a számlaszám nem módosítható (alkalmazás és adatbázis szinten sem)", async () => {
    const c = await createCompany(admin);
    const acc = (await list(c.id)).find((a) => a.number === "381")!;
    const res = await admin.patch(`/api/companies/${c.id}/accounts/${acc.id}`, { number: "382" });
    expect(res.statusCode).toBe(422);
    await expect(appQuery("UPDATE accounts SET number = '3899' WHERE id = $1", [acc.id])).rejects.toThrow(/nem módosítható/);
  });

  it("módosítás és inaktiválás naplózva", async () => {
    const c = await createCompany(admin);
    const acc = (await list(c.id)).find((a) => a.number === "522")!;
    const res = await admin.patch(`/api/companies/${c.id}/accounts/${acc.id}`, { name: "Bérleti díjak (iroda)", isActive: false });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: "Bérleti díjak (iroda)", isActive: false });
    const log = (await admin.get(`/api/companies/${c.id}/audit-log`)).json();
    const e = log.entries.find((x: { action: string }) => x.action === "account.update");
    expect(e.before).toEqual({ number: "522", name: "Bérleti díjak", isActive: true });
  });

  it("törlés: gyűjtőszámla és használt számla nem törölhető, üres alszámla igen", async () => {
    const c = await createCompany(admin);
    const accs = await list(c.id);
    const r38 = await admin.delete(`/api/companies/${c.id}/accounts/${accs.find((a) => a.number === "38")!.id}`);
    expect(r38.statusCode).toBe(409);
    expect(r38.json().error.message).toMatch(/alszámlái/);

    const r311 = accs.find((a) => a.number === "311")!;
    await admin.post(`/api/companies/${c.id}/partners`, { kind: "CUSTOMER", name: "Vevő Kft.", defaultReceivableAccountId: r311.id });
    const used = await admin.delete(`/api/companies/${c.id}/accounts/${r311.id}`);
    expect(used.statusCode).toBe(409);
    expect(used.json().error.message).toMatch(/használatban/);

    const free = await admin.delete(`/api/companies/${c.id}/accounts/${accs.find((a) => a.number === "389")!.id}`);
    expect(free.statusCode).toBe(200);
    expect((await list(c.id)).some((a) => a.number === "389")).toBe(false);
  });

  it("alapértelmezett betöltés csak üres számlatükörbe", async () => {
    const c = await createCompany(admin);
    const res = await admin.post(`/api/companies/${c.id}/accounts/load-default`);
    expect(res.statusCode).toBe(409);
  });

  it("jogosultság: a Könyvelő nem szerkesztheti a számlatükröt, de olvashatja", async () => {
    const c = await createCompany(admin);
    await admin.post(`/api/companies/${c.id}/members`, { email: "kata@example.hu", name: "Könyvelő Kata", role: "ACCOUNTANT", initialPassword: PASSWORD });
    const kata = await login(ctx.app, "kata@example.hu");
    expect((await kata.get(`/api/companies/${c.id}/accounts`)).statusCode).toBe(200);
    expect((await kata.post(`/api/companies/${c.id}/accounts`, { number: "3842", name: "X" })).statusCode).toBe(403);
  });

  it("más cég számlájához nem fér hozzá", async () => {
    const c1 = await createCompany(admin);
    const c2 = await createCompany(admin);
    const acc = (await list(c1.id))[0]!;
    expect((await admin.patch(`/api/companies/${c2.id}/accounts/${acc.id}`, { name: "X" })).statusCode).toBe(404);
  });
});
