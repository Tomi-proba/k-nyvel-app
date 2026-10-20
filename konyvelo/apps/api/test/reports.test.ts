import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, createCompany, createTestApp, nextTaxNumber, resetDatabase, setupAdmin, type TestContext } from "./helpers";

let ctx: TestContext;
let admin: Client;
let c: string;
let acc: Record<string, string>;
let supplier: string;
const ft = (n: number) => n * 100;
const url = (path: string) => `/api/companies/${c}/reports/${path}`;

beforeAll(async () => {
  await resetDatabase();
  ctx = await createTestApp();
  admin = await setupAdmin(ctx.app);
  c = (await createCompany(admin)).id;
  await admin.post(`/api/companies/${c}/fiscal-years`, { startDate: "2025-01-01", endDate: "2025-12-31" });
  await admin.post(`/api/companies/${c}/fiscal-years`, { startDate: "2026-01-01", endDate: "2026-12-31" });
  acc = Object.fromEntries(((await admin.get(`/api/companies/${c}/accounts`)).json() as Array<{ id: string; number: string }>).map((a) => [a.number, a.id]));
  supplier = (await admin.post(`/api/companies/${c}/partners`, { kind: "SUPPLIER", name: "Irodaház Kft.", taxNumber: nextTaxNumber() })).json().id;
  const customer = (await admin.post(`/api/companies/${c}/partners`, { kind: "CUSTOMER", name: "Ügyfél Zrt.", taxNumber: nextTaxNumber() })).json().id;
  const L = (n: string, side: "D" | "C", amount: number) => ({ accountId: acc[n], side, amount: ft(amount) });
  const post = async (date: string, body: Record<string, unknown>) => {
    const r = await admin.post(`/api/companies/${c}/documents`, { docType: "VEGY", issueDate: date, accountingDate: date, ...body, post: true });
    expect(r.statusCode, r.body).toBe(201);
  };
  // 2025: alapítás és egy bevétel (előző év).
  await post("2025-03-01", { description: "Jegyzett tőke befizetése", lines: [L("384", "D", 3000000), L("411", "C", 3000000)] });
  await post("2025-11-10", { description: "Szolgáltatás 2025", lines: [L("384", "D", 50000), L("911", "C", 50000)] });
  // 2026: az öt valós példa.
  await post("2026-10-01", { docType: "SZSZ", partnerId: supplier, externalNumber: "IH-101", description: "Irodabérlet", fulfillmentDate: "2026-10-01", lines: [L("522", "D", 100000), L("466", "D", 27000), L("454", "C", 127000)] });
  await post("2026-10-05", { docType: "VSZ", partnerId: customer, externalNumber: "2026/1", description: "Tanácsadás", fulfillmentDate: "2026-10-05", lines: [L("311", "D", 254000), L("912", "C", 200000), L("467", "C", 54000)] });
  await post("2026-10-10", { docType: "BANK", partnerId: supplier, description: "Kifizetés", lines: [L("454", "D", 127000), L("384", "C", 127000)] });
  await post("2026-10-15", { docType: "BANK", partnerId: customer, description: "Jóváírás", lines: [L("384", "D", 254000), L("311", "C", 254000)] });
  await post("2026-10-31", { docType: "BANK", description: "Bankköltség", lines: [L("532", "D", 2350), L("384", "C", 2350)] });
});
afterAll(async () => ctx.close());

const byCode = (lines: Array<{ code: string; value: number; previous: number | null }>) => Object.fromEntries(lines.map((l) => [l.code, [l.value / 100, l.previous === null ? null : l.previous / 100]]));

describe("kimutatások", () => {
  it("főkönyvi kivonat: Σ tartozik = Σ követel minden oszlopban; nyitó = előző évek mérlegszámláinak egyenlege", async () => {
    const tb = (await admin.get(url("trial-balance?from=2026-10-01&to=2026-10-31"))).json();
    for (const k of ["opening", "period", "cumulative", "closing"]) expect(tb.totals[k].debit, k).toBe(tb.totals[k].credit);
    const bank = tb.rows.find((r: { number: string }) => r.number === "384");
    expect(bank).toMatchObject({ opening: { debit: ft(3050000), credit: 0 }, period: { debit: ft(254000), credit: ft(129350) }, closing: { debit: ft(3174650), credit: 0 } });
    // Az eredményszámla (911) a 2025. évi forgalmát nem hozza át.
    expect(tb.rows.some((r: { number: string }) => r.number === "911")).toBe(false);
    // A 2025. évi, még le nem zárt 50 000 Ft nyereség külön sorban (követel), így a nyitó oszlop is egyezik.
    expect(tb.unclosedPriorResult).toEqual({ debit: 0, credit: ft(50000) });
    expect(tb.classTotals.map((x: { accountClass: number }) => x.accountClass)).toEqual([3, 4, 5, 9]);
    const bad = await admin.get(url("trial-balance?from=2025-12-01&to=2026-10-31"));
    expect(bad.json().error.fields.from).toMatch(/üzleti éven belül/);
  });

  it("naplófőkönyv: minden könyvelt tétel időrendben, egyező összesennel", async () => {
    const j = (await admin.get(url("journal?from=2026-01-01&to=2026-12-31"))).json();
    expect(j.rows).toHaveLength(12);
    expect(j.totals).toEqual({ debit: ft(764350), credit: ft(764350) });
    expect(j.rows[0]).toMatchObject({ date: "2026-10-01", accountNumber: "522", debit: ft(100000) });
  });

  it("karton: számla és partner futó egyenleggel", async () => {
    const k = (await admin.get(url(`ledger?accountId=${acc["454"]}&from=2026-01-01&to=2026-12-31`))).json();
    expect(k.rows.map((r: { balance: number }) => r.balance / 100)).toEqual([-127000, 0]);
    const p = (await admin.get(url(`ledger?partnerId=${supplier}&from=2026-01-01&to=2026-12-31`))).json();
    expect(p).toMatchObject({ partner: { name: "Irodaház Kft." }, closing: 0, totals: { debit: ft(127000), credit: ft(127000) } });
  });

  it("eredménykimutatás: tárgyév és előző év", async () => {
    const is = (await admin.get(url("income-statement?from=2026-01-01&to=2026-12-31"))).json();
    const v = byCode(is.lines);
    expect(v).toMatchObject({ I: [200000, 50000], IV: [102350, 0], "IV.06": [100000, 0], A: [97650, 50000], D: [97650, 50000] });
    expect(is.previous).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("mérleg: eszközök = források mindkét évben; a tárgyévi eredmény D.VII, az előző évi D.IV", async () => {
    const bs = (await admin.get(url("balance-sheet?asOf=2026-12-31"))).json();
    const v = byCode(bs.lines);
    expect(v).toMatchObject({ "B.II": [27000, 0], "B.IV": [3174650, 3050000], "D.I": [3000000, 3000000], "D.IV": [50000, 0], "D.VII": [97650, 50000], "F.III": [54000, 0] });
    expect(bs.totals).toEqual({ assets: ft(3201650), sources: ft(3201650), previousAssets: ft(3050000), previousSources: ft(3050000) });
    expect(bs.unmapped).toEqual([]);
    expect(bs.company).toMatchObject({ audited: false });
  });

  it("kimutatássor nélküli számla egyenlege külön jelenik meg", async () => {
    const created = (await admin.post(`/api/companies/${c}/accounts`, { number: "3899", name: "Ideiglenes számla" })).json();
    await admin.patch(`/api/companies/${c}/accounts/${created.id}`, { bsLineDebit: null });
    const r = await admin.post(`/api/companies/${c}/documents`, {
      docType: "VEGY", description: "Átvezetés", issueDate: "2026-11-02", accountingDate: "2026-11-02",
      lines: [{ accountId: created.id, side: "D", amount: ft(1000) }, { accountId: acc["384"], side: "C", amount: ft(1000) }], post: true,
    });
    expect(r.statusCode).toBe(201);
    const bs = (await admin.get(url("balance-sheet?asOf=2026-12-31"))).json();
    expect(bs.unmapped).toEqual([{ number: "3899", name: "Ideiglenes számla", amount: ft(1000) }]);
    expect(bs.totals.assets).toBe(bs.totals.sources - ft(1000));
  });
});
