import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIso } from "@konyvelo/domain";
import { Client, createCompany, createTestApp, nextTaxNumber, resetDatabase, setupAdmin, type TestContext } from "./helpers";

let ctx: TestContext;
let admin: Client;
let c: string;
let acc: Record<string, string>;
let supplier: string;
let customer: string;
const ft = (n: number) => n * 100;
const today = todayIso();
const day = (n: number) => addDays(today, n);

beforeAll(async () => {
  await resetDatabase();
  ctx = await createTestApp();
  admin = await setupAdmin(ctx.app);
  c = (await createCompany(admin, { cashClosingLimit: ft(40000) })).id;
  const y = today.slice(0, 4);
  // Két üzleti év, hogy a „mai nap ± 40 nap” mindig beleférjen.
  await admin.post(`/api/companies/${c}/fiscal-years`, { startDate: `${Number(y) - 1}-01-01`, endDate: `${Number(y) - 1}-12-31` });
  await admin.post(`/api/companies/${c}/fiscal-years`, { startDate: `${y}-01-01`, endDate: `${y}-12-31` });
  await admin.post(`/api/companies/${c}/fiscal-years`, { startDate: `${Number(y) + 1}-01-01`, endDate: `${Number(y) + 1}-12-31` });
  acc = Object.fromEntries(((await admin.get(`/api/companies/${c}/accounts`)).json() as Array<{ id: string; number: string }>).map((a) => [a.number, a.id]));
  supplier = (await admin.post(`/api/companies/${c}/partners`, { kind: "SUPPLIER", name: "Szállító Kft.", taxNumber: nextTaxNumber() })).json().id;
  customer = (await admin.post(`/api/companies/${c}/partners`, { kind: "CUSTOMER", name: "Vevő Zrt.", taxNumber: nextTaxNumber() })).json().id;
});
afterAll(async () => ctx.close());

const L = (n: string, side: "D" | "C", amount: number) => ({ accountId: acc[n], side, amount: ft(amount) });
async function post(body: Record<string, unknown>) {
  const r = await admin.post(`/api/companies/${c}/documents`, { ...body, post: true });
  expect(r.statusCode, r.body).toBe(201);
  return r.json();
}
const invoice = (ext: string, gross: number, date = day(-20), due = day(-5)) =>
  post({
    docType: "SZSZ", partnerId: supplier, externalNumber: ext, description: `Számla ${ext}`,
    issueDate: date, fulfillmentDate: date, accountingDate: date, dueDate: due,
    lines: [L("529", "D", gross), L("454", "C", gross)],
  });
const payment = (amount: number, settlements: Array<{ itemLineId: string; amount: number }>, date = day(-3)) =>
  admin.post(`/api/companies/${c}/documents`, {
    docType: "BANK", partnerId: supplier, description: "Átutalás", issueDate: date, accountingDate: date,
    lines: [L("454", "D", amount), L("384", "C", amount)], settlements, post: true,
  });
const open = async (q = "") => (await admin.get(`/api/companies/${c}/open-items?partnerId=${supplier}${q}`)).json();
const itemLine = (doc: { lines: Array<{ id: string; accountNumber: string }> }, n = "454") => doc.lines.find((l) => l.accountNumber === n)!.id;

describe("szállítói analitika és kiegyenlítés", () => {
  let inv: { id: string; serialNumber: string; lines: Array<{ id: string; accountNumber: string }> };

  it("a könyvelt számla nyitott tétel, lejárattal", async () => {
    inv = await invoice("A-1", 127000);
    const o = await open();
    expect(o.items).toEqual([expect.objectContaining({ lineId: itemLine(inv), kind: "PAYABLE", open: ft(127000), dueDate: day(-5), daysOverdue: 5 })]);
  });

  it("részfizetés rögzítéskor kiválasztva, majd túlfizetés", async () => {
    const p1 = await payment(100000, [{ itemLineId: itemLine(inv), amount: ft(100000) }]);
    expect(p1.statusCode).toBe(201);
    expect(p1.json().settlements).toEqual([expect.objectContaining({ role: "PAYMENT", amount: ft(100000), otherSerialNumber: inv.serialNumber, source: "ENTRY" })]);
    expect((await open()).items[0]).toMatchObject({ open: ft(27000), settled: ft(100000) });

    const p2 = await payment(30000, [{ itemLineId: itemLine(inv), amount: ft(27000) }]);
    expect(p2.statusCode).toBe(201);
    const o = await open();
    expect(o.items).toEqual([]);
    expect(o.unapplied).toEqual([expect.objectContaining({ unapplied: ft(3000) })]);
    const invView = (await admin.get(`/api/companies/${c}/documents/${inv.id}`)).json();
    expect(invView.settlements.map((s: { role: string; amount: number }) => [s.role, s.amount])).toEqual([
      ["ITEM", ft(100000)],
      ["ITEM", ft(27000)],
    ]);
  });

  it("többet nem lehet kiegyenlíteni, mint a nyitott összeg vagy a fizetés", async () => {
    const inv2 = await invoice("A-2", 5000);
    const tooMuch = await payment(4000, [{ itemLineId: itemLine(inv2), amount: ft(5000) }]);
    expect(tooMuch.statusCode).toBe(422);
    expect(tooMuch.json().error.fields.settlements).toMatch(/több, mint a bizonylaton a 454 számla/);
    const closed = await payment(100, [{ itemLineId: itemLine(inv), amount: ft(100) }]);
    expect(closed.json().error.fields["settlements.0"]).toMatch(/már nem nyitott/);
  });

  it("utólagos párosítás a túlfizetéssel, és bontás", async () => {
    const o = await open();
    const item = o.items.find((i: { externalNumber: string }) => i.externalNumber === "A-2");
    const pay = o.unapplied[0];
    const tooMuch = await admin.post(`/api/companies/${c}/settlements`, { itemLineId: item.lineId, settlingLineId: pay.lineId, amount: ft(3001) });
    expect(tooMuch.json().error.fields.amount).toMatch(/Legfeljebb 3\s000\sFt/);
    const r = await admin.post(`/api/companies/${c}/settlements`, { itemLineId: item.lineId, settlingLineId: pay.lineId, amount: ft(3000) });
    expect(r.statusCode).toBe(201);
    let after = await open();
    expect(after.unapplied).toEqual([]);
    expect(after.items.find((i: { externalNumber: string }) => i.externalNumber === "A-2").open).toBe(ft(2000));
    expect((await admin.delete(`/api/companies/${c}/settlements/${r.json().id}`)).statusCode).toBe(200);
    after = await open();
    expect(after.unapplied[0].unapplied).toBe(ft(3000));
  });

  it("a kifizetett számla sztornója: a számla lezárul, a fizetések újra párosítatlanok", async () => {
    const r = await admin.post(`/api/companies/${c}/documents/${inv.id}/reverse`, { accountingDate: day(-1), reason: "Téves számla" });
    expect(r.statusCode).toBe(201);
    const o = await open();
    expect(o.items.some((i: { lineId: string }) => i.lineId === itemLine(inv))).toBe(false);
    expect(o.unapplied.map((u: { unapplied: number }) => u.unapplied).sort()).toEqual([ft(100000), ft(30000)].sort());
    // A sztornó párosítása nem bontható.
    const invView = (await admin.get(`/api/companies/${c}/documents/${inv.id}`)).json();
    const rev = invView.settlements.find((s: { source: string }) => s.source === "REVERSAL");
    expect((await admin.delete(`/api/companies/${c}/settlements/${rev.id}`)).statusCode).toBe(409);
  });

  it("egyeztetés: a főkönyv és az analitika egyezik (bármely napra)", async () => {
    for (const asOf of [day(-10), day(-2), today]) {
      const rec = (await admin.get(`/api/companies/${c}/reconciliation?asOf=${asOf}`)).json();
      const row454 = rec.rows.find((r: { accountNumber: string }) => r.accountNumber === "454");
      expect(row454.difference, asOf).toBe(0);
    }
    const rec = (await admin.get(`/api/companies/${c}/reconciliation?asOf=${today}`)).json();
    // 454: A-2 nyitott 5 000, párosítatlan fizetések 130 000 → szállítói egyenleg −125 000 (túlfizetés).
    expect(rec.rows.find((r: { accountNumber: string }) => r.accountNumber === "454")).toMatchObject({ ledger: -ft(125000), subledgerBalance: -ft(125000) });
  });
});

describe("vevők, lejárt tételek", () => {
  it("vevőszámla jóváírással kiegyenlítve; a lejárt tétel a teendők között", async () => {
    const inv = await post({
      docType: "VSZ", partnerId: customer, externalNumber: "V-1", description: "Tanácsadás", issueDate: day(-40), fulfillmentDate: day(-40),
      accountingDate: day(-40), dueDate: day(-32), lines: [L("311", "D", 254000), L("912", "C", 200000), L("467", "C", 54000)],
    });
    const todo = (await admin.get(`/api/companies/${c}/todos`)).json();
    expect(todo.overdueReceivables).toEqual({ count: 1, total: ft(254000) });
    const item = (await admin.get(`/api/companies/${c}/open-items?kind=RECEIVABLE`)).json().items[0];
    expect(item).toMatchObject({ daysOverdue: 32, partnerName: "Vevő Zrt." });
    await post({
      docType: "BANK", partnerId: customer, description: "Jóváírás V-1", issueDate: day(-2), accountingDate: day(-2),
      lines: [L("384", "D", 254000), L("311", "C", 254000)], settlements: [{ itemLineId: inv.lines[0].id, amount: ft(254000) }],
    });
    expect((await admin.get(`/api/companies/${c}/todos`)).json().overdueReceivables).toEqual({ count: 0, total: 0 });
    const rec = (await admin.get(`/api/companies/${c}/reconciliation`)).json();
    expect(rec.rows.find((r: { accountNumber: string }) => r.accountNumber === "311")).toMatchObject({ ledger: 0, subledgerBalance: 0, difference: 0 });
  });
});

describe("pénztár", () => {
  const cash = (docType: "PB" | "PK", amount: number, date: string) =>
    admin.post(`/api/companies/${c}/documents`, {
      docType, description: docType === "PB" ? "Készpénzfelvétel" : "Postaköltség", issueDate: date, accountingDate: date,
      lines: docType === "PB" ? [L("381", "D", amount), L("384", "C", amount)] : [L("527", "D", amount), L("381", "C", amount)],
      post: true,
    });

  it("üres pénztárból nem lehet kiadni; a visszadátumozott kiadás sem fordíthatja negatívba", async () => {
    const r = await cash("PK", 1500, day(-6));
    expect(r.statusCode).toBe(422);
    expect(r.json().error.fields.cash).toMatch(/381 pénztár egyenlege negatív lenne .*-1\s500\sFt/);
    expect((await cash("PB", 50000, day(-5))).statusCode).toBe(201);
    expect((await cash("PK", 20000, day(-4))).statusCode).toBe(201);
    // A bevétel előtti napra datált kiadás a korábbi napon negatív egyenleget adna.
    expect((await cash("PK", 100, day(-6))).statusCode).toBe(422);
  });

  it("pénztárjelentés futó egyenleggel; a maximum túllépése a teendők között", async () => {
    const reg = (await admin.get(`/api/companies/${c}/money/${acc["381"]}?from=${day(-10)}&to=${today}`)).json();
    expect(reg).toMatchObject({ opening: 0, closing: ft(30000), limit: ft(40000) });
    expect(reg.rows.map((r: { debit: number; credit: number; balance: number }) => [r.debit, r.credit, r.balance])).toEqual([
      [ft(50000), 0, ft(50000)],
      [0, ft(20000), ft(30000)],
    ]);
    expect(reg.days).toEqual([
      { date: day(-5), closing: ft(50000), overLimit: true, negative: false },
      { date: day(-4), closing: ft(30000), overLimit: false, negative: false },
    ]);
    const todo = (await admin.get(`/api/companies/${c}/todos`)).json();
    expect(todo.cashOverLimit).toEqual([expect.objectContaining({ date: day(-5), closing: ft(50000), limit: ft(40000) })]);
  });
});
