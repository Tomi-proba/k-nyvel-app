import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { INBOUND_PATH, LINK_PATH, signedHeaders, validateEvent, type EventEnvelope, type HubClient, type InboundResult } from "@konyvelo/esemenyek";
import type { ApprovalGroupDto, ApprovalResultDto, DocumentDto, IntegrationStatusDto } from "@konyvelo/shared";
import { refreshHealthTodos, relayOnce } from "../src/modules/integration/relay";
import { postDocument } from "../src/modules/documents";
import { SYSTEM_USER } from "../src/modules/integration/inbound";
import { createCompany, createTestApp, nextTaxNumber, ownerQuery, resetDatabase, setupAdmin, type Client, type TestContext } from "./helpers";

/**
 * Integráció (I2, TERV.md F14): a Könyvelő a központ helyett egy ál-központtal. A központ felőli kéréseket
 * a teszt írja alá (ugyanazzal a sémával, mint a valódi központ); az átadó egy memóriabeli ál-klienssel fut.
 * Semmilyen kérés nem megy ki a hálózatra.
 */

const SECRET = "konyvelo-kozpont-teszt-titok-0123456789abcdef";
let ctx: TestContext;
let admin: Client;
let companyId: string;
let taxNumber: string;
let acc: Record<string, string>;
let supplier: { id: string; taxNumber: string };
let customer: { id: string; taxNumber: string };
const c = () => `/api/companies/${companyId}`;

/** Kérés a központ nevében (aláírva). */
function hub(method: "POST" | "DELETE", path: string, body?: unknown, opts: { secret?: string; headers?: Record<string, string> } = {}) {
  const text = body === undefined ? "" : JSON.stringify(body);
  const headers = { "content-type": "application/json", ...signedHeaders(opts.secret ?? SECRET, "kozpont", method, path, text), ...opts.headers };
  return ctx.app.inject({ method, url: path, headers, ...(text ? { payload: text } : {}) });
}

let seq = 0;
function keszletEvent(type: string, version: number, recordType: string, recordId: string, payload: Record<string, unknown>, sequence = 1): EventEnvelope {
  return {
    id: randomUUID(),
    type,
    version,
    source: { module: "keszlet", companyRef: "keszlet-ceg-1", recordType, recordId, sequence, url: `/${recordType}/${recordId}`, label: `${recordType} ${recordId}` },
    occurredAt: new Date(Date.UTC(2026, 10, 2, 8, 0, seq++)).toISOString(),
    payload,
  };
}

const purchaseEvent = (id: string, over: Record<string, unknown> = {}) =>
  keszletEvent("keszlet.beszerzes.veglegesitve", 2, "beszerzes", id, {
    purchaseId: id,
    receivedDate: "2026-11-02",
    invoiceDate: "2026-11-02",
    fulfillmentDate: "2026-11-02",
    invoiceNumber: `SZ-${id}`,
    supplier: { name: "Ajtó Kft.", taxNumber: supplier.taxNumber },
    lines: [{ productId: "P1", productName: "Bejárati ajtó", quantity: 2, unit: "db", netAmount: 200_000_00, vatRate: 27, vatAmount: 54_000_00 }],
    totals: { net: 200_000_00, vat: 54_000_00, gross: 254_000_00 },
    ...over,
  });

const saleEvent = (id: string, over: Record<string, unknown> = {}) =>
  keszletEvent("keszlet.eladas.veglegesitve", 2, "eladas", id, {
    saleId: id,
    date: "2026-11-03",
    customer: { name: "Ügyfél Zrt.", taxNumber: customer.taxNumber },
    cash: false,
    invoiceNumber: null,
    costOfGoods: 100_000_00,
    lines: [{ productId: "P1", productName: "Bejárati ajtó", quantity: 1, unit: "db", netAmount: 150_000_00, vatRate: 27, vatAmount: 40_500_00 }],
    totals: { net: 150_000_00, vat: 40_500_00, gross: 190_500_00 },
    ...over,
  });

const withdrawEvent = (kind: "PURCHASE" | "SALE", recordType: string, id: string, date = "2026-11-04") =>
  keszletEvent("keszlet.mozgas.sztornozva", 2, recordType, id, { movementKind: kind, movementId: id, date, reason: "Téves rögzítés" }, 2);

async function deliver(event: EventEnvelope): Promise<InboundResult> {
  const r = await hub("POST", INBOUND_PATH, { event, targetCompanyRef: companyId });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}

async function link() {
  const code = (await admin.post(`${c()}/integration/link-code`)).json().code as string;
  const r = await hub("POST", LINK_PATH, { code, taxNumber });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}

const outbox = async () => (await ownerQuery("SELECT envelope, sent_at FROM integration_outbox ORDER BY created_at, id")).rows.map((r) => r.envelope as EventEnvelope);
const todos = async () => (await admin.get(`${c()}/integration/todos`)).json() as Array<{ id: string; kind: string; title: string; documentId: string | null }>;
const settings = (over: Record<string, unknown> = {}) => ownerQuery(`UPDATE integration_settings SET ${Object.keys(over).map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE company_id = $1`, [companyId, ...Object.values(over)]);
const doc = async (id: string) => (await admin.get(`${c()}/documents/${id}`)).json() as DocumentDto;
const doc_ = doc;

/** Memóriabeli ál-központ az átadóhoz. */
class FakeHub implements HubClient {
  received: EventEnvelope[] = [];
  resolved: string[] = [];
  down = false;
  rejectIds = new Set<string>();
  async publish(events: EventEnvelope[]) {
    if (this.down) throw new Error("Az integrációs központ most nem érhető el.");
    const accepted: string[] = [];
    const rejected: Array<{ id: string; error: string }> = [];
    for (const e of events) {
      if (this.rejectIds.has(e.id)) rejected.push({ id: e.id, error: "elutasítva" });
      else {
        if (!this.received.some((x) => x.id === e.id)) this.received.push(e);
        accepted.push(e.id);
      }
    }
    return { accepted, rejected };
  }
  async resolveTodo(_companyRef: string, key: string) {
    if (this.down) throw new Error("nem érhető el");
    this.resolved.push(key);
  }
  async links() {
    return [];
  }
  async reconcileNow(): Promise<never> {
    throw new Error("az egyeztetést a reconcile.test.ts próbálja ki");
  }
  async acceptBaseline(): Promise<never> {
    throw new Error("az egyeztetést a reconcile.test.ts próbálja ki");
  }
}

beforeAll(async () => {
  await resetDatabase();
  ctx = await createTestApp({ hub: { url: "http://127.0.0.1:9", secret: SECRET } });
  admin = await setupAdmin(ctx.app);
  taxNumber = nextTaxNumber();
  companyId = (await createCompany(admin, { taxNumber })).id;
  await admin.post(`${c()}/fiscal-years`, { startDate: "2026-01-01", endDate: "2026-12-31" });
  acc = Object.fromEntries(((await admin.get(`${c()}/accounts`)).json() as Array<{ id: string; number: string }>).map((a) => [a.number, a.id]));
  const st = nextTaxNumber();
  supplier = { id: (await admin.post(`${c()}/partners`, { kind: "SUPPLIER", name: "Ajtó Kft.", taxNumber: st })).json().id, taxNumber: st };
  const ct = nextTaxNumber();
  customer = { id: (await admin.post(`${c()}/partners`, { kind: "CUSTOMER", name: "Ügyfél Zrt.", taxNumber: ct })).json().id, taxNumber: ct };
});
afterAll(async () => ctx.close());

describe("összekapcsolás (D13) és aláírás", () => {
  it("összekapcsolás előtt nem keletkezik esemény, és bejövőt sem fogad", async () => {
    const r = await admin.post(`${c()}/documents`, {
      docType: "SZSZ", partnerId: supplier.id, externalNumber: "ELOTTE-1", description: "Iroda", issueDate: "2026-10-01", fulfillmentDate: "2026-10-01", accountingDate: "2026-10-01", post: true,
      lines: [{ accountId: acc["529"], side: "D", amount: 1000 }, { accountId: acc["454"], side: "C", amount: 1000 }],
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(await outbox()).toEqual([]);
    expect((await hub("POST", INBOUND_PATH, { event: purchaseEvent("B0"), targetCompanyRef: companyId })).statusCode).toBe(409);
  });

  it("kód nélkül, ismert adószámmal nem köthető össze; rossz, lejárt, felhasznált kód és más adószám elutasítva", async () => {
    expect((await hub("POST", LINK_PATH, { code: "", taxNumber })).statusCode).toBe(422);
    expect((await hub("POST", LINK_PATH, { code: "ABCD-EFGH-JKMN-PQRS", taxNumber })).statusCode).toBe(422);
    const code = (await admin.post(`${c()}/integration/link-code`)).json().code as string;
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    // Más cég adószámával a kód sem elég.
    expect((await hub("POST", LINK_PATH, { code, taxNumber: nextTaxNumber() })).statusCode).toBe(422);
    // Lejárt kód.
    await ownerQuery("UPDATE integration_link_codes SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL AND revoked_at IS NULL");
    expect((await hub("POST", LINK_PATH, { code, taxNumber })).statusCode).toBe(422);
    // A kódot csak a lenyomata őrzi.
    expect((await ownerQuery("SELECT count(*)::int AS n FROM integration_link_codes WHERE code_hash LIKE $1", [`%${code.replace(/-/g, "")}%`])).rows[0].n).toBe(0);
    expect((await admin.get(`${c()}/integration`)).json()).toMatchObject({ hubConfigured: true, linked: false });
  });

  it("aláírás nélkül, rossz titokkal vagy ismételt kéréssel semmi nem megy át", async () => {
    expect((await ctx.app.inject({ method: "POST", url: LINK_PATH, headers: { "content-type": "application/json" }, payload: "{}" })).statusCode).toBe(401);
    expect((await hub("POST", LINK_PATH, { code: "X", taxNumber }, { secret: "rossz-titok-0123456789abcdefghijklmnop" })).statusCode).toBe(401);
    const text = JSON.stringify({ code: "X", taxNumber });
    const headers = { "content-type": "application/json", ...signedHeaders(SECRET, "kozpont", "POST", LINK_PATH, text) };
    expect((await ctx.app.inject({ method: "POST", url: LINK_PATH, headers, payload: text })).statusCode).toBe(422);
    const replay = await ctx.app.inject({ method: "POST", url: LINK_PATH, headers, payload: text });
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toMatchObject({ code: "REPLAYED" });
  });

  it("érvényes kóddal összekapcsol: csak piszkozat mód, bevezető hónap, alapértelmezett számla-hozzárendelés", async () => {
    expect(await link()).toEqual({ companyRef: companyId, companyName: expect.any(String), taxNumber });
    const s = (await admin.get(`${c()}/integration`)).json() as IntegrationStatusDto;
    expect(s).toMatchObject({ linked: true, postingMode: "DRAFT_ONLY", purchaseDateRule: "ASK" });
    expect(s.draftOnlyUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.accounts).toMatchObject({ inventoryAccountId: acc["261"], cogsAccountId: acc["814"], payableAccountId: acc["454"], inputVatAccountId: acc["466"] });
    const audit = await ownerQuery("SELECT action, user_id FROM audit_log WHERE company_id = $1 AND action LIKE 'integration.%' ORDER BY id", [companyId]);
    expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(["integration.link_code", "integration.link"]));
  });
});

describe("kimenő események", () => {
  beforeEach(async () => {
    await ownerQuery("DELETE FROM integration_outbox");
  });

  it("könyvelés, párosítás, sztornó: a típusok, a sorrend és a tartalom helyes, és mind érvényes esemény", async () => {
    const inv = await admin.post(`${c()}/documents`, {
      docType: "SZSZ", partnerId: supplier.id, externalNumber: "KI-1", description: "Iroda", issueDate: "2026-11-02", fulfillmentDate: "2026-11-02", accountingDate: "2026-11-02", post: true,
      lines: [{ accountId: acc["529"], side: "D", amount: 100_000 }, { accountId: acc["466"], side: "D", amount: 27_000 }, { accountId: acc["454"], side: "C", amount: 127_000 }],
    });
    const invoice = inv.json() as DocumentDto;
    const payLine = invoice.lines.find((l) => l.accountId === acc["454"])!.id;
    const pay = await admin.post(`${c()}/documents`, {
      docType: "BANK", partnerId: supplier.id, description: "Kifizetés", issueDate: "2026-11-05", accountingDate: "2026-11-05", post: true,
      lines: [{ accountId: acc["454"], side: "D", amount: 127_000 }, { accountId: acc["384"], side: "C", amount: 127_000 }], settlements: [{ itemLineId: payLine, amount: 127_000 }],
    });
    expect(pay.statusCode, pay.body).toBe(201);
    const rev = await admin.post(`${c()}/documents/${invoice.id}/reverse`, { accountingDate: "2026-11-06", reason: "Téves" });
    expect(rev.statusCode, rev.body).toBe(201);

    const events = await outbox();
    for (const e of events) expect(validateEvent(e).ok, JSON.stringify(e)).toBe(true);
    expect(events.map((e) => `${e.type}@${e.version}#${e.source.sequence}`)).toEqual([
      "konyvelo.bizonylat.konyvelve@2#1",
      "konyvelo.kiegyenlites.rogzitve@3#1",
      "konyvelo.bizonylat.konyvelve@2#1",
      "konyvelo.kiegyenlites.bontva@2#2",
      "konyvelo.bizonylat.sztornozva@1#2",
    ]);
    const [posted, settled, , unpaired, reversed] = events;
    expect(posted!.source).toMatchObject({ module: "konyvelo", companyRef: companyId, recordType: "bizonylat", recordId: invoice.id, url: `/konyveles/${invoice.id}` });
    expect(posted!.payload).toMatchObject({
      serialNumber: invoice.serialNumber, docType: "SZSZ", externalNumber: "KI-1", currency: "HUF", partner: { name: "Ajtó Kft.", taxNumber: supplier.taxNumber }, corrects: null, reverses: null,
      lines: [{ accountNumber: "529", side: "D", amount: 100_000 }, { accountNumber: "466", side: "D", amount: 27_000 }, { accountNumber: "454", side: "C", amount: 127_000, partner: { name: "Ajtó Kft." } }],
    });
    expect(posted!.causedBy).toBeUndefined();
    expect(settled!.payload).toMatchObject({ documentId: pay.json().id, settledDocumentId: invoice.id, amount: 127_000, date: "2026-11-05", itemOpenAfter: 0, settledSources: [] });
    // Sztornó után a tétel nem nyitott (a sztornó zárja), a fogadónak nem kell számolnia.
    expect(unpaired!.payload).toMatchObject({ reason: "REVERSAL", amount: 127_000, itemOpenAfter: 0 });
    expect(reversed!.payload).toMatchObject({ documentId: invoice.id, reversalSerialNumber: expect.stringMatching(/^SZT-/), accountingDate: "2026-11-06" });
  });

  it("helyesbítés: hivatkozással az eredetire; kézi párosítás és bontás; időszak zárása és feloldása; partner", async () => {
    const orig = (await admin.post(`${c()}/documents`, {
      docType: "VSZ", partnerId: customer.id, externalNumber: "V-1", description: "Eladás", issueDate: "2026-11-02", fulfillmentDate: "2026-11-02", accountingDate: "2026-11-02", dueDate: "2026-11-20", post: true,
      lines: [{ accountId: acc["311"], side: "D", amount: 127_000 }, { accountId: acc["911"], side: "C", amount: 100_000 }, { accountId: acc["467"], side: "C", amount: 27_000 }],
    })).json() as DocumentDto;
    const hely = await admin.post(`${c()}/documents`, {
      docType: "HELY", partnerId: customer.id, correctsDocumentId: orig.id, externalNumber: "V-1-H", description: "Engedmény", issueDate: "2026-11-10", fulfillmentDate: "2026-11-10", accountingDate: "2026-11-10", post: true,
      lines: [{ accountId: acc["911"], side: "D", amount: 10_000 }, { accountId: acc["467"], side: "D", amount: 2_700 }, { accountId: acc["311"], side: "C", amount: 12_700 }],
    });
    expect(hely.statusCode, hely.body).toBe(201);
    const bank = (await admin.post(`${c()}/documents`, {
      docType: "BANK", partnerId: customer.id, description: "Befizetés", issueDate: "2026-11-15", accountingDate: "2026-11-15", post: true,
      lines: [{ accountId: acc["384"], side: "D", amount: 50_000 }, { accountId: acc["311"], side: "C", amount: 50_000 }],
    })).json() as DocumentDto;
    const s = await admin.post(`${c()}/settlements`, { itemLineId: orig.lines[0]!.id, settlingLineId: bank.lines[1]!.id, amount: 50_000 });
    expect(s.statusCode, s.body).toBe(201);
    expect((await admin.delete(`${c()}/settlements/${s.json().id}`)).statusCode).toBe(200);
    const periods = (await admin.get(`${c()}/fiscal-years`)).json()[0].periods as Array<{ id: string; startDate: string }>;
    const jan = periods.find((p) => p.startDate === "2026-01-01")!;
    expect((await admin.post(`${c()}/periods/${jan.id}/close`)).statusCode).toBe(200);
    expect((await admin.post(`${c()}/periods/${jan.id}/reopen`, { reason: "Teszt" })).statusCode).toBe(200);
    expect((await admin.patch(`${c()}/partners/${customer.id}`, { city: "Szeged" })).statusCode).toBe(200);
    // Ami nem közös adat (pl. megjegyzés), nem megy ki.
    expect((await admin.patch(`${c()}/partners/${customer.id}`, { notes: "csak belső" })).statusCode).toBe(200);

    const events = await outbox();
    for (const e of events) expect(validateEvent(e).ok, JSON.stringify(e)).toBe(true);
    expect(events.map((e) => e.type)).toEqual([
      "konyvelo.bizonylat.konyvelve",
      "konyvelo.bizonylat.konyvelve",
      "konyvelo.bizonylat.konyvelve",
      "konyvelo.kiegyenlites.rogzitve",
      "konyvelo.kiegyenlites.bontva",
      "konyvelo.idoszak.lezarva",
      "konyvelo.idoszak.feloldva",
      "torzs.partner.valtozott",
    ]);
    expect(events[1]!.payload).toMatchObject({ docType: "HELY", corrects: { documentId: orig.id, serialNumber: orig.serialNumber } });
    expect(events[3]!.payload).toMatchObject({ amount: 50_000, itemOpenAfter: 77_000 });
    expect(events[4]!.payload).toMatchObject({ reason: "MANUAL", itemOpenAfter: 127_000 });
    expect(events[5]!.payload).toEqual({ kind: "PERIOD", startDate: "2026-01-01", endDate: "2026-01-31" });
    expect(events[7]!.payload).toMatchObject({ partner: { name: "Ügyfél Zrt.", taxNumber: customer.taxNumber }, anonymized: false });
  });

  it("visszagörgetett műveletből nem lesz esemény", async () => {
    const bad = await admin.post(`${c()}/documents`, {
      docType: "SZSZ", partnerId: supplier.id, externalNumber: "ROSSZ", description: "Rossz", issueDate: "2026-11-02", fulfillmentDate: "2026-11-02", accountingDate: "2026-11-02", post: true,
      lines: [{ accountId: acc["529"], side: "D", amount: 100 }, { accountId: acc["454"], side: "C", amount: 99 }],
    });
    expect(bad.statusCode).toBe(422);
    expect(await outbox()).toEqual([]);
  });
});

describe("átadó", () => {
  it("csak a visszaigazolt esemény számít elküldöttnek; leállásnál marad, és tartós hibánál Teendő lesz", async () => {
    await ownerQuery("DELETE FROM integration_outbox");
    await admin.patch(`${c()}/partners/${supplier.id}`, { city: "Pécs" });
    await admin.patch(`${c()}/partners/${supplier.id}`, { city: "Győr" });
    const fake = new FakeHub();
    fake.down = true;
    expect(await relayOnce(ctx.db, fake)).toMatchObject({ sent: 0, failed: 2 });
    expect((await ownerQuery("SELECT count(*)::int AS n FROM integration_outbox WHERE sent_at IS NULL")).rows[0].n).toBe(2);

    // 30 percnél régebben váró esemény: Teendő (az esemény nem veszett el).
    await ownerQuery("UPDATE integration_outbox SET created_at = now() - interval '31 minutes'");
    await refreshHealthTodos(ctx.db);
    expect((await todos()).map((t) => t.kind)).toContain("HUB_UNREACHABLE");

    fake.down = false;
    const [first] = await outbox();
    fake.rejectIds.add(first!.id);
    expect(await relayOnce(ctx.db, fake)).toMatchObject({ sent: 1, failed: 1 });
    fake.rejectIds.clear();
    expect(await relayOnce(ctx.db, fake)).toMatchObject({ sent: 1, failed: 0 });
    expect(await relayOnce(ctx.db, fake)).toMatchObject({ sent: 0, failed: 0 });
    expect(fake.received.map((e) => e.payload.partner)).toEqual([expect.objectContaining({ name: "Ajtó Kft." }), expect.objectContaining({ name: "Ajtó Kft." })]);
    expect((await todos()).map((t) => t.kind)).not.toContain("HUB_UNREACHABLE");
  });
});

describe("megszakadt átadás", () => {
  it("ha a központ átvette, de a visszaigazolás elveszett, az újraküldés nem duplikál", async () => {
    await ownerQuery("DELETE FROM integration_outbox");
    await admin.patch(`${c()}/partners/${supplier.id}`, { city: "Eger" });
    const fake = new FakeHub();
    const original = fake.publish.bind(fake);
    let lose = true;
    fake.publish = async (events) => {
      const r = await original(events);
      if (lose) {
        lose = false;
        throw new Error("a kapcsolat a válasz előtt megszakadt");
      }
      return r;
    };
    expect(await relayOnce(ctx.db, fake)).toMatchObject({ sent: 0, failed: 1 });
    expect(await relayOnce(ctx.db, fake)).toMatchObject({ sent: 1, failed: 0 });
    expect(fake.received).toHaveLength(1);
  });

  it("a gépi felhasználó nem vehető fel cégtagnak, és nem számít az első indításnál", async () => {
    const r = await admin.post(`${c()}/members`, { email: "integracio@rendszer.invalid", role: "ADMIN" });
    expect(r.statusCode).toBe(422);
    expect((await ctx.app.inject({ method: "GET", url: "/api/setup/status" })).json()).toEqual({ needsSetup: false });
    expect((await ownerQuery("SELECT count(*)::int AS n FROM company_memberships WHERE user_id = '00000000-0000-4000-8000-00000000c0de'")).rows[0].n).toBe(0);
  });
});

describe("beérkező: beszerzés (KK1)", () => {
  it("szállítói számla piszkozat 261/466/454-gyel, a termék-sorokkal, Teendővel; ugyanaz az esemény 2×, 5× és párhuzamosan is egyszer hat", async () => {
    const e = purchaseEvent("B1");
    const first = await deliver(e);
    expect(first).toMatchObject({ outcome: "TODO", target: { recordType: "bizonylat" }, todo: { key: "beszerzes:B1" } });
    expect(await deliver(e)).toMatchObject({ outcome: "DUPLICATE", target: first.target });
    const parallel = await Promise.all(Array.from({ length: 5 }, () => hub("POST", INBOUND_PATH, { event: e, targetCompanyRef: companyId })));
    expect(parallel.map((r) => r.json().outcome)).toEqual(Array(5).fill("DUPLICATE"));
    expect((await ownerQuery("SELECT count(*)::int AS n FROM documents WHERE description LIKE 'Készlet-beszerzés%'")).rows[0].n).toBe(1);

    const d = await doc(first.target!.recordId);
    expect(d).toMatchObject({ status: "DRAFT", docType: "SZSZ", source: "INTEGRATION", partnerId: supplier.id, externalNumber: "SZ-B1", accountingDate: "2026-11-02", createdByName: "Integrációs központ (automatikus)" });
    expect(d.lines.map((l) => [l.accountNumber, l.side, l.amount])).toEqual([["261", "D", 200_000_00], ["466", "D", 54_000_00], ["454", "C", 254_000_00]]);
    const info = (await admin.get(`${c()}/documents/${d.id}/integration`)).json();
    expect(info).toMatchObject({ sources: [{ module: "keszlet", kind: "PURCHASE", label: "beszerzes B1" }], dateChoice: null, isCogs: false });
    expect(info.stockLines).toEqual([expect.objectContaining({ productName: "Bejárati ajtó", quantity: 2, netAmount: 200_000_00 })]);
    expect((await todos()).find((t) => t.documentId === d.id)).toMatchObject({ kind: "PURCHASE_APPROVAL" });
  });

  it("a már rögzített számlát nem rögzíti kétszer, csak párosítja", async () => {
    const manual = (await admin.post(`${c()}/documents`, {
      docType: "SZSZ", partnerId: supplier.id, externalNumber: "SZ-B2", description: "Kézi", issueDate: "2026-11-02", fulfillmentDate: "2026-11-02", accountingDate: "2026-11-02", post: true,
      lines: [{ accountId: acc["261"], side: "D", amount: 200_000_00 }, { accountId: acc["466"], side: "D", amount: 54_000_00 }, { accountId: acc["454"], side: "C", amount: 254_000_00 }],
    })).json() as DocumentDto;
    expect(await deliver(purchaseEvent("B2"))).toMatchObject({ outcome: "APPLIED", target: { recordId: manual.id } });

    // A kiegyenlítés a Készlet-forrást és a nyitott maradékot is viszi (F15.3): a Készlet nem számol, nem találgat.
    const payLine = manual.lines.find((l) => l.accountId === acc["454"])!.id;
    const pay = await admin.post(`${c()}/documents`, {
      docType: "BANK", partnerId: supplier.id, description: "Részfizetés", issueDate: "2026-11-06", accountingDate: "2026-11-06", post: true,
      lines: [{ accountId: acc["454"], side: "D", amount: 100_000_00 }, { accountId: acc["384"], side: "C", amount: 100_000_00 }], settlements: [{ itemLineId: payLine, amount: 100_000_00 }],
    });
    expect(pay.statusCode, pay.body).toBe(201);
    const settled = (await outbox()).filter((e) => e.type === "konyvelo.kiegyenlites.rogzitve").at(-1)!;
    expect(validateEvent(settled).ok).toBe(true);
    expect(settled).toMatchObject({ version: 3, payload: { settledDocumentId: manual.id, amount: 100_000_00, itemOpenAfter: 154_000_00, settledSources: [{ module: "keszlet", recordType: "beszerzes", recordId: "B2" }] } });
  });

  it("nem találgat: ismeretlen szállító, hiányzó számlaszám és eltérő dátumok esetén piszkozat + Teendő az okkal", async () => {
    const r = await deliver(purchaseEvent("B3", { supplier: { name: "Ismeretlen Bt.", taxNumber: nextTaxNumber() }, invoiceNumber: null, invoiceDate: "2026-10-30" }));
    expect(r.outcome).toBe("TODO");
    const d = await doc(r.target!.recordId);
    expect(d.partnerId).toBeNull();
    const t = (await todos()).filter((x) => x.documentId === d.id);
    expect(t.map((x) => x.kind).sort()).toEqual(["MISSING_DATA", "PURCHASE_APPROVAL"]);
    expect((await admin.get(`${c()}/documents/${d.id}/integration`)).json().dateChoice).toEqual({ receivedDate: "2026-11-02", invoiceDate: "2026-10-30" });
  });
});

describe("beérkező: eladás és ELÁBÉ (KK2, D9)", () => {
  it("az ELÁBÉ automatikus módban is piszkozat, és a gépi felhasználó nem könyvelheti; árbevétel számla nélkül nem lesz", async () => {
    await settings({ posting_mode: "AUTO", purchase_date_rule: "RECEIVED" });
    const r = await deliver(saleEvent("E1"));
    expect(r).toMatchObject({ outcome: "TODO", todo: { key: "elabe:E1" } });
    const d = await doc(r.target!.recordId);
    expect(d).toMatchObject({ status: "DRAFT", docType: "VEGY" });
    expect(d.lines.map((l) => [l.accountNumber, l.side, l.amount])).toEqual([["814", "D", 100_000_00], ["261", "C", 100_000_00]]);
    await expect(ctx.db.transaction((tx) => postDocument(tx, companyId, d.id, SYSTEM_USER, "teszt"))).rejects.toThrow(/csak ember/);
    const t = await todos();
    expect(t.find((x) => x.documentId === d.id)?.kind).toBe("COGS_APPROVAL");
    expect(t.find((x) => x.title.includes("nincs meg a vevőszámla"))?.kind).toBe("INVOICE_MISSING");
    await settings({ posting_mode: "DRAFT_ONLY", purchase_date_rule: "ASK" });
  });

  it("a meglévő vevőszámlával párosít (kétszer nem könyvel árbevételt)", async () => {
    await admin.post(`${c()}/documents`, {
      docType: "VSZ", partnerId: customer.id, externalNumber: "VSZ-77", description: "Eladás", issueDate: "2026-11-03", fulfillmentDate: "2026-11-03", accountingDate: "2026-11-03", dueDate: "2026-11-20", post: true,
      lines: [{ accountId: acc["311"], side: "D", amount: 190_500_00 }, { accountId: acc["911"], side: "C", amount: 150_000_00 }, { accountId: acc["467"], side: "C", amount: 40_500_00 }],
    });
    const before = (await todos()).length;
    const r = await deliver(saleEvent("E2", { invoiceNumber: "VSZ-77" }));
    expect(r.outcome).toBe("TODO"); // az ELÁBÉ jóváhagyásra vár
    const after = await todos();
    expect(after.length).toBe(before + 1);
    expect(after.some((x) => x.title.includes("E2") || x.title.includes("VSZ-77"))).toBe(false);
  });
});

describe("beérkező: visszavonás (KK4, F14.2)", () => {
  it("érintetlen piszkozat törlődik; módosított piszkozat Teendő", async () => {
    const a = await deliver(purchaseEvent("B10"));
    expect(await deliver(withdrawEvent("PURCHASE", "beszerzes", "B10"))).toMatchObject({ outcome: "APPLIED" });
    expect((await admin.get(`${c()}/documents/${a.target!.recordId}`)).statusCode).toBe(404);
    expect((await todos()).some((t) => t.documentId === a.target!.recordId)).toBe(false);

    const b = await deliver(purchaseEvent("B11"));
    const d = await doc(b.target!.recordId);
    const patch = await admin.patch(`${c()}/documents/${d.id}`, {
      docType: "SZSZ", partnerId: supplier.id, externalNumber: "SZ-B11", description: "kézzel átírva", issueDate: "2026-11-02", fulfillmentDate: "2026-11-02", accountingDate: "2026-11-02",
      lines: d.lines.map((l) => ({ accountId: l.accountId, side: l.side, amount: l.amount })),
    });
    expect(patch.statusCode, patch.body).toBe(200);
    expect(await deliver(withdrawEvent("PURCHASE", "beszerzes", "B11"))).toMatchObject({ outcome: "TODO" });
    expect((await doc(d.id)).status).toBe("DRAFT");
    expect((await todos()).find((t) => t.documentId === d.id && t.kind === "SOURCE_WITHDRAWN")).toBeTruthy();
  });

  it("könyvelt tétel: „csak piszkozat” módban sztornó-Teendő; automatikus módban sztornó, a forrás felé visszhang nélkül", async () => {
    const approve = async (id: string) => {
      const r = await admin.post(`${c()}/documents/${id}/post`);
      expect(r.statusCode, r.body).toBe(200);
    };
    const a = await deliver(purchaseEvent("B20"));
    await approve(a.target!.recordId);
    expect(await deliver(withdrawEvent("PURCHASE", "beszerzes", "B20"))).toMatchObject({ outcome: "TODO", todo: { key: `sztorno:${a.target!.recordId}` } });
    expect((await doc(a.target!.recordId)).reversedBy).toBeNull();
    // Egy kattintásos sztornó a javasolt dátummal.
    const rev = await admin.post(`${c()}/documents/${a.target!.recordId}/integration/reverse`, {});
    expect(rev.statusCode, rev.body).toBe(200);
    expect((await doc(a.target!.recordId)).reversedBy).toBeTruthy();

    await settings({ posting_mode: "AUTO" });
    await ownerQuery("DELETE FROM integration_outbox");
    const ev = purchaseEvent("B21");
    const b = await deliver(ev);
    await approve(b.target!.recordId);
    const withdraw = withdrawEvent("PURCHASE", "beszerzes", "B21");
    expect(await deliver(withdraw)).toMatchObject({ outcome: "APPLIED" });
    const reversed = await doc(b.target!.recordId);
    expect(reversed.reversedBy?.serialNumber).toMatch(/^SZT-/);
    const events = await outbox();
    // A jóváhagyott beszerzés könyvelése a beszerzés eseményére hivatkozik, a sztornó a visszavonáséra (a Készlet felé nem megy vissza).
    expect(events.map((e) => [e.type, e.causedBy])).toEqual([
      ["konyvelo.bizonylat.konyvelve", ev.id],
      ["konyvelo.bizonylat.sztornozva", withdraw.id],
    ]);
    await settings({ posting_mode: "DRAFT_ONLY" });
  });

  it("lezárt időszakba eső sztornót nem tesz át más napra: Teendő", async () => {
    await settings({ posting_mode: "AUTO" });
    const a = await deliver(purchaseEvent("B30", { receivedDate: "2026-02-02", invoiceDate: "2026-02-02", fulfillmentDate: "2026-02-02" }));
    expect((await admin.post(`${c()}/documents/${a.target!.recordId}/post`)).statusCode).toBe(200);
    const periods = (await admin.get(`${c()}/fiscal-years`)).json()[0].periods as Array<{ id: string; startDate: string }>;
    const feb = periods.find((p) => p.startDate === "2026-02-01")!;
    expect((await admin.post(`${c()}/periods/${feb.id}/close`)).statusCode, "február zárása").toBe(200);
    const r = await deliver(withdrawEvent("PURCHASE", "beszerzes", "B30", "2026-02-10"));
    expect(r.outcome).toBe("TODO");
    expect((await doc(a.target!.recordId)).reversedBy).toBeNull();
    expect((await todos()).find((t) => t.documentId === a.target!.recordId && t.kind === "REVERSAL_APPROVAL")).toBeTruthy();
    await admin.post(`${c()}/periods/${feb.id}/reopen`, { reason: "Teszt" });
    await settings({ posting_mode: "DRAFT_ONLY" });
  });

  it("ha nincs hozzá tétel, nem hallgat el: Teendő", async () => {
    expect(await deliver(withdrawEvent("SALE", "eladas", "NINCS"))).toMatchObject({ outcome: "TODO" });
  });
});

describe("csoportos jóváhagyás (F14.8)", () => {
  it("napra és fajtára csoportosít; csak a hiánytalan tételek könyvelhetők, egy ember kattintására; ismételt kérés nem könyvel kétszer", async () => {
    // Tiszta kiinduló állapot: a korábbi jóváhagyandók lezárva.
    await ownerQuery("UPDATE integration_todos SET resolved_at = now() WHERE resolved_at IS NULL");
    const ok1 = await deliver(purchaseEvent("C1", { receivedDate: "2026-11-12", invoiceDate: "2026-11-12", fulfillmentDate: "2026-11-12" }));
    const ok2 = await deliver(purchaseEvent("C2", { receivedDate: "2026-11-12", invoiceDate: "2026-11-12", fulfillmentDate: "2026-11-12" }));
    const missing = await deliver(purchaseEvent("C3", { receivedDate: "2026-11-12", invoiceDate: "2026-11-12", fulfillmentDate: "2026-11-12", supplier: { name: "Ismeretlen", taxNumber: nextTaxNumber() } }));
    const cogs = await deliver(saleEvent("C4", { date: "2026-11-12" }));

    const groups = (await admin.get(`${c()}/integration/approvals`)).json() as ApprovalGroupDto[];
    expect(groups.map((g) => [g.kind, g.date, g.items.length, g.completeCount])).toEqual([
      ["PURCHASE", "2026-11-12", 3, 2],
      ["COGS", "2026-11-12", 1, 1],
    ]);
    const bad = groups[0]!.items.find((i) => i.documentId === missing.target!.recordId)!;
    expect(bad.complete).toBe(false);
    expect(bad.problems.join(" ")).toMatch(/partner|szállító/i);
    // A próbakönyvelés nem hagy nyomot: sorszám sem fogy el.
    expect((await doc(ok1.target!.recordId)).status).toBe("DRAFT");

    const batchId = randomUUID();
    const ids = [ok1.target!.recordId, ok2.target!.recordId, missing.target!.recordId, cogs.target!.recordId];
    const res = (await admin.post(`${c()}/integration/approvals`, { batchId, documentIds: ids })).json() as ApprovalResultDto;
    expect(res.results.map((r) => [r.documentId, r.ok])).toEqual([
      [ok1.target!.recordId, true],
      [ok2.target!.recordId, true],
      [missing.target!.recordId, false],
      [cogs.target!.recordId, true],
    ]);
    expect(res.results[3]!.serialNumber).toMatch(/^VEGY-/);
    // Ugyanaz a kérés még egyszer: ugyanaz az eredmény, újabb könyvelés nélkül.
    const again = (await admin.post(`${c()}/integration/approvals`, { batchId, documentIds: ids })).json() as ApprovalResultDto;
    expect(again).toEqual(res);
    expect((await ownerQuery("SELECT count(*)::int AS n FROM documents WHERE status = 'POSTED' AND id = ANY($1::uuid[])", [ids])).rows[0].n).toBe(3);
    // A jóváhagyó neve az ELÁBÉ-n: ember hagyta jóvá.
    expect((await doc(cogs.target!.recordId)).postedByName).toBe("Admin Anna");
    const audit = await ownerQuery("SELECT after FROM audit_log WHERE action = 'integration.approve_batch' AND entity_id = $1", [batchId]);
    expect(audit.rows).toHaveLength(1);
  });

  it("dátumválasztás csoportosan: a jóváhagyó választ, a program nem", async () => {
    const r = await deliver(purchaseEvent("C5", { receivedDate: "2026-11-14", invoiceDate: "2026-11-13", fulfillmentDate: "2026-11-13" }));
    const id = r.target!.recordId;
    const noChoice = (await admin.post(`${c()}/integration/approvals`, { batchId: randomUUID(), documentIds: [id] })).json() as ApprovalResultDto;
    expect(noChoice.results[0]).toMatchObject({ ok: false, message: expect.stringMatching(/Válassza ki a könyvelés dátumát/) });
    const withChoice = (await admin.post(`${c()}/integration/approvals`, { batchId: randomUUID(), documentIds: [id], purchaseDate: "RECEIVED" })).json() as ApprovalResultDto;
    expect(withChoice.results[0]!.ok).toBe(true);
    expect((await doc(id)).accountingDate).toBe("2026-11-14");
  });

  it("nem jóváhagyásra váró bizonylatot nem könyvel ezen az úton", async () => {
    const manual = (await admin.post(`${c()}/documents`, { docType: "VEGY", description: "kézi piszkozat", accountingDate: "2026-11-20" })).json() as DocumentDto;
    const res = (await admin.post(`${c()}/integration/approvals`, { batchId: randomUUID(), documentIds: [manual.id] })).json() as ApprovalResultDto;
    expect(res.results[0]).toMatchObject({ ok: false });
  });
});

describe("beérkező: a Könyvelőből jött mozgás jóváhagyása a Készletben (F15.4)", () => {
  const approval = (doc: DocumentDto, movementId: string, over: Record<string, unknown> = {}, recordId = movementId, sequence = 1) =>
    keszletEvent("keszlet.mozgas.jovahagyva", 1, "konyvelo_mozgas", recordId, {
      movementId,
      purpose: "RECEIPT",
      sourceDocument: { documentId: doc.id, serialNumber: doc.serialNumber, eventId: randomUUID() },
      originalMovementId: null,
      date: "2026-11-12",
      productId: "P1",
      productName: "Bejárati ajtó",
      unit: "db",
      expectedQuantity: 10,
      actualQuantity: 10,
      note: null,
      costOfGoods: null,
      ...over,
    }, sequence);
  const szsz = async (ext: string) =>
    (await admin.post(`${c()}/documents`, {
      docType: "SZSZ", partnerId: supplier.id, externalNumber: ext, description: "Áru", issueDate: "2026-11-10", fulfillmentDate: "2026-11-10", accountingDate: "2026-11-10", post: true,
      lines: [{ accountId: acc["261"], side: "D", amount: 1_000_000 }, { accountId: acc["466"], side: "D", amount: 270_000 }, { accountId: acc["454"], side: "C", amount: 1_270_000 }],
    })).json() as DocumentDto;
  const vsz = async (ext: string) =>
    (await admin.post(`${c()}/documents`, {
      docType: "VSZ", partnerId: customer.id, externalNumber: ext, description: "Eladás", issueDate: "2026-11-10", fulfillmentDate: "2026-11-10", accountingDate: "2026-11-10", dueDate: "2026-11-30", post: true,
      lines: [{ accountId: acc["311"], side: "D", amount: 381_000 }, { accountId: acc["911"], side: "C", amount: 300_000 }, { accountId: acc["467"], side: "C", amount: 81_000 }],
    })).json() as DocumentDto;

  it("eltérő mennyiség: Teendő a bizonylaton, a megjegyzéssel; a könyvelés magától nem változik; pontosan egyszer", async () => {
    await settings({ posting_mode: "AUTO" });
    const doc = await szsz("ELT-1");
    const before = await doc_(doc.id);
    const e = approval(doc, "M-ELT-1", { actualQuantity: 8, note: "2 db sérült" });
    const r = await deliver(e);
    expect(r).toMatchObject({ outcome: "TODO", todo: { key: "elteres:M-ELT-1", title: expect.stringMatching(/beérkezésnél.*ELT|10 db helyett 8 db érkezett/) } });
    expect(await deliver(e)).toMatchObject({ outcome: "DUPLICATE" });
    const t = (await todos()).filter((x) => x.kind === "STOCK_DISCREPANCY" && x.documentId === doc.id);
    expect(t).toHaveLength(1);
    expect(t[0]!.title).toContain("10 db helyett 8 db érkezett");
    expect(((await admin.get(`${c()}/integration/todos`)).json() as Array<{ detail: string | null; documentId: string | null }>).find((x) => x.documentId === doc.id)!.detail).toMatch(/2 db sérült[\s\S]*magától nem változott/);
    // A bizonylat és a könyvelés változatlan, új bizonylat sem lett.
    expect(await doc_(doc.id)).toEqual(before);
    expect((await ownerQuery("SELECT count(*)::int AS n FROM documents WHERE description LIKE '%ELT-1%' OR external_number = 'ELT-1'")).rows[0].n).toBe(1);
    // Kézzel lezárható.
    const id = (t[0] as { id: string }).id;
    expect((await admin.post(`${c()}/integration/todos/${id}/resolve`)).statusCode).toBe(200);

    // Egyező mennyiségnél nincs Teendő; elutasításnál (0) „nem érkezett meg”.
    expect(await deliver(approval(doc, "M-ELT-2"))).toMatchObject({ outcome: "APPLIED", target: { recordId: doc.id } });
    expect(await deliver(approval(doc, "M-ELT-3", { actualQuantity: 0, note: "Nem jött meg" }))).toMatchObject({ outcome: "TODO", todo: { title: expect.stringMatching(/nem érkezett meg/) } });
    await settings({ posting_mode: "DRAFT_ONLY" });
  });

  it("kiadás: ELÁBÉ-piszkozat mindig jóváhagyással (automatikus módban is); eltérésnél mellé Teendő; a fizetés a Készlet felé is kimegy", async () => {
    await settings({ posting_mode: "AUTO" });
    const doc = await vsz("KI-1");
    const r = await deliver(approval(doc, "M-KI-1", { purpose: "ISSUE", expectedQuantity: 3, actualQuantity: 2, note: "1 db hiányzott", costOfGoods: 162_500 }));
    expect(r).toMatchObject({ outcome: "TODO", todo: { key: "elteres:M-KI-1" } });
    const cogs = (await todos()).find((t) => t.kind === "COGS_APPROVAL" && t.title.includes("KI-") || (t.kind === "COGS_APPROVAL" && t.title.includes(doc.serialNumber!)))!;
    const draft = await doc_(cogs.documentId!);
    expect(draft).toMatchObject({ status: "DRAFT", docType: "VEGY" });
    expect(draft.lines.map((l) => [l.accountNumber, l.side, l.amount])).toEqual([["814", "D", 162_500], ["261", "C", 162_500]]);
    const groups = (await admin.get(`${c()}/integration/approvals`)).json() as ApprovalGroupDto[];
    expect(groups.find((g) => g.kind === "COGS")!.items.some((i) => i.documentId === draft.id)).toBe(true);

    // A vevőszámla kiegyenlítése a Készlet-mozgást is megnevezi (a Készlet ebből tudja, hogy fizetve).
    await ownerQuery("DELETE FROM integration_outbox");
    const itemLine = doc.lines.find((l) => l.accountId === acc["311"])!.id;
    const bank = await admin.post(`${c()}/documents`, {
      docType: "BANK", partnerId: customer.id, description: "Befizetés", issueDate: "2026-11-20", accountingDate: "2026-11-20", post: true,
      lines: [{ accountId: acc["384"], side: "D", amount: 381_000 }, { accountId: acc["311"], side: "C", amount: 381_000 }], settlements: [{ itemLineId: itemLine, amount: 381_000 }],
    });
    expect(bank.statusCode, bank.body).toBe(201);
    const settled = (await outbox()).find((e) => e.type === "konyvelo.kiegyenlites.rogzitve")!;
    expect(settled.payload).toMatchObject({ itemOpenAfter: 0, settledSources: [{ module: "keszlet", recordType: "konyvelo_mozgas", recordId: "M-KI-1" }] });
    await settings({ posting_mode: "DRAFT_ONLY" });
  });

  it("vevői visszavétel: az ELÁBÉ csökkentése piszkozat (T 261 / K 814)", async () => {
    const doc = await vsz("KI-2");
    await deliver(approval(doc, "M-KI-2", { purpose: "ISSUE", expectedQuantity: 2, actualQuantity: 2, costOfGoods: 100_000 }));
    const r = await deliver(approval(doc, "M-VV-2", { purpose: "CUSTOMER_RETURN", originalMovementId: "M-KI-2", expectedQuantity: 1, actualQuantity: 1, costOfGoods: 50_000 }, "M-KI-2", 2));
    expect(r).toMatchObject({ outcome: "TODO", todo: { key: "elabe:M-VV-2" } });
    const t = (await todos()).find((x) => x.kind === "COGS_APPROVAL" && x.title.startsWith("ELÁBÉ csökkentése"))!;
    expect((await doc_(t.documentId!)).lines.map((l) => [l.accountNumber, l.side, l.amount])).toEqual([["261", "D", 50_000], ["814", "C", 50_000]]);
  });

  it("a sztornózott vevőszámla teljes visszavétele: a könyvelt ELÁBÉ sztornója javasolt (jóváhagyással); részlegesnél csak Teendő", async () => {
    const doc = await vsz("KI-3");
    await deliver(approval(doc, "M-KI-3", { purpose: "ISSUE", expectedQuantity: 2, actualQuantity: 2, costOfGoods: 80_000 }));
    const cogsTodo = (await todos()).find((x) => x.kind === "COGS_APPROVAL" && x.title.includes(doc.serialNumber!))!;
    expect((await admin.post(`${c()}/documents/${cogsTodo.documentId}/post`)).statusCode).toBe(200);
    const r = await deliver(approval(doc, "M-SZ-3", { purpose: "REVERSAL", originalMovementId: "M-KI-3", expectedQuantity: 2, actualQuantity: 2, costOfGoods: 80_000 }, "M-KI-3", 2));
    expect(r).toMatchObject({ outcome: "TODO", todo: { key: `sztorno:${cogsTodo.documentId}` } });
    expect((await todos()).find((x) => x.kind === "REVERSAL_APPROVAL" && x.documentId === cogsTodo.documentId)).toBeTruthy();
    // Magától nem sztornózott.
    expect((await ownerQuery("SELECT count(*)::int AS n FROM documents WHERE reverses_document_id = $1", [cogsTodo.documentId])).rows[0].n).toBe(0);

    const doc2 = await vsz("KI-4");
    await deliver(approval(doc2, "M-KI-4", { purpose: "ISSUE", expectedQuantity: 2, actualQuantity: 2, costOfGoods: 80_000 }));
    const r2 = await deliver(approval(doc2, "M-SZ-4", { purpose: "REVERSAL", originalMovementId: "M-KI-4", expectedQuantity: 2, actualQuantity: 1, note: "1 db nem jött vissza", costOfGoods: 40_000 }, "M-KI-4", 2));
    expect(r2).toMatchObject({ outcome: "TODO", todo: { key: "elteres:M-SZ-4" } });
    expect((await todos()).filter((x) => x.title.includes(doc2.serialNumber!) && x.kind === "SOURCE_WITHDRAWN")).toEqual([]);
  });

  it("ismeretlen bizonylatra hivatkozó jóváhagyás: Teendő", async () => {
    const fake = { id: randomUUID(), serialNumber: "SZSZ-NINCS" } as DocumentDto;
    expect(await deliver(approval(fake, "M-X"))).toMatchObject({ outcome: "TODO", todo: { key: "keszlet-mozgas:M-X" } });
  });
});

describe("beérkező: beszerzés v3, leltár, pénztár, visszáru, sztornó v3 (F15.3, F15.5, F15.8)", () => {
  const lines = async (id: string) => (await doc_(id)).lines.map((l) => [l.accountNumber, l.side, l.amount])
  const groups = async () => (await admin.get(`${c()}/integration/approvals`)).json() as ApprovalGroupDto[];
  const itemOf = async (documentId: string) => (await groups()).flatMap((g) => g.items.map((i) => ({ ...i, kind: g.kind }))).find((i) => i.documentId === documentId);
  const approve = async (ids: string[]) => (await admin.post(`${c()}/integration/approvals`, { batchId: randomUUID(), documentIds: ids })).json() as ApprovalResultDto;
  const todo = async (key: string) => (await ownerQuery("SELECT kind, title, detail, document_id, resolved_at FROM integration_todos WHERE company_id = $1 AND key = $2", [companyId, key])).rows[0];

  const v3 = (id: string, over: Record<string, unknown> = {}) =>
    keszletEvent("keszlet.beszerzes.veglegesitve", 3, "beszerzes", id, {
      purchaseId: id, receivedDate: "2026-11-16", invoiceDate: "2026-11-16", fulfillmentDate: "2026-11-16", invoiceNumber: `SZ3-${id}`,
      supplier: { name: "Ajtó Kft.", taxNumber: supplier.taxNumber }, originalCurrency: null,
      lines: [
        { productId: "P1", productName: "Bejárati ajtó", quantity: 2, unit: "db", netAmount: 100_000, vatRate: 27, vatAmount: 27_000, vatReclaimable: true },
        { productId: "P2", productName: "Kilincs", quantity: 1, unit: "db", netAmount: 10_000, vatRate: 27, vatAmount: 2_700, vatReclaimable: false },
      ],
      shipping: { netAmount: 5_000, vatRate: 27, vatAmount: 1_350, vatReclaimable: true, onSupplierInvoice: true },
      totals: { net: 115_000, vat: 31_050, gross: 146_050 },
      ...over,
    });

  it("beszerzés v3: a nem visszaigényelhető áfa és a számlán lévő szállítási díj a 261-re; hiánytalan tétel csoportosan jóváhagyható", async () => {
    await settings({ posting_mode: "DRAFT_ONLY", purchase_date_rule: "RECEIVED" });
    const r = await deliver(v3("B3-1"));
    const id = r.target!.recordId;
    expect(await lines(id)).toEqual([["261", "D", 117_700], ["466", "D", 28_350], ["454", "C", 146_050]]);
    expect(await itemOf(id)).toMatchObject({ kind: "PURCHASE", complete: true });
    expect(await todo("szallitas:B3-1")).toBeUndefined();
  });

  it("nem találgat: devizás számla és „nem tudni, a számlán van-e” → átnézendő (csoportosan nem, egyenként igen); külön számlás szállítás → Teendő", async () => {
    const fx = await deliver(v3("B3-2", { originalCurrency: { code: "EUR", rate: 395.2 } }));
    const fxItem = await itemOf(fx.target!.recordId);
    expect(fxItem).toMatchObject({ complete: false });
    expect(fxItem!.problems.join(" ")).toMatch(/Devizás beszerzés \(EUR.*395\.2.*Egyenként/);
    expect((await approve([fx.target!.recordId])).results[0]).toMatchObject({ ok: false, message: expect.stringMatching(/Nem hiánytalan/) });
    expect((await admin.post(`${c()}/documents/${fx.target!.recordId}/post`)).statusCode).toBe(200);

    const nemTudni = await deliver(v3("B3-3", { shipping: { netAmount: 5_000, vatRate: 27, vatAmount: 1_350, vatReclaimable: true, onSupplierInvoice: null }, totals: { net: 110_000, vat: 29_700, gross: 139_700 } }));
    expect(await lines(nemTudni.target!.recordId)).toEqual([["261", "D", 112_700], ["466", "D", 27_000], ["454", "C", 139_700]]);
    expect((await itemOf(nemTudni.target!.recordId))!.problems.join(" ")).toMatch(/nem tudták, hogy a szállítási díj/);
    expect(await todo("szallitas:B3-3")).toMatchObject({ kind: "MISSING_DATA", title: expect.stringMatching(/nem tudni, melyik számlán/) });

    const kulon = await deliver(v3("B3-4", { shipping: { netAmount: 5_000, vatRate: 27, vatAmount: 1_350, vatReclaimable: true, onSupplierInvoice: false }, totals: { net: 110_000, vat: 29_700, gross: 139_700 } }));
    expect(await itemOf(kulon.target!.recordId)).toMatchObject({ complete: true });
    expect(await todo("szallitas:B3-4")).toMatchObject({ title: expect.stringMatching(/külön \(fuvarozói\) számlán/) });
  });

  it("leltáreltérés: hiány T 869 / K 261, többlet T 261 / K 969; „Leltár” fajtaként csoportosan jóváhagyható, magától soha nem könyvel", async () => {
    await settings({ posting_mode: "AUTO" });
    const leltar = (id: string, kind: string, value: number) =>
      keszletEvent("keszlet.leltar.elteres", 1, "leltar", id, { movementId: id, date: "2026-11-17", kind, productId: "P1", productName: "Bejárati ajtó", quantity: 1.5, unit: "db", location: { id: "L", name: "Raktár" }, value, note: "éves leltár" });
    const hiany = await deliver(leltar("LT-1", "SHORTAGE", 50_000));
    const tobblet = await deliver(leltar("LT-2", "SURPLUS", 20_000));
    expect(hiany).toMatchObject({ outcome: "TODO", todo: { key: "leltar:LT-1", title: expect.stringMatching(/Leltári hiány – Bejárati ajtó, 1\.5 db \(Raktár\)/) } });
    expect(await lines(hiany.target!.recordId)).toEqual([["869", "D", 50_000], ["261", "C", 50_000]]);
    expect(await lines(tobblet.target!.recordId)).toEqual([["261", "D", 20_000], ["969", "C", 20_000]]);
    expect((await doc_(hiany.target!.recordId)).status).toBe("DRAFT");
    const g = (await groups()).find((x) => x.kind === "INVENTORY")!;
    expect(g.items.map((i) => i.complete)).toEqual([true, true]);
    expect((await approve([hiany.target!.recordId, tobblet.target!.recordId])).results.map((x) => x.ok)).toEqual([true, true]);
    expect(await deliver(leltar("LT-3", "SCRAP", 0))).toEqual({ outcome: "APPLIED" });
    await settings({ posting_mode: "DRAFT_ONLY" });
  });

  it("napi pénztárzárás: pénztárbevételi piszkozat kulcsonként, a visszavétellel csökkentve; a készpénzes eladás „árbevétel hiányzik” Teendője lezárul; utólagos módosítás Teendő", async () => {
    await deliver(saleEvent("S-CASH1", { cash: true, customer: null, date: "2026-11-18" }));
    expect(await todo("szamla:S-CASH1")).toMatchObject({ kind: "INVOICE_MISSING", resolved_at: null });
    const zaras = (id: string, payload: Record<string, unknown>, seq = 1) =>
      keszletEvent("keszlet.napi_zaras.elkuldve", 1, "napi_zaras", id, { closingId: id, date: "2026-11-18", location: { id: "L", name: "Bolt" }, ...payload }, seq);
    const r = await deliver(
      zaras("Z-1", {
        sales: [{ vatRate: 5, net: 20_000, vat: 1_000, gross: 21_000 }, { vatRate: 27, net: 100_000, vat: 27_000, gross: 127_000 }],
        returns: [{ vatRate: 27, net: 10_000, vat: 2_700, gross: 12_700 }],
        saleIds: ["S-CASH1"], returnIds: ["V-CASH1"], totals: { net: 110_000, vat: 25_300, gross: 135_300 },
      }),
    );
    const id = r.target!.recordId;
    expect(await doc_(id)).toMatchObject({ docType: "PB", status: "DRAFT" });
    expect(await lines(id)).toEqual([["381", "D", 135_300], ["911", "C", 20_000], ["911", "C", 90_000], ["467", "C", 25_300]]);
    expect((await todo("szamla:S-CASH1")).resolved_at).not.toBeNull();
    expect(await itemOf(id)).toMatchObject({ kind: "CASH", complete: true });
    expect((await approve([id])).results[0]).toMatchObject({ ok: true, serialNumber: expect.stringMatching(/^PB-/) });

    const mod = await deliver(keszletEvent("keszlet.napi_zaras.modosult", 1, "napi_zaras", "Z-1", { closingId: "Z-1", date: "2026-11-18", location: { id: "L", name: "Bolt" }, movementIds: ["M9"] }, 2));
    expect(mod).toMatchObject({ outcome: "TODO", todo: { url: `/konyveles/${id}` } });
    expect((await todos()).find((t) => t.kind === "SOURCE_CHANGED" && t.documentId === id)).toBeTruthy();

    // Csak visszavétel aznap: pénztárkiadási piszkozat.
    const ki = await deliver(zaras("Z-2", { sales: [], returns: [{ vatRate: 27, net: 1_000, vat: 270, gross: 1_270 }], saleIds: [], returnIds: ["V-2"], totals: { net: -1_000, vat: -270, gross: -1_270 } }));
    expect(await doc_(ki.target!.recordId)).toMatchObject({ docType: "PK" });
    expect(await lines(ki.target!.recordId)).toEqual([["381", "C", 1_270], ["911", "D", 1_000], ["467", "D", 270]]);
  });

  const visszaru = (recordType: string, original: string, returnId: string, over: Record<string, unknown> = {}) =>
    keszletEvent("keszlet.visszaru.veglegesitve", 1, recordType, original, {
      returnId, kind: "CUSTOMER_RETURN", original: { movementKind: "SALE", movementId: original }, date: "2026-11-20",
      partner: { name: "Ügyfél Zrt.", taxNumber: customer.taxNumber }, cash: false, reason: "sérült",
      lines: [{ productId: "P1", productName: "Bejárati ajtó", quantity: 1, unit: "db", netAmount: 50_000, vatRate: 27, vatAmount: 13_500 }],
      totals: { net: 50_000, vat: 13_500, gross: 63_500 }, vatReclaimable: null, costOfGoods: 30_000, ...over,
    }, 2);

  it("vevői visszavétel: helyesbítő piszkozat a vevőszámlára (T 911 / T 467 / K 311) és ELÁBÉ-csökkentés; a helyesbítő számla száma nélkül hiányos", async () => {
    const vsz = (await admin.post(`${c()}/documents`, {
      docType: "VSZ", partnerId: customer.id, externalNumber: "VR-1", description: "Eladás", issueDate: "2026-11-19", fulfillmentDate: "2026-11-19", accountingDate: "2026-11-19", dueDate: "2026-12-01", post: true,
      lines: [{ accountId: acc["311"], side: "D", amount: 127_000 }, { accountId: acc["911"], side: "C", amount: 100_000 }, { accountId: acc["467"], side: "C", amount: 27_000 }],
    })).json() as DocumentDto;
    await deliver(saleEvent("SR-1", { invoiceNumber: "VR-1", date: "2026-11-19" }));
    const r = await deliver(visszaru("eladas", "SR-1", "R-1"));
    expect(r.outcome).toBe("TODO");
    const hely = await todo("visszaru:R-1");
    expect(hely).toMatchObject({ kind: "RETURN_APPROVAL" });
    const helyDoc = await doc_(hely.document_id);
    expect(helyDoc).toMatchObject({ docType: "HELY", status: "DRAFT", partnerId: customer.id, externalNumber: null, corrects: { id: vsz.id } });
    expect(await lines(helyDoc.id)).toEqual([["911", "D", 50_000], ["467", "D", 13_500], ["311", "C", 63_500]]);
    const elabe = await todo("elabe:R-1");
    expect(await lines(elabe.document_id)).toEqual([["261", "D", 30_000], ["814", "C", 30_000]]);

    const item = await itemOf(helyDoc.id);
    expect(item).toMatchObject({ kind: "RETURN", complete: false });
    expect(item!.problems.join(" ")).toMatch(/helyesbítő számla számát/);
    expect((await approve([helyDoc.id])).results[0]!.ok).toBe(false);
    // A jóváhagyó beírja a számlaszámot: utána hiánytalan, és csoportosan jóváhagyható.
    const patch = await admin.patch(`${c()}/documents/${helyDoc.id}`, {
      docType: "HELY", partnerId: customer.id, correctsDocumentId: vsz.id, externalNumber: "VR-1-H1", description: helyDoc.description, issueDate: "2026-11-20", fulfillmentDate: "2026-11-20", accountingDate: "2026-11-20",
      lines: helyDoc.lines.map((l) => ({ accountId: l.accountId, side: l.side, amount: l.amount, partnerId: l.partnerId })),
    });
    expect(patch.statusCode, patch.body).toBe(200);
    expect(await itemOf(helyDoc.id)).toMatchObject({ complete: true });
    expect((await approve([helyDoc.id])).results[0]).toMatchObject({ ok: true, serialNumber: expect.stringMatching(/^HELY-/) });
  });

  it("készpénzes visszavétel: csak az ELÁBÉ-csökkentés (a pénz a napi zárásban); vevőszámla nélkül Teendő", async () => {
    await deliver(saleEvent("SR-2", { cash: true, customer: null, invoiceNumber: null }));
    const r = await deliver(visszaru("eladas", "SR-2", "R-2", { cash: true, partner: null }));
    expect(r).toMatchObject({ outcome: "TODO", todo: { key: "elabe:R-2" } });
    expect(await todo("visszaru:R-2")).toBeUndefined();

    await deliver(saleEvent("SR-3", { invoiceNumber: "NINCS-ILYEN" }));
    await deliver(visszaru("eladas", "SR-3", "R-3"));
    expect(await todo("visszaru:R-3")).toMatchObject({ kind: "MISSING_DATA", title: expect.stringMatching(/vevőszámlához kell, de az nincs meg/) });
  });

  it("szállítói visszaküldés: amíg az eredeti piszkozat, ott kell javítani; könyvelt számlára helyesbítő (T 454 / K 261 / K 466); a visszavonása törli az érintetlen piszkozatot", async () => {
    await settings({ purchase_date_rule: "RECEIVED" });
    const besz = await deliver(purchaseEvent("PB-1"));
    const kuld = (returnId: string) =>
      visszaru("beszerzes", "PB-1", returnId, {
        kind: "SUPPLIER_RETURN", original: { movementKind: "PURCHASE", movementId: "PB-1" }, partner: { name: "Ajtó Kft.", taxNumber: supplier.taxNumber },
        lines: [{ productId: "P1", productName: "Bejárati ajtó", quantity: 1, unit: "db", netAmount: 100_000_00, vatRate: 27, vatAmount: 27_000_00 }],
        totals: { net: 100_000_00, vat: 27_000_00, gross: 127_000_00 }, vatReclaimable: true, costOfGoods: null,
      });
    await deliver(kuld("R-4"));
    expect(await todo("visszaru:R-4")).toMatchObject({ kind: "SOURCE_CHANGED", title: expect.stringMatching(/még piszkozat/) });
    expect((await admin.post(`${c()}/documents/${besz.target!.recordId}/post`)).statusCode).toBe(200);

    await deliver(kuld("R-5"));
    const hely = await todo("visszaru:R-5");
    expect(await lines(hely.document_id)).toEqual([["454", "D", 127_000_00], ["261", "C", 100_000_00], ["466", "C", 27_000_00]]);
    expect((await doc_(hely.document_id)).corrects).toMatchObject({ id: besz.target!.recordId });

    // A Készletben visszavonták a visszárut: az érintetlen helyesbítő-piszkozat törlődik.
    await deliver(keszletEvent("keszlet.mozgas.sztornozva", 3, "beszerzes", "PB-1", { movementKind: "RETURN", movementId: "R-5", date: "2026-11-21", reason: "téves" }, 4));
    expect((await ownerQuery("SELECT count(*)::int AS n FROM documents WHERE id = $1", [hely.document_id])).rows[0].n).toBe(0);
    // A beszerzés maga érintetlen.
    expect((await doc_(besz.target!.recordId)).status).toBe("POSTED");
  });

  it("hiányzó számla-hozzárendelés: Teendő a Kezdőlapon (a beállításokra mutatva), és magától lezárul, ha megadták", async () => {
    expect(await todo("szamla-hozzarendeles")).toBeUndefined();
    const status = (await admin.get(`${c()}/integration`)).json() as IntegrationStatusDto;
    const put = (accounts: Record<string, string | null>) =>
      admin.put(`${c()}/integration/settings`, { postingMode: status.postingMode, purchaseDateRule: status.purchaseDateRule, accounts: { ...status.accounts, ...accounts } });
    expect((await put({ cashAccountId: null })).statusCode).toBe(200);
    const t = (await admin.get(`${c()}/todos`)).json() as { integration: { todos: Array<{ kind: string; title: string; documentId: string | null }> } };
    const nyitott = t.integration.todos.find((x) => x.title.startsWith("Hiányzik a számla-hozzárendelés"));
    expect(nyitott).toMatchObject({ kind: "MISSING_DATA", documentId: null, title: expect.stringMatching(/Pénztár \(napi pénztárzárás\) \(pl\. 381\).*Beállítások → Integráció/) });
    expect((await put({})).statusCode).toBe(200);
    expect((await todo("szamla-hozzarendeles")).resolved_at).not.toBeNull();

    // Az átadó állapot-ellenőrzése is észreveszi (pl. ha a számlát közben inaktiválták vagy törölték).
    await ownerQuery("UPDATE integration_settings SET inventory_gain_account_id = NULL WHERE company_id = $1", [companyId]);
    await relayOnce(ctx.db, new FakeHub());
    expect(await todo("szamla-hozzarendeles")).toMatchObject({ resolved_at: null, title: expect.stringMatching(/Leltári többlet ellenszámlája/) });
    await ownerQuery("UPDATE integration_settings SET inventory_gain_account_id = $2 WHERE company_id = $1", [companyId, status.accounts.inventoryGainAccountId]);
    await relayOnce(ctx.db, new FakeHub());
    expect((await todo("szamla-hozzarendeles")).resolved_at).not.toBeNull();
  });

  it("leltáreltérés visszavonása (sztornó v3): az érintetlen piszkozat törlődik; ismeretlen tételnél Teendő", async () => {
    const r = await deliver(keszletEvent("keszlet.leltar.elteres", 1, "leltar", "LT-9", { movementId: "LT-9", date: "2026-11-22", kind: "SCRAP", productId: "P1", productName: "Bejárati ajtó", quantity: 1, unit: "db", location: null, value: 5_000, note: null }));
    await deliver(keszletEvent("keszlet.mozgas.sztornozva", 3, "leltar", "LT-9", { movementKind: "INVENTORY", movementId: "LT-9", date: "2026-11-22", reason: "téves" }, 2));
    expect((await ownerQuery("SELECT count(*)::int AS n FROM documents WHERE id = $1", [r.target!.recordId])).rows[0].n).toBe(0);
    const ism = await deliver(keszletEvent("keszlet.mozgas.sztornozva", 3, "leltar", "LT-X", { movementKind: "INVENTORY", movementId: "LT-X", date: "2026-11-22", reason: "téves" }, 2));
    expect(ism).toMatchObject({ outcome: "TODO", todo: { title: expect.stringMatching(/leltáreltérés/) } });
  });
});

describe("bevezető hónap, termékek, partnerek, ismeretlen esemény", () => {
  it("a bevezető hónap letelte után Teendő, de magától nem kapcsol át", async () => {
    await settings({ draft_only_until: "2026-01-01" });
    await refreshHealthTodos(ctx.db);
    expect((await todos()).filter((t) => t.kind === "INTRO_MONTH")).toHaveLength(1);
    await refreshHealthTodos(ctx.db);
    expect((await todos()).filter((t) => t.kind === "INTRO_MONTH")).toHaveLength(1);
    expect(((await admin.get(`${c()}/integration`)).json() as IntegrationStatusDto).postingMode).toBe("DRAFT_ONLY");
  });

  it("termékjegyzék a Készletből; partner: csak pontos adószám-egyezésnél frissít, egyébként Teendő", async () => {
    expect(await deliver(keszletEvent("keszlet.termek.valtozott", 1, "termek", "P9", { productId: "P9", name: "Kilincs", sku: "K-9", unit: "db", vatRate: 27, active: true }))).toMatchObject({ outcome: "APPLIED" });
    expect((await admin.get(`${c()}/integration/products?q=kil`)).json()).toEqual([{ productId: "P9", name: "Kilincs", sku: "K-9", unit: "db", vatRate: 27 }]);

    await ownerQuery("DELETE FROM integration_outbox");
    const renamed = keszletEvent("torzs.partner.valtozott", 1, "partner", "X1", { partner: { name: "Ajtó és Ablak Kft.", taxNumber: supplier.taxNumber }, anonymized: false });
    expect(await deliver(renamed)).toMatchObject({ outcome: "APPLIED", target: { recordId: supplier.id } });
    expect((await admin.get(`${c()}/partners/${supplier.id}`)).json().name).toBe("Ajtó és Ablak Kft.");
    // A visszhang tiltása: a Könyvelő eseménye a beérkezettre hivatkozik.
    expect((await outbox()).map((e) => e.causedBy)).toEqual([renamed.id]);
    expect(await deliver(keszletEvent("torzs.partner.valtozott", 1, "partner", "X2", { partner: { name: "Névrokon Kft." }, anonymized: false }))).toMatchObject({ outcome: "TODO" });
    expect(await deliver(keszletEvent("torzs.partner.valtozott", 1, "partner", "X3", { partner: { name: "Ajtó", taxNumber: supplier.taxNumber }, anonymized: true }))).toMatchObject({ outcome: "TODO" });
  });

  it("termékkérdés (KK3): a piszkozat termékei a Készlet termékei közül; eltérő áfakulcs csak megerősítéssel; a termékek az eseménnyel mennek", async () => {
    const draft = (await admin.post(`${c()}/documents`, {
      docType: "SZSZ", partnerId: supplier.id, externalNumber: "KK3-1", description: "Kilincsek", issueDate: "2026-11-21", fulfillmentDate: "2026-11-21", accountingDate: "2026-11-21",
      lines: [{ accountId: acc["261"], side: "D", amount: 20_000_00 }, { accountId: acc["466"], side: "D", amount: 5_400_00 }, { accountId: acc["454"], side: "C", amount: 25_400_00 }],
    })).json() as DocumentDto;
    const url = `${c()}/documents/${draft.id}/integration/stock-lines`;
    const line = { productId: "P9", quantity: 4, netAmount: 20_000_00, vatRate: 18, vatAmount: 3_600_00 };
    const r1 = await admin.put(url, { lines: [line] });
    expect(r1.statusCode, r1.body).toBe(422);
    expect(r1.json().error.fields["lines.0.vatRate"]).toMatch(/eltér/);
    const r2 = await admin.put(url, { lines: [{ ...line, vatRate: 27, vatAmount: 5_400_00 }] });
    expect(r2.statusCode, r2.body).toBe(200);
    await ownerQuery("DELETE FROM integration_outbox");
    expect((await admin.post(`${c()}/documents/${draft.id}/post`)).statusCode).toBe(200);
    const [posted] = await outbox();
    expect(posted!.payload.stockLines).toEqual([{ productId: "P9", productName: "Kilincs", quantity: 4, unit: "db", netAmount: 20_000_00, vatRate: 27, vatAmount: 5_400_00 }]);
    // Termék nélkül könyvelt számla: tájékoztató Teendő (a Készletben kézzel kell rögzíteni).
    const plain = await admin.post(`${c()}/documents`, {
      docType: "SZSZ", partnerId: supplier.id, externalNumber: "KK3-2", description: "Más", issueDate: "2026-11-21", fulfillmentDate: "2026-11-21", accountingDate: "2026-11-21", post: true,
      lines: [{ accountId: acc["529"], side: "D", amount: 1000 }, { accountId: acc["454"], side: "C", amount: 1000 }],
    });
    expect((await todos()).find((t) => t.documentId === plain.json().id)?.title).toMatch(/nem adott meg terméket/);
  });

  it("ismeretlen eseményverzió: Teendő, nem csendes elutasítás", async () => {
    const old = keszletEvent("keszlet.eladas.veglegesitve", 1, "eladas", "V1", { saleId: "V1", date: "2026-11-02", customer: null, cash: true, costOfGoods: 1, lines: [{ productId: "P", quantity: 1, unitPrice: 1, vatRate: 27 }] });
    expect(await deliver(old)).toMatchObject({ outcome: "TODO", todo: { key: "nem-tamogatott:keszlet.eladas.veglegesitve@1" } });
  });

  it("a központ felőli bontás után nem fogad és nem küld", async () => {
    expect((await hub("DELETE", `${LINK_PATH}/${companyId}`)).statusCode).toBe(204);
    expect((await hub("POST", INBOUND_PATH, { event: purchaseEvent("Z1"), targetCompanyRef: companyId })).statusCode).toBe(409);
    await ownerQuery("DELETE FROM integration_outbox");
    await admin.patch(`${c()}/partners/${customer.id}`, { city: "Debrecen" });
    expect(await outbox()).toEqual([]);
  });
});
