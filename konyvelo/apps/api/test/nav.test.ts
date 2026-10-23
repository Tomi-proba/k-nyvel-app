import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appQuery, createCompany, createTestApp, login, nextTaxNumber, resetDatabase, setupAdmin, type Client, type TestContext } from "./helpers";
import { digest, FakeGateway } from "./fake-gateway";

const gateway = new FakeGateway();
let ctx: TestContext;
let admin: Client;
let company: { id: string; taxNumber: string };
let acc: Record<string, string>;
let supplier: { id: string; taxNumber: string };

const ft = (n: number) => n * 100;
/** Egy még nem rögzített szállító (a NAV-adatokból vesszük fel). */
const NEW_SUPPLIER = nextTaxNumber();
const url = (p = "") => `/api/companies/${company.id}/nav${p}`;
const base8 = (t: string) => t.replace(/-/g, "").slice(0, 8);

async function waitForRun(id: string) {
  for (let i = 0; i < 100; i++) {
    const r = (await admin.get(url(`/imports/${id}`))).json();
    if (r.status !== "RUNNING") return r;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error("Az import nem fejeződött be.");
}

async function invoiceByNumber(n: string) {
  const list: Array<{ id: string; invoiceNumber: string; state: string }> = (await admin.get(url("/invoices"))).json();
  return list.find((i) => i.invoiceNumber === n)!;
}

beforeAll(async () => {
  await gateway.start();
  await resetDatabase();
  ctx = await createTestApp({ eafaGateway: { url: gateway.url, secret: gateway.secret } });
  admin = await setupAdmin(ctx.app);
  company = await createCompany(admin);
  expect((await admin.post(`/api/companies/${company.id}/fiscal-years`, { startDate: "2026-01-01", endDate: "2026-12-31" })).statusCode).toBe(201);
  const accounts: Array<{ id: string; number: string }> = (await admin.get(`/api/companies/${company.id}/accounts`)).json();
  acc = Object.fromEntries(accounts.map((a) => [a.number, a.id]));
  const tax = nextTaxNumber();
  const res = await admin.post(`/api/companies/${company.id}/partners`, {
    kind: "SUPPLIER",
    name: "Irodaszer Kft.",
    taxNumber: tax,
    defaultPayableAccountId: acc["454"],
    defaultExpenseAccountId: acc["529"],
  });
  supplier = { id: res.json().id, taxNumber: tax };
});
afterAll(async () => {
  await ctx.close();
  await gateway.stop();
});

describe("NAV-import beállítás nélkül", () => {
  it("átjáró nélkül a NAV-import nem érhető el, és ezt érthetően mondja", async () => {
    const plain = await createTestApp();
    try {
      const client = await login(plain.app, "admin@example.hu");
      expect((await client.get(`/api/companies/${company.id}/nav/connection`)).json()).toMatchObject({ available: false, linked: false });
      const link = await client.post(`/api/companies/${company.id}/nav/connection`, { code: "AAAA-BBBB-CCCC-DDDD" });
      expect(link.statusCode).toBe(503);
      expect(link.json().error.message).toMatch(/EAFA_ATJARO_URL/);
    } finally {
      await plain.close();
    }
  });
});

describe("összekapcsolás (D13: az adószám önmagában nem elég)", () => {
  it("kód nélkül, rossz kóddal vagy másik cég kódjával nem kapcsolható össze", async () => {
    expect((await admin.post(url("/connection"), {})).statusCode).toBe(422);
    const wrong = await admin.post(url("/connection"), { code: "AAAA-BBBB-CCCC-DDDD" });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().error.fields.code).toMatch(/érvénytelen/);
    // A másik cég kódja: az eÁFA a cég adószámát is ellenőrzi; az adószámot a Könyvelő küldi, nem a felhasználó.
    gateway.codes.set("OTHERCOMPANYCODE", "99999999");
    expect((await admin.post(url("/connection"), { code: "OTHE-RCOM-PANY-CODE" })).statusCode).toBe(422);
    const sent = gateway.requests.filter((r) => r.path === "/api/gateway/v1/links").map((r) => (r.body as { taxNumber: string }).taxNumber);
    expect(new Set(sent)).toEqual(new Set([company.taxNumber]));
    // Összekapcsolás nélkül semmilyen NAV-adat nem kérhető.
    expect((await admin.post(url("/imports"), { direction: "INBOUND", dateFrom: "2026-09-01", dateTo: "2026-09-30" })).statusCode).toBe(409);
    expect((await admin.get(url("/connection"))).json()).toMatchObject({ available: true, linked: false });
    expect(gateway.badSignatures).toBe(0);
  });

  it("a cég saját kódjával összekapcsolható; a kód nem kerül az audit naplóba", async () => {
    gateway.codes.set("ABCDEFGHJKMNPQRS", base8(company.taxNumber));
    const res = await admin.post(url("/connection"), { code: "abcd-efgh-jkmn-pqrs" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ linked: true, environment: "TEST", eafaTaxpayerName: "Minta Kft. (eÁFA)", remote: { state: "OK" } });
    expect((await admin.post(url("/connection"), { code: "abcd-efgh-jkmn-pqrs" })).statusCode).toBe(409);
    const audit = await appQuery("SELECT action, after::text AS after FROM audit_log WHERE action = 'nav.link'");
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].after).not.toMatch(/ABCD/i);
  });
});

describe("import", () => {
  it("a hosszú időszakot 35 napos ablakokra bontja, lapoz, és egy számlát csak egyszer vesz fel", async () => {
    const s = base8(supplier.taxNumber);
    gateway.pageSize = 2;
    gateway.digests.INBOUND = [
      digest({ invoiceNumber: "IR-1", invoiceIssueDate: "2026-08-10", supplierTaxNumber: s, supplierName: "Irodaszer Kft.", invoiceDeliveryDate: "2026-08-09" }),
      digest({ invoiceNumber: "IR-2", invoiceIssueDate: "2026-08-20", supplierTaxNumber: s, supplierName: "Irodaszer Kft." }),
      digest({ invoiceNumber: "IR-3", invoiceIssueDate: "2026-08-25", supplierTaxNumber: s, supplierName: "Irodaszer Kft." }),
      digest({ invoiceNumber: "UJ-1", invoiceIssueDate: "2026-09-20", supplierTaxNumber: base8(NEW_SUPPLIER), supplierName: "Új Szállító Bt." }),
      digest({
        invoiceNumber: "IR-1-M1",
        invoiceIssueDate: "2026-09-25",
        supplierTaxNumber: s,
        supplierName: "Irodaszer Kft.",
        invoiceOperation: "MODIFY",
        originalInvoiceNumber: "IR-1",
        modificationIndex: 1,
        invoiceNetAmountHuf: -1000,
        invoiceVatAmountHuf: -270,
      }),
      digest({ invoiceNumber: "IR-2-S", invoiceIssueDate: "2026-09-26", supplierTaxNumber: s, invoiceOperation: "STORNO", originalInvoiceNumber: "IR-2", modificationIndex: 1, invoiceNetAmountHuf: -10000, invoiceVatAmountHuf: -2700 }),
    ];
    const start = await admin.post(url("/imports"), { direction: "INBOUND", dateFrom: "2026-08-01", dateTo: "2026-09-30" });
    expect(start.statusCode).toBe(202);
    expect(start.json()).toMatchObject({ status: "RUNNING", windowsTotal: 2 });
    const run = await waitForRun(start.json().id);
    expect(run).toMatchObject({ status: "DONE", windowsDone: 2, foundCount: 6, newCount: 6 });
    const digestCalls = gateway.requests.filter((r) => r.path.endsWith("/invoice-digest")).map((r) => r.body as Record<string, unknown>);
    expect(digestCalls.map((b) => `${b.dateFrom}..${b.dateTo}#${b.page}`)).toEqual(["2026-08-01..2026-09-04#1", "2026-08-01..2026-09-04#2", "2026-09-05..2026-09-30#1", "2026-09-05..2026-09-30#2"]);

    const again = await waitForRun((await admin.post(url("/imports"), { direction: "INBOUND", dateFrom: "2026-08-01", dateTo: "2026-09-30" })).json().id);
    expect(again).toMatchObject({ status: "DONE", foundCount: 6, newCount: 0 });
    expect((await admin.get(url("/invoices?state=NEW"))).json()).toHaveLength(6);
    expect((await admin.get(`/api/companies/${company.id}/todos`)).json().nav).toEqual({ pending: 6, connectionProblem: null });
  });

  it("hosszabb időszak egy importtal nem kérhető", async () => {
    const res = await admin.post(url("/imports"), { direction: "INBOUND", dateFrom: "2025-01-01", dateTo: "2026-09-30" });
    expect(res.statusCode).toBe(422);
  });
});

describe("javaslat és jóváhagyás", () => {
  it("ismert partnernél a partner alapértelmezései szerint javasol, és jóváhagyással könyvel", async () => {
    const inv = await invoiceByNumber("IR-1");
    const detail = (await admin.get(url(`/invoices/${inv.id}`))).json();
    expect(detail.partner).toEqual({ id: supplier.id, name: "Irodaszer Kft." });
    expect(detail.proposal).toMatchObject({ action: "DOCUMENT", docType: "SZSZ", accountingDate: "2026-08-09", blockers: [] });
    expect(detail.proposal.lines.map((l: { accountNumber: string; side: string; amount: number }) => [l.accountNumber, l.side, l.amount])).toEqual([
      ["529", "D", ft(10000)],
      ["466", "D", ft(2700)],
      ["454", "C", ft(12700)],
    ]);
    expect(detail.proposal.warnings.join(" ")).toMatch(/nem teljes számla/);

    const res = await admin.post(url(`/invoices/${inv.id}/approve`), { post: true });
    expect(res.statusCode).toBe(201);
    const doc = (await admin.get(`/api/companies/${company.id}/documents/${res.json().documentId}`)).json();
    expect(doc).toMatchObject({ status: "POSTED", docType: "SZSZ", externalNumber: "IR-1", partnerId: supplier.id });
    expect(res.json().invoice).toMatchObject({ state: "POSTED", documentSerialNumber: doc.serialNumber });
    const src = await appQuery("SELECT source FROM documents WHERE id = $1", [doc.id]);
    expect(src.rows[0].source).toBe("NAV_IMPORT");
    // Egy NAV-számlából csak egy bizonylat.
    expect((await admin.post(url(`/invoices/${inv.id}/approve`), { post: true })).statusCode).toBe(409);
    expect((await admin.get(`/api/companies/${company.id}/todos`)).json().nav.pending).toBe(5);
  });

  it("piszkozatként is átvehető, és a bizonylatok között szerkeszthető", async () => {
    const inv = await invoiceByNumber("IR-3");
    const res = await admin.post(url(`/invoices/${inv.id}/approve`), { post: false, mainAccountId: acc["522"] });
    expect(res.statusCode).toBe(201);
    expect(res.json().invoice.state).toBe("DRAFT");
    const doc = (await admin.get(`/api/companies/${company.id}/documents/${res.json().documentId}`)).json();
    expect(doc.status).toBe("DRAFT");
    expect(doc.lines[0].accountId).toBe(acc["522"]);
  });

  it("módosító számla: helyesbítő bizonylat az eredetire, a különbözettel", async () => {
    const inv = await invoiceByNumber("IR-1-M1");
    const detail = (await admin.get(url(`/invoices/${inv.id}`))).json();
    expect(detail.proposal).toMatchObject({ docType: "HELY", blockers: [] });
    expect(detail.original.serialNumber).toMatch(/^SZSZ-2026-/);
    const res = await admin.post(url(`/invoices/${inv.id}/approve`), { post: true });
    expect(res.statusCode).toBe(201);
    const doc = (await admin.get(`/api/companies/${company.id}/documents/${res.json().documentId}`)).json();
    expect(doc).toMatchObject({ docType: "HELY", status: "POSTED" });
    expect(doc.lines.map((l: { accountId: string; side: string; amount: number }) => [l.accountId, l.side, l.amount])).toEqual([
      [acc["529"], "C", ft(1000)],
      [acc["466"], "C", ft(270)],
      [acc["454"], "D", ft(1270)],
    ]);
  });

  it("sztornó számla: amíg az eredeti nincs könyvelve, nem hagyható jóvá; utána az eredeti sztornója", async () => {
    const storno = await invoiceByNumber("IR-2-S");
    const blocked = await admin.post(url(`/invoices/${storno.id}/approve`), {});
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.message).toMatch(/IR-2.*nincs a rendszerben/);
    const orig = await invoiceByNumber("IR-2");
    expect((await admin.post(url(`/invoices/${orig.id}/approve`), { post: true })).statusCode).toBe(201);
    const res = await admin.post(url(`/invoices/${storno.id}/approve`), {});
    expect(res.statusCode).toBe(201);
    const doc = (await admin.get(`/api/companies/${company.id}/documents/${res.json().documentId}`)).json();
    expect(doc).toMatchObject({ docType: "SZT", status: "POSTED" });
  });

  it("ismeretlen partnernél felajánlja a felvételt a NAV-adatokból", async () => {
    const inv = await invoiceByNumber("UJ-1");
    const detail = (await admin.get(url(`/invoices/${inv.id}`))).json();
    expect(detail.partner).toBeNull();
    expect(detail.newPartner).toMatchObject({ kind: "SUPPLIER", name: "Új Szállító Bt.", taxNumberBase: base8(NEW_SUPPLIER), taxNumberFull: null });
    expect(detail.proposal.blockers.join(" ")).toMatch(/Nincs ilyen adószámú partner/);
    expect((await admin.post(url(`/invoices/${inv.id}/approve`), {})).statusCode).toBe(409);

    const full = NEW_SUPPLIER;
    gateway.invoiceData.set("UJ-1", {
      found: true,
      invoiceXmlBase64: Buffer.from("<InvoiceData/>").toString("base64"),
      insDate: "2026-09-20T10:00:00Z",
      source: "MGM",
      originalRequestVersion: "3.0",
      document: {
        supplierTaxNumberFull: full,
        supplierName: "Új Szállító Bt.",
        lines: [{ lineNumber: 1, description: "Tanácsadás", quantity: 1, unitOfMeasure: "HOUR", netAmountHuf: 10000, vatRate: 0.27, vatCase: null }],
      },
    });
    const res = await admin.post(url(`/invoices/${inv.id}/approve`), { createPartner: true, mainAccountId: acc["528"] });
    expect(res.statusCode).toBe(201);
    expect(res.json().invoice).toMatchObject({ state: "DRAFT", partner: { name: "Új Szállító Bt." } });
    expect(res.json().invoice.lines[0]).toMatchObject({ description: "Tanácsadás", netAmountHuf: ft(10000) });
    const p = await appQuery("SELECT tax_number, kind FROM partners WHERE name = 'Új Szállító Bt.'");
    expect(p.rows[0]).toEqual({ tax_number: full, kind: "SUPPLIER" });
    expect(gateway.requests.some((r) => r.path.endsWith("/invoice-data"))).toBe(true);
  });

  it("figyelmen kívül hagyás indoklással, és visszavétel", async () => {
    gateway.digests.OUTBOUND = [digest({ invoiceNumber: "V-1", invoiceIssueDate: "2026-09-05", supplierTaxNumber: base8(company.taxNumber), customerTaxNumber: "33333333", customerName: "Vevő Kft." })];
    await waitForRun((await admin.post(url("/imports"), { direction: "OUTBOUND", dateFrom: "2026-09-01", dateTo: "2026-09-30" })).json().id);
    const inv = await invoiceByNumber("V-1");
    expect((await admin.post(url(`/invoices/${inv.id}/ignore`), { reason: "" })).statusCode).toBe(422);
    const ignored = await admin.post(url(`/invoices/${inv.id}/ignore`), { reason: "Előlegszámla, külön kezeljük" });
    expect(ignored.json()).toMatchObject({ state: "IGNORED", ignoredReason: "Előlegszámla, külön kezeljük" });
    expect((await admin.post(url(`/invoices/${inv.id}/approve`), {})).statusCode).toBe(409);
    expect((await admin.post(url(`/invoices/${inv.id}/restore`))).json().state).toBe("NEW");
  });
});

describe("hibás kapcsolat és bontás", () => {
  it("lejárt jelszónál az import hibás lesz, és a Teendők között megjelenik", async () => {
    gateway.errors.push({
      status: 502,
      body: { code: "NAV_ERROR", message: "Hibás felhasználónév vagy jelszó.", action: "Kérjen új jelszót a NAV-nál, és rögzítse az eÁFA-ban.", connectionBroken: true },
    });
    const run = await waitForRun((await admin.post(url("/imports"), { direction: "INBOUND", dateFrom: "2026-09-01", dateTo: "2026-09-30" })).json().id);
    expect(run).toMatchObject({ status: "FAILED", errorCode: "NAV_ERROR" });
    expect(run.errorMessage).toMatch(/Hibás felhasználónév vagy jelszó\. Kérjen új jelszót/);
    const todos = (await admin.get(`/api/companies/${company.id}/todos`)).json();
    expect(todos.nav.connectionProblem).toEqual({ title: "Hibás felhasználónév vagy jelszó.", action: "Kérjen új jelszót a NAV-nál, és rögzítse az eÁFA-ban." });
  });

  it("ha az eÁFA-ban visszavonták, a kapcsolat állapota ezt mutatja; a bontás után semmi nem kérdezhető", async () => {
    const link = [...gateway.links.values()][0]!;
    link.active = false;
    link.revokedFrom = "EAFA";
    const c = (await admin.get(url("/connection"))).json();
    expect(c.remote).toMatchObject({ state: "REVOKED", title: expect.stringMatching(/visszavonta/) });
    expect((await admin.get(`/api/companies/${company.id}/todos`)).json().nav.connectionProblem.title).toMatch(/visszavonta/);

    const del = await admin.delete(url("/connection"));
    expect(del.statusCode).toBe(200);
    expect(del.json()).toMatchObject({ linked: false });
    expect((await admin.post(url("/imports"), { direction: "INBOUND", dateFrom: "2026-09-01", dateTo: "2026-09-30" })).statusCode).toBe(409);
    expect((await admin.get(`/api/companies/${company.id}/todos`)).json().nav).toBeNull();
    const audit = await appQuery("SELECT count(*)::int AS n FROM audit_log WHERE action = 'nav.unlink'");
    expect(audit.rows[0].n).toBe(1);
  });
});

describe("a Könyvelő maga nem fordul a NAV-hoz", () => {
  it("a forráskódban nincs NAV-végpont", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "dist") continue;
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name)) files.push(p);
      }
    };
    for (const d of ["apps/api/src", "apps/web/src", "packages/domain/src", "packages/shared/src"]) walk(path.join(root, d));
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter((f) => /onlineszamla\.nav\.gov\.hu|invoiceService\/v3|api(-test)?\.onlineszamla/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
