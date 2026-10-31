import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  INBOUND_PATH,
  LINK_PATH,
  RECONCILE_PATH,
  RECONCILE_RESULT_PATH,
  signedHeaders,
  verifySignature,
  type EventEnvelope,
  type InboundResult,
  type KonyveloAnswer,
  type ReconcileReport,
  type ReconcileResult,
} from "@konyvelo/esemenyek";
import { createCompany, createTestApp, login, nextTaxNumber, ownerQuery, PASSWORD, resetDatabase, setupAdmin, type Client, type TestContext } from "./helpers";

/**
 * Egyeztető ellenőrzések a Könyvelőben (I4.2, TERV.md F16): a központ kérdésére adott számok valódi
 * könyvelésből, az eredmény fogadása és a Teendők, a nyitó különbség elfogadása. A központ helyett egy
 * helyi ál-központ (HTTP, aláírás-ellenőrzéssel); semmi nem megy ki a hálózatra.
 */

const SECRET = "konyvelo-kozpont-teszt-titok-0123456789abcdef";
let ctx: TestContext;
let admin: Client;
let companyId: string;
let acc: Record<string, string>;
let supplierTax: string;
const c = () => `/api/companies/${companyId}`;

/** Az ál-központ: a Könyvelő aláírt kéréseit ellenőrzi, és a teszt által megadott választ adja. */
const fakeHub = {
  server: null as Server | null,
  calls: [] as Array<{ path: string; body: Record<string, unknown> }>,
  reply: null as null | ((path: string, body: Record<string, unknown>) => { status: number; body: unknown }),
};

function hub(method: "POST", path: string, body: unknown) {
  const text = JSON.stringify(body);
  return ctx.app.inject({ method, url: path, headers: { "content-type": "application/json", ...signedHeaders(SECRET, "kozpont", method, path, text) }, payload: text });
}

let seq = 0;
function keszletEvent(type: string, version: number, recordType: string, recordId: string, payload: Record<string, unknown>): EventEnvelope {
  return {
    id: randomUUID(),
    type,
    version,
    source: { module: "keszlet", companyRef: "keszlet-ceg-1", recordType, recordId, sequence: 1, url: `/${recordType}/${recordId}`, label: `${recordType} ${recordId}` },
    occurredAt: new Date(Date.UTC(2026, 10, 2, 8, 0, seq++)).toISOString(),
    payload,
  };
}

const purchase = (id: string, net = 200_000_00) =>
  keszletEvent("keszlet.beszerzes.veglegesitve", 2, "beszerzes", id, {
    purchaseId: id,
    receivedDate: "2026-11-02",
    invoiceDate: "2026-11-02",
    fulfillmentDate: "2026-11-02",
    invoiceNumber: `SZ-${id}`,
    supplier: { name: "Ajtó Kft.", taxNumber: supplierTax },
    lines: [{ productId: "P1", productName: "Bejárati ajtó", quantity: 2, unit: "db", netAmount: net, vatRate: 27, vatAmount: Math.round(net * 0.27) }],
    totals: { net, vat: Math.round(net * 0.27), gross: net + Math.round(net * 0.27) },
  });

const sale = (id: string, cost = 100_000_00) =>
  keszletEvent("keszlet.eladas.veglegesitve", 2, "eladas", id, {
    saleId: id,
    date: "2026-11-03",
    customer: null,
    cash: true,
    invoiceNumber: null,
    costOfGoods: cost,
    lines: [{ productId: "P1", productName: "Bejárati ajtó", quantity: 1, unit: "db", netAmount: 150_000_00, vatRate: 27, vatAmount: 40_500_00 }],
    totals: { net: 150_000_00, vat: 40_500_00, gross: 190_500_00 },
  });

async function deliver(e: EventEnvelope): Promise<InboundResult> {
  const r = await hub("POST", INBOUND_PATH, { event: e, targetCompanyRef: companyId });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}

async function ask(over: Record<string, unknown> = {}): Promise<KonyveloAnswer> {
  const r = await hub("POST", RECONCILE_PATH, { runId: randomUUID(), companyRef: companyId, asOf: "2026-11-30", from: "2026-11-01", to: "2026-11-30", events: [], keys: [], ...over });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}

const result = (check: ReconcileResult["check"], status: ReconcileResult["status"], over: Partial<ReconcileResult> = {}): ReconcileResult => ({
  check,
  status,
  title: `${check}: ${status}`,
  detail: null,
  diff: null,
  explained: null,
  unexplained: null,
  tolerance: null,
  baselineProposal: null,
  items: [],
  ...over,
});

const report = (runId: string, at: string, results: ReconcileResult[]): ReconcileReport => ({ runId, companyRef: companyId, at, asOf: "2026-11-30", from: "2026-11-01", to: "2026-11-30", results });

const todos = async () =>
  ((await admin.get(`${c()}/integration/todos`)).json() as Array<{ kind: string; title: string; detail: string | null }>).filter((t) => t.kind === "RECONCILIATION");

beforeAll(async () => {
  await resetDatabase();
  fakeHub.server = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      const check = verifySignature(req.headers, req.method!, req.url!, body, (s) => (s === "konyvelo" ? SECRET : null));
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (!check.ok) return send(401, { code: check.code, message: check.message });
      const parsed = JSON.parse(body || "{}") as Record<string, unknown>;
      fakeHub.calls.push({ path: req.url!, body: parsed });
      const r = fakeHub.reply?.(req.url!, parsed) ?? { status: 404, body: { code: "NOT_FOUND", message: "nincs ilyen" } };
      send(r.status, r.body);
    });
  });
  await new Promise<void>((resolve) => fakeHub.server!.listen(0, "127.0.0.1", resolve));
  const port = (fakeHub.server.address() as AddressInfo).port;
  ctx = await createTestApp({ hub: { url: `http://127.0.0.1:${port}`, secret: SECRET } });
  admin = await setupAdmin(ctx.app);
  const taxNumber = nextTaxNumber();
  companyId = (await createCompany(admin, { taxNumber })).id;
  await admin.post(`${c()}/fiscal-years`, { startDate: "2026-01-01", endDate: "2026-12-31" });
  acc = Object.fromEntries(((await admin.get(`${c()}/accounts`)).json() as Array<{ id: string; number: string }>).map((a) => [a.number, a.id]));
  supplierTax = nextTaxNumber();
  await admin.post(`${c()}/partners`, { kind: "SUPPLIER", name: "Ajtó Kft.", taxNumber: supplierTax });
  const code = (await admin.post(`${c()}/integration/link-code`)).json().code as string;
  expect((await hub("POST", LINK_PATH, { code, taxNumber })).statusCode).toBe(200);
  await ownerQuery("UPDATE integration_settings SET purchase_date_rule = 'RECEIVED' WHERE company_id = $1", [companyId]);
});
async function stopFakeHub() {
  const srv = fakeHub.server;
  fakeHub.server = null;
  if (!srv) return;
  srv.closeAllConnections();
  await new Promise((r) => srv.close(r));
}
afterAll(async () => {
  await ctx.close();
  await stopFakeHub();
});

describe("a Könyvelő számai a központ kérdésére (E1–E6 könyvelési oldala)", () => {
  let p1: string;
  let p1Event: EventEnvelope;

  it("aláírás nélkül nem válaszol; összekapcsolatlan cégre sem", async () => {
    const r = await ctx.app.inject({ method: "POST", url: RECONCILE_PATH, headers: { "content-type": "application/json" }, payload: "{}" });
    expect(r.statusCode).toBe(401);
    const other = await hub("POST", RECONCILE_PATH, { runId: randomUUID(), companyRef: randomUUID(), asOf: "2026-11-30", from: "2026-11-01", to: "2026-11-30", events: [], keys: [] });
    expect(other.statusCode).toBe(409);
  });

  it("jóváhagyásra váró beszerzés: magyarázó tétel (a 261-re gyakorolt hatásával), a várt összeg rögzítve", async () => {
    p1Event = purchase("B1");
    p1 = (await deliver(p1Event)).target!.recordId;
    const unknown = randomUUID();
    const a = await ask({ events: [p1Event.id, unknown] });
    expect(a).toMatchObject({
      module: "konyvelo",
      inventoryBalance: 0,
      cogsTurnover: 0,
      postedCount: { inventory: 0, cogs: 0 },
      pending: { count: 1, inventory: 200_000_00, cogs: 0 },
      missingEvents: [unknown],
    });
    expect(a.records).toEqual([
      expect.objectContaining({ eventId: p1Event.id, kind: "PURCHASE", sourceRecordType: "beszerzes", sourceRecordId: "B1", status: "DRAFT", amount: 254_000_00, expectedAmount: 254_000_00 }),
    ]);
  });

  it("könyvelés után: a 261 egyenlege, a darabszám a tűréshez, és a nyitott szállítói tartozás (E4)", async () => {
    expect((await admin.post(`${c()}/documents/${p1}/post`)).statusCode).toBe(200);
    const a = await ask();
    expect(a).toMatchObject({ inventoryBalance: 200_000_00, postedCount: { inventory: 1, cogs: 0 }, pending: { count: 0, inventory: 0 } });
    expect(a.records[0]).toMatchObject({ status: "POSTED", amount: 254_000_00, expectedAmount: 254_000_00 });
    expect(a.paid).toEqual([expect.objectContaining({ sourceRecordType: "beszerzes", sourceRecordId: "B1", documentId: p1, open: 254_000_00 })]);
  });

  it("ELÁBÉ: piszkozatként magyarázott, könyvelve a 814 forgalma; a kért időszakon kívül nem számít", async () => {
    const cogsDoc = (await ownerQuery("SELECT document_id FROM integration_records WHERE kind = 'COGS' AND source_record_id = $1", ["E1"])).rows[0];
    expect(cogsDoc).toBeUndefined();
    await deliver(sale("E1"));
    const id = (await ownerQuery("SELECT document_id FROM integration_records WHERE kind = 'COGS' AND source_record_id = 'E1'")).rows[0]!.document_id as string;
    let a = await ask();
    expect(a.pending).toMatchObject({ count: 1, inventory: -100_000_00, cogs: 100_000_00 });
    expect((await admin.post(`${c()}/documents/${id}/post`)).statusCode).toBe(200);
    a = await ask();
    expect(a).toMatchObject({ inventoryBalance: 100_000_00, cogsTurnover: 100_000_00, postedCount: { inventory: 2, cogs: 1 }, pending: { count: 0 } });
    expect((await ask({ from: "2026-12-01", to: "2026-12-31" })).cogsTurnover).toBe(0);
  });

  it("kézi könyvelés a 261-re: benne van az egyenlegben, de nem automatikus bizonylat (a tűrést nem növeli)", async () => {
    const r = await admin.post(`${c()}/documents`, {
      docType: "VEGY", description: "Kézi átvezetés", issueDate: "2026-11-10", accountingDate: "2026-11-10", post: true,
      lines: [{ accountId: acc["261"], side: "D", amount: 5_000_00 }, { accountId: acc["479"], side: "C", amount: 5_000_00 }],
    });
    expect(r.statusCode, r.body).toBe(201);
    const a = await ask();
    expect(a).toMatchObject({ inventoryBalance: 105_000_00, postedCount: { inventory: 2, cogs: 1 } });
    // Egy korábbi napra (a kézi könyvelés előtt) a régi egyenleg.
    expect((await ask({ asOf: "2026-11-05" })).inventoryBalance).toBe(100_000_00);
  });

  it("a jóváhagyó 1 Ft-tal módosította a piszkozatot könyvelés előtt: a könyvelt és a várt összeg eltér (E3)", async () => {
    const id = (await deliver(purchase("B2", 10_000_00))).target!.recordId;
    await ownerQuery("UPDATE journal_lines SET amount = amount + 100 WHERE document_id = $1 AND account_id IN ($2, $3)", [id, acc["261"], acc["454"]]);
    expect((await admin.post(`${c()}/documents/${id}/post`)).statusCode).toBe(200);
    const rec = (await ask()).records.find((r) => r.sourceRecordId === "B2")!;
    expect(rec).toMatchObject({ status: "POSTED", amount: 12_700_00 + 100, expectedAmount: 12_700_00 });
  });

  it("a törölt piszkozat „törölt”, a sztornózott bizonylat „sztornózva” (E6)", async () => {
    const b3 = purchase("B3", 1_000_00);
    const id = (await deliver(b3)).target!.recordId;
    expect((await admin.delete(`${c()}/documents/${id}`)).statusCode).toBe(200);
    const st = await admin.post(`${c()}/documents/${p1}/reverse`, { accountingDate: "2026-11-20", reason: "Teszt" });
    expect(st.statusCode, st.body).toBe(201);
    // A törölt piszkozatnak se bizonylata, se dátuma: a központ az átadott esemény azonosítójával kérdez rá.
    expect((await ask()).records.find((r) => r.sourceRecordId === "B3")).toBeUndefined();
    const a = await ask({ events: [b3.id] });
    expect(a.records.find((r) => r.sourceRecordId === "B3")).toMatchObject({ status: "DELETED", documentId: null, expectedAmount: 1_270_00 });
    expect(a.records.find((r) => r.sourceRecordId === "B1")).toMatchObject({ status: "REVERSED" });
    expect(a.paid.find((p) => p.sourceRecordId === "B1")).toBeUndefined();
  });

  it("a hiányzó számla-hozzárendelés: nem válaszol számokkal, megmondja az okát", async () => {
    await ownerQuery("UPDATE integration_settings SET cogs_account_id = NULL WHERE company_id = $1", [companyId]);
    const r = await hub("POST", RECONCILE_PATH, { runId: randomUUID(), companyRef: companyId, asOf: "2026-11-30", from: "2026-11-01", to: "2026-11-30", events: [], keys: [] });
    expect(r.statusCode).toBe(409);
    expect(r.json().message).toContain("ELÁBÉ-számla");
    await ownerQuery("UPDATE integration_settings SET cogs_account_id = $2 WHERE company_id = $1", [companyId, acc["814"]]);
  });
});

describe("az eredmény fogadása és a Teendők", () => {
  const run1 = randomUUID();

  it("a nem rendben lévő ellenőrzésből Teendő lesz (a tételekkel), a rendben lévőé lezárul; a „nem futott” nem zár le", async () => {
    const r = await hub("POST", RECONCILE_RESULT_PATH, report(run1, "2026-11-30T01:31:00.000Z", [
      result("E1", "NYITO_ELFOGADASRA_VAR", { title: "Készletérték: nyitó eltérés 5 000 Ft", baselineProposal: -5_000_00 }),
      result("E3", "ELTERES", { title: "Párosított tételek összege: 1 bizonylat összege eltér", items: [{ label: "SZSZ-2: eltérés 1 Ft", recordType: "beszerzes", recordId: "B2", documentId: null, serialNumber: null, amount: 100, note: null }] }),
      result("E5", "RENDBEN"),
    ]));
    expect(r.statusCode, r.body).toBe(200);
    let t = await todos();
    expect(t.map((x) => x.title).sort()).toEqual(["Készletérték: nyitó eltérés 5 000 Ft", "Párosított tételek összege: 1 bizonylat összege eltér"]);
    expect(t.find((x) => x.title.startsWith("Párosított"))!.detail).toContain("• SZSZ-2: eltérés 1 Ft");
    // A Kezdőlap Teendői között is látszik.
    const home = (await admin.get(`${c()}/todos`)).json() as { integration: { todos: Array<{ kind: string }> } };
    expect(home.integration.todos.filter((x) => x.kind === "RECONCILIATION")).toHaveLength(2);

    // Egy régebbi kör eredménye nem írja felül az újabbat.
    await hub("POST", RECONCILE_RESULT_PATH, report(randomUUID(), "2026-11-29T01:31:00.000Z", [result("E3", "RENDBEN")]));
    expect(await todos()).toHaveLength(2);

    // Újabb kör: E3 rendben (lezárul), E1 nem futott (marad).
    await hub("POST", RECONCILE_RESULT_PATH, report(randomUUID(), "2026-12-01T01:31:00.000Z", [result("E1", "NEM_FUTOTT"), result("E3", "RENDBEN")]));
    t = await todos();
    expect(t.map((x) => x.title)).toEqual(["Készletérték: nyitó eltérés 5 000 Ft"]);
    // Kézzel nem zárható le: a következő rendben lévő ellenőrzés zárja.
    const id = ((await admin.get(`${c()}/integration/todos`)).json() as Array<{ id: string; kind: string }>).find((x) => x.kind === "RECONCILIATION")!.id;
    expect((await admin.post(`${c()}/integration/todos/${id}/resolve`)).statusCode).toBe(409);
  });

  it("hibás eredményt nem fogad el", async () => {
    const r = await hub("POST", RECONCILE_RESULT_PATH, { runId: "x", companyRef: companyId });
    expect(r.statusCode).toBe(422);
  });
});

describe("a felület: ellenőrzés most, nyitó különbség elfogadása", () => {
  it("ellenőrzés most: a központ futtatja, az eredmény eltárolódik", async () => {
    const runId = randomUUID();
    fakeHub.reply = (path, body) =>
      path === "/api/v1/modul/egyeztetes"
        ? { status: 200, body: report(runId, "2026-12-02T09:00:00.000Z", [result("E1", "NYITO_ELFOGADASRA_VAR", { title: "Készletérték: nyitó eltérés", baselineProposal: -5_000_00 })]) }
        : { status: 404, body: { message: String(body) } };
    const r = await admin.post(`${c()}/integration/reconciliation/run`);
    expect(r.statusCode, r.body).toBe(200);
    expect(fakeHub.calls.at(-1)).toEqual({ path: "/api/v1/modul/egyeztetes", body: { companyRef: companyId } });
    const view = (await admin.get(`${c()}/integration/reconciliation`)).json();
    expect(view).toMatchObject({ canAcceptBaseline: true, hubConfigured: true, report: { runId, results: [expect.objectContaining({ check: "E1", baselineProposal: -5_000_00 })] } });
  });

  it("nyitó különbség: csak adminisztrátor / vezető könyvelő, indoklással, a legutóbbi eredményre; a központ dönt, az audit naplóba is bekerül", async () => {
    const view = (await admin.get(`${c()}/integration/reconciliation`)).json();
    const runId = view.report.runId as string;
    await admin.post(`${c()}/members`, { email: "kata@example.hu", name: "Könyvelő Kata", role: "ACCOUNTANT", initialPassword: PASSWORD });
    const kata = await login(ctx.app, "kata@example.hu");
    expect((await kata.get(`${c()}/integration/reconciliation`)).json().canAcceptBaseline).toBe(false);
    expect((await kata.post(`${c()}/integration/reconciliation/baseline`, { runId, amount: -5_000_00, reason: "Nyitó készlet a leltár szerint." })).statusCode).toBe(403);
    expect((await admin.post(`${c()}/integration/reconciliation/baseline`, { runId, amount: -5_000_00, reason: "ok" })).statusCode).toBe(422);
    expect((await admin.post(`${c()}/integration/reconciliation/baseline`, { runId: randomUUID(), amount: -5_000_00, reason: "Nyitó készlet a leltár szerint." })).statusCode).toBe(409);

    // A központ elutasítja (pl. azóta újabb kör futott): a hibaüzenete jut el a felhasználóhoz.
    fakeHub.reply = () => ({ status: 409, body: { code: "STALE", message: "Azóta újabb ellenőrzés futott." } });
    const stale = await admin.post(`${c()}/integration/reconciliation/baseline`, { runId, amount: -5_000_00, reason: "Nyitó készlet a leltár szerint." });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.message).toContain("újabb ellenőrzés");

    fakeHub.reply = (path, body) =>
      path === "/api/v1/modul/egyeztetes/nyito"
        ? { status: 200, body: report(runId, "2026-12-02T09:00:00.000Z", [result("E1", "RENDBEN", { title: `Készletérték: a nyitó különbség elfogadva (${String(body.acceptedBy)})` })]) }
        : { status: 404, body: {} };
    const ok = await admin.post(`${c()}/integration/reconciliation/baseline`, { runId, amount: -5_000_00, reason: "Nyitó készlet a leltár szerint." });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(fakeHub.calls.at(-1)!.body).toEqual({ companyRef: companyId, runId, amount: -5_000_00, reason: "Nyitó készlet a leltár szerint.", acceptedBy: "Admin Anna (Adminisztrátor)" });
    expect(ok.json().report.results[0]).toMatchObject({ status: "RENDBEN" });
    expect(await todos()).toEqual([]);
    const audit = await ownerQuery("SELECT after FROM audit_log WHERE action = 'integration.reconciliation_baseline'");
    expect(audit.rows[0]!.after).toMatchObject({ runId, amount: -5_000_00 });
  });

  it("ha a központ nem érhető el, érthető hibát ad", async () => {
    fakeHub.reply = null;
    await stopFakeHub();
    const r = await admin.post(`${c()}/integration/reconciliation/run`);
    expect(r.statusCode).toBe(503);
    expect(r.json().error.message).toContain("központ most nem érhető el");
  });
});
