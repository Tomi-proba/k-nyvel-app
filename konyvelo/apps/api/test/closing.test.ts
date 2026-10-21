import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, PASSWORD, createCompany, createTestApp, login, nextTaxNumber, resetDatabase, setupAdmin, type TestContext } from "./helpers";

let ctx: TestContext;
let admin: Client;
let c: string;
let acc: Record<string, string>;
let fy2025: { id: string; periods: Array<{ id: string; startDate: string }> };
const ft = (n: number) => n * 100;

beforeAll(async () => {
  await resetDatabase();
  ctx = await createTestApp();
  admin = await setupAdmin(ctx.app);
  c = (await createCompany(admin, { shortName: "Próba Kft." })).id;
  fy2025 = (await admin.post(`/api/companies/${c}/fiscal-years`, { startDate: "2025-01-01", endDate: "2025-12-31" })).json();
  acc = Object.fromEntries(((await admin.get(`/api/companies/${c}/accounts`)).json() as Array<{ id: string; number: string }>).map((a) => [a.number, a.id]));
});
afterAll(async () => ctx.close());

const L = (n: string, side: "D" | "C", amount: number) => ({ accountId: acc[n], side, amount: ft(amount) });
const doc = (date: string, lines: unknown[], post = true) =>
  admin.post(`/api/companies/${c}/documents`, { docType: "VEGY", description: "Teszt", issueDate: date, accountingDate: date, lines, post });
const status = async () => (await admin.get(`/api/companies/${c}/fiscal-years/${fy2025.id}/closing`)).json();
const bs = async (asOf: string) => (await admin.get(`/api/companies/${c}/reports/balance-sheet?asOf=${asOf}`)).json();
const line = (st: { lines: Array<{ code: string; value: number }> }, code: string) => st.lines.find((l) => l.code === code)!.value / 100;

describe("havi időszakzárás", () => {
  it("piszkozat mellett nem zárható; zárás után oda nem könyvelhető; feloldás csak Adminisztrátornak, indoklással", async () => {
    await doc("2025-03-01", [L("384", "D", 3000000), L("411", "C", 3000000)]);
    const draft = (await doc("2025-03-10", [L("522", "D", 1000)], false)).json();
    const march = fy2025.periods.find((p) => p.startDate === "2025-03-01")!;
    const blocked = await admin.post(`/api/companies/${c}/periods/${march.id}/close`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.message).toMatch(/2025\. március időszakban 1 piszkozat van/);
    await admin.delete(`/api/companies/${c}/documents/${draft.id}`);
    expect((await admin.post(`/api/companies/${c}/periods/${march.id}/close`)).statusCode).toBe(200);
    expect((await doc("2025-03-15", [L("522", "D", 1000), L("384", "C", 1000)])).json().error.fields.accountingDate).toMatch(/lezárt időszak/);

    await admin.post(`/api/companies/${c}/members`, { email: "vezeto@example.hu", name: "Vezető Vera", role: "CHIEF_ACCOUNTANT", initialPassword: PASSWORD });
    const chief = await login(ctx.app, "vezeto@example.hu");
    expect((await chief.post(`/api/companies/${c}/periods/${march.id}/reopen`, { reason: "Javítás" })).statusCode).toBe(403);
    expect((await admin.post(`/api/companies/${c}/periods/${march.id}/reopen`, { reason: "" })).json().error.fields.reason).toMatch(/indoklást/);
    expect((await admin.post(`/api/companies/${c}/periods/${march.id}/reopen`, { reason: "Elmaradt számla" })).statusCode).toBe(200);
    const log = (await admin.get(`/api/companies/${c}/audit-log`)).json();
    expect(log.entries[0]).toMatchObject({ action: "period.reopen", after: { period: "2025. március", reason: "Elmaradt számla" } });
  });
});

describe("évzárás és nyitás", () => {
  beforeAll(async () => {
    await doc("2025-06-10", [L("384", "D", 500000), L("911", "C", 500000)]);
    await doc("2025-06-20", [L("522", "D", 120000), L("384", "C", 120000)]);
  });

  it("zárlati állapotban csak a fordulónapra lehet könyvelni", async () => {
    const st = (await admin.post(`/api/companies/${c}/fiscal-years/${fy2025.id}/start-closing`)).json();
    expect(st.fiscalYear.status).toBe("CLOSING");
    expect(st.preview.result).toBe(ft(380000));
    expect((await doc("2025-12-30", [L("522", "D", 1000), L("384", "C", 1000)])).json().error.fields.accountingDate).toMatch(/csak a mérlegfordulónapra/);
    // Zárlati tétel a fordulónapra (pl. elhatárolás).
    expect((await doc("2025-12-31", [L("522", "D", 30000), L("384", "C", 30000)])).statusCode).toBe(201);
    expect((await status()).preview.result).toBe(ft(350000));
  });

  it("feltételek: következő üzleti év, a cég nevének begépelése", async () => {
    expect((await admin.post(`/api/companies/${c}/fiscal-years/${fy2025.id}/close`, { confirmName: "Próba Kft." })).json().error.message).toMatch(/következő üzleti évet/);
    await admin.post(`/api/companies/${c}/fiscal-years`, { startDate: "2026-01-01", endDate: "2026-12-31" });
    const wrong = await admin.post(`/api/companies/${c}/fiscal-years/${fy2025.id}/close`, { confirmName: "Próba" });
    expect(wrong.json().error.fields.confirmName).toMatch(/Próba Kft\./);
  });

  it("évzárás: záró bizonylat, lezárt év, eredmény a 413-on; a kimutatások helyesek", async () => {
    const st = (await admin.post(`/api/companies/${c}/fiscal-years/${fy2025.id}/close`, { confirmName: "Próba Kft." })).json();
    expect(st.fiscalYear).toMatchObject({ status: "CLOSED", retentionUntil: "2033-12-31" });
    expect(st.closingDocuments.map((d: { serialNumber: string }) => d.serialNumber)).toEqual(["ZAR-2025-00001", "NYIT-2026-00001"]);
    // Lezárt évbe nem lehet könyvelni.
    expect((await doc("2025-12-31", [L("522", "D", 1000), L("384", "C", 1000)])).json().error.fields.accountingDate).toMatch(/lezárt/);
    // A lezárt év eredménykimutatása megmarad, a mérlegen az eredmény a D.VII soron.
    const is2025 = (await admin.get(`/api/companies/${c}/reports/income-statement?from=2025-01-01&to=2025-12-31`)).json();
    expect(line(is2025, "D")).toBe(350000);
    const b2025 = await bs("2025-12-31");
    expect([line(b2025, "D.VII"), b2025.totals.assets === b2025.totals.sources]).toEqual([350000, true]);
    // Az új évben az eredmény az eredménytartalékban, az előző év oszlopában a tavalyi adat.
    const b2026 = await bs("2026-12-31");
    expect(b2026.lines.find((l: { code: string }) => l.code === "D.IV")).toMatchObject({ value: ft(350000), previous: 0 });
    expect(b2026.lines.find((l: { code: string }) => l.code === "D.VII")).toMatchObject({ value: 0, previous: ft(350000) });
    expect(b2026.totals.assets).toBe(b2026.totals.sources);
    const tb = (await admin.get(`/api/companies/${c}/reports/trial-balance?from=2026-01-01&to=2026-12-31`)).json();
    expect(tb.unclosedPriorResult).toBeNull();
  });

  it("újranyitás (Adminisztrátor, indoklással): a záró és a nyitó bizonylat sztornózva, majd újra zárható", async () => {
    const st = (await admin.post(`/api/companies/${c}/fiscal-years/${fy2025.id}/reopen`, { reason: "Elmaradt szállítói számla" })).json();
    expect(st.fiscalYear.status).toBe("OPEN");
    expect(st.closingDocuments).toEqual([]);
    const b2026 = await bs("2026-12-31");
    expect([line(b2026, "D.IV"), b2026.totals.assets === b2026.totals.sources]).toEqual([350000, true]);
    expect((await doc("2025-12-20", [L("522", "D", 50000), L("384", "C", 50000)])).statusCode).toBe(201);
    await admin.post(`/api/companies/${c}/fiscal-years/${fy2025.id}/start-closing`);
    const again = (await admin.post(`/api/companies/${c}/fiscal-years/${fy2025.id}/close`, { confirmName: "Próba Kft." })).json();
    expect(again.closingDocuments.map((d: { serialNumber: string }) => d.serialNumber)).toEqual(["ZAR-2025-00002", "NYIT-2026-00002"]);
    expect(line(await bs("2026-12-31"), "D.IV")).toBe(300000);
  });
});

describe("nyitó egyenlegek (meglévő cég indítása évközben)", () => {
  let c2: string;
  let a2: Record<string, string>;
  let customer: string;
  let supplier: string;
  beforeAll(async () => {
    c2 = (await createCompany(admin)).id;
    await admin.post(`/api/companies/${c2}/fiscal-years`, { startDate: "2026-01-01", endDate: "2026-12-31" });
    a2 = Object.fromEntries(((await admin.get(`/api/companies/${c2}/accounts`)).json() as Array<{ id: string; number: string }>).map((a) => [a.number, a.id]));
    customer = (await admin.post(`/api/companies/${c2}/partners`, { kind: "CUSTOMER", name: "Vevő Zrt.", taxNumber: nextTaxNumber() })).json().id;
    supplier = (await admin.post(`/api/companies/${c2}/partners`, { kind: "SUPPLIER", name: "Szállító Kft.", taxNumber: nextTaxNumber() })).json().id;
  });
  const B = (n: string, debit: number, credit: number) => ({ accountId: a2[n], debit: ft(debit), credit: ft(credit) });
  const balances = () => [B("384", 1000000, 0), B("311", 254000, 0), B("454", 0, 127000), B("411", 0, 3000000), B("413", 2000000, 0), B("912", 0, 200000), B("522", 73000, 0)];

  it("hibák: nem egyező összesen, nem egyező nyitott tételek", async () => {
    const r = await admin.post(`/api/companies/${c2}/opening-balances`, {
      date: "2026-09-30",
      balances: [...balances().slice(0, -1), B("522", 72000, 0)],
      openItems: [{ accountId: a2["311"], partnerId: customer, externalNumber: "V-9", dueDate: "2026-10-10", amount: ft(250000) }],
    });
    expect(r.statusCode).toBe(422);
    const f = r.json().error.fields;
    expect(f.balances).toMatch(/eltérés: 1\s000\sFt/);
    expect(f["subledger.311"]).toMatch(/nem egyezik/);
    expect(f["subledger.454"]).toMatch(/0\sFt.*127\s000\sFt/);
  });

  it("átvétel: nyitó bizonylatok, a nyitott tételek kiegyenlíthetők, a főkönyvi kivonat egyezik", async () => {
    const r = await admin.post(`/api/companies/${c2}/opening-balances`, {
      date: "2026-09-30",
      balances: balances(),
      openItems: [
        { accountId: a2["311"], partnerId: customer, externalNumber: "V-9", dueDate: "2026-10-10", amount: ft(254000) },
        { accountId: a2["454"], partnerId: supplier, externalNumber: "SZ-77", dueDate: "2026-10-05", amount: ft(127000) },
      ],
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().documents).toEqual(["NYIT-2026-00001", "NYIT-2026-00002", "NYIT-2026-00003"]);
    const open = (await admin.get(`/api/companies/${c2}/open-items`)).json();
    expect(open.items.map((i: { externalNumber: string; open: number }) => [i.externalNumber, i.open / 100])).toEqual([
      ["SZ-77", 127000],
      ["V-9", 254000],
    ]);
    const tb = (await admin.get(`/api/companies/${c2}/reports/trial-balance?from=2026-01-01&to=2026-09-30`)).json();
    const closing = Object.fromEntries(tb.rows.map((x: { number: string; closing: { debit: number; credit: number } }) => [x.number, (x.closing.debit - x.closing.credit) / 100]));
    expect(closing).toMatchObject({ "384": 1000000, "311": 254000, "454": -127000, "411": -3000000, "413": 2000000, "912": -200000, "522": 73000, "491": 0 });
    const rec = (await admin.get(`/api/companies/${c2}/reconciliation?asOf=2026-09-30`)).json();
    expect(rec.rows.every((x: { difference: number }) => x.difference === 0)).toBe(true);
    const is = (await admin.get(`/api/companies/${c2}/reports/income-statement?from=2026-01-01&to=2026-12-31`)).json();
    expect(line(is, "D")).toBe(127000);
  });
});
