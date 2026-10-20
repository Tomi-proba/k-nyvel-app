import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, PASSWORD, appQuery, createCompany, createTestApp, login, nextTaxNumber, ownerQuery, resetDatabase, setupAdmin, type TestContext } from "./helpers";

let ctx: TestContext;
let admin: Client;
let companyId: string;
let acc: Record<string, string>;
let supplierId: string;
let customerId: string;

const NBSP = " ";
const ft = (n: number) => n * 100;
const url = (path = "") => `/api/companies/${companyId}/documents${path}`;

beforeAll(async () => {
  await resetDatabase();
  ctx = await createTestApp();
  admin = await setupAdmin(ctx.app);
  companyId = (await createCompany(admin)).id;
  const fy = await admin.post(`/api/companies/${companyId}/fiscal-years`, { startDate: "2026-01-01", endDate: "2026-12-31" });
  expect(fy.statusCode).toBe(201);
  const accounts: Array<{ id: string; number: string }> = (await admin.get(`/api/companies/${companyId}/accounts`)).json();
  acc = Object.fromEntries(accounts.map((a) => [a.number, a.id]));
  supplierId = (await admin.post(`/api/companies/${companyId}/partners`, { kind: "SUPPLIER", name: "Irodaszer Kft.", taxNumber: nextTaxNumber() })).json().id;
  customerId = (await admin.post(`/api/companies/${companyId}/partners`, { kind: "CUSTOMER", name: "Vevő Bt.", taxNumber: nextTaxNumber() })).json().id;
});
afterAll(async () => ctx.close());

/** Szállítói számla: 529 T nettó, 466 T áfa / 454 K bruttó. */
function supplierInvoice(over: Record<string, unknown> = {}) {
  return {
    docType: "SZSZ",
    partnerId: supplierId,
    externalNumber: "IR-2026/0042",
    description: "Irodatakarítás március",
    issueDate: "2026-03-31",
    fulfillmentDate: "2026-03-31",
    accountingDate: "2026-03-31",
    dueDate: "2026-04-15",
    lines: [
      { accountId: acc["529"], side: "D", amount: ft(10000) },
      { accountId: acc["466"], side: "D", amount: ft(2700) },
      { accountId: acc["454"], side: "C", amount: ft(12700) },
    ],
    ...over,
  };
}

function bankPayment(over: Record<string, unknown> = {}) {
  return {
    docType: "BANK",
    partnerId: supplierId,
    externalNumber: "12/2026",
    description: "Kifizetés: IR-2026/0042",
    issueDate: "2026-04-10",
    accountingDate: "2026-04-10",
    lines: [
      { accountId: acc["454"], side: "D", amount: ft(12700) },
      { accountId: acc["384"], side: "C", amount: ft(12700) },
    ],
    ...over,
  };
}

describe("piszkozat", () => {
  it("félkészen is menthető, a teljesen üres sorok kimaradnak", async () => {
    const res = await admin.post(url(), {
      docType: "SZSZ",
      accountingDate: "2026-03-05",
      lines: [{ accountId: acc["529"], side: "D", amount: ft(500) }, { accountId: null, amount: null }, {}],
    });
    expect(res.statusCode).toBe(201);
    const d = res.json();
    expect(d).toMatchObject({ status: "DRAFT", serialNumber: null, docType: "SZSZ", totalDebit: ft(500), totalCredit: 0 });
    expect(d.lines).toHaveLength(1);
  });

  it("a könyvelés dátumának üzleti évbe kell esnie", async () => {
    const res = await admin.post(url(), { docType: "VEGY", accountingDate: "2027-01-05" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.fields.accountingDate).toMatch(/\(2027\.01\.05\.\) egyik üzleti évbe sem esik/);
  });

  it("módosítható, majd törölhető (naplózva)", async () => {
    const d = (await admin.post(url(), { docType: "VEGY", accountingDate: "2026-03-05", description: "Első" })).json();
    const upd = await admin.patch(url(`/${d.id}`), { docType: "VEGY", accountingDate: "2026-03-06", description: "Második" });
    expect(upd.json()).toMatchObject({ description: "Második", accountingDate: "2026-03-06" });
    expect((await admin.delete(url(`/${d.id}`))).statusCode).toBe(200);
    expect((await admin.get(url(`/${d.id}`))).statusCode).toBe(404);
    const log = (await admin.get(`/api/companies/${companyId}/audit-log`)).json();
    const actions = log.entries.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["document.create", "document.update", "document.delete"]));
  });
});

describe("könyvelés", () => {
  it("egyensúly hiányában magyar hibaüzenet a pontos eltéréssel; semmi nem marad meg", async () => {
    const before = (await admin.get(url())).json().total;
    const res = await admin.post(url(), {
      ...supplierInvoice({ lines: [{ accountId: acc["529"], side: "D", amount: ft(112500) }, { accountId: acc["454"], side: "C", amount: ft(100000) }] }),
      post: true,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.fields.balance).toBe(`A tartozik és követel oldal nem egyezik, eltérés: 12${NBSP}500${NBSP}Ft`);
    expect((await admin.get(url())).json().total).toBe(before);
  });

  it("kötelező kellékek és partner hiánya mezőnként", async () => {
    const res = await admin.post(url(), { docType: "SZSZ", accountingDate: "2026-03-31", lines: supplierInvoice().lines, post: true });
    const f = res.json().error.fields;
    expect(f).toMatchObject({
      description: expect.stringMatching(/gazdasági műveletet/),
      issueDate: "Kelt: kötelező mező.",
      externalNumber: "A szállító számlaszáma: kötelező mező.",
      partnerId: "Válasszon partnert.",
    });
  });

  it("szállítói számla könyvelése: sorszám, tartalmi hash, partner a szállítósoron", async () => {
    const res = await admin.post(url(), { ...supplierInvoice(), post: true });
    expect(res.statusCode).toBe(201);
    const d = res.json();
    expect(d).toMatchObject({ status: "POSTED", serialNumber: "SZSZ-2026-00001", totalDebit: ft(12700), totalCredit: ft(12700), postedByName: "Admin Anna" });
    expect(d.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(d.lines.find((l: { accountNumber: string }) => l.accountNumber === "454").partnerId).toBe(supplierId);
    expect(d.lines.find((l: { accountNumber: string }) => l.accountNumber === "529").partnerId).toBeNull();
    // Rögzítés 2026.03.31-i teljesítésre: a határidő a negyedévet követő hó vége.
    expect(d.deadline).toMatchObject({ kind: "OTHER", deadline: "2026-04-30" });
  });

  it("gyűjtőszámlára és partner nélkül szállítószámlára nem lehet könyvelni", async () => {
    const res = await admin.post(url(), {
      ...bankPayment({ partnerId: null, lines: [{ accountId: acc["45"], side: "D", amount: 100 }, { accountId: acc["454"], side: "D", amount: 100 }, { accountId: acc["384"], side: "C", amount: 200 }] }),
      post: true,
    });
    const f = res.json().error.fields;
    expect(f["lines.0.accountId"]).toMatch(/gyűjtőszámla/);
    expect(f.partnerId).toMatch(/csak partnerrel/);
  });

  it("nem szállító partner szállítói számlán nem könyvelhető", async () => {
    const res = await admin.post(url(), { ...supplierInvoice({ partnerId: customerId }), post: true });
    expect(res.json().error.fields.partnerId).toMatch(/nem szállító/);
  });

  it("sorszám típusonként folyamatos; a sikertelen könyvelés nem fogyaszt sorszámot", async () => {
    const bank1 = (await admin.post(url(), { ...bankPayment(), post: true })).json();
    expect(bank1.serialNumber).toBe("BANK-2026-00001");
    const bad = await admin.post(url(), { ...bankPayment({ lines: [{ accountId: acc["454"], side: "D", amount: 1 }, { accountId: acc["384"], side: "C", amount: 2 }] }), post: true });
    expect(bad.statusCode).toBe(422);
    const bank2 = (await admin.post(url(), { ...bankPayment(), post: true })).json();
    expect(bank2.serialNumber).toBe("BANK-2026-00002");
    const inv2 = (await admin.post(url(), { ...supplierInvoice({ externalNumber: "IR-2026/0043" }), post: true })).json();
    expect(inv2.serialNumber).toBe("SZSZ-2026-00002");
  });

  it("párhuzamos könyvelésnél is hézagmentes a sorszám", async () => {
    const drafts = await Promise.all(Array.from({ length: 8 }, (_, i) => admin.post(url(), { ...supplierInvoice({ externalNumber: `P-${i}` }) })));
    const ids = drafts.map((r) => r.json().id as string);
    const posted = await Promise.all(ids.map((id) => admin.post(url(`/${id}/post`))));
    expect(posted.map((r) => r.statusCode)).toEqual(Array(8).fill(200));
    const serials = posted.map((r) => r.json().serialNumber as string).sort();
    expect(serials).toEqual(Array.from({ length: 8 }, (_, i) => `SZSZ-2026-${String(i + 3).padStart(5, "0")}`));
    // A hash-lánc: minden bizonylat az előző könyvelt bizonylat hash-ére hivatkozik.
    const chain = await ownerQuery("SELECT content_hash, prev_hash FROM documents WHERE company_id = $1 AND status = 'POSTED' ORDER BY posted_at, id", [companyId]);
    for (let i = 1; i < chain.rows.length; i++) expect(chain.rows[i].prev_hash).toBe(chain.rows[i - 1].content_hash);
  });

  it("lezárt időszakba nem lehet könyvelni (alkalmazás és adatbázis szinten sem)", async () => {
    await ownerQuery("UPDATE periods SET status = 'CLOSED' WHERE company_id = $1 AND start_date = '2026-02-01'", [companyId]);
    try {
      const res = await admin.post(url(), { ...supplierInvoice({ accountingDate: "2026-02-15", fulfillmentDate: "2026-02-15", issueDate: "2026-02-15" }), post: true });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.fields.accountingDate).toBe(
        "A(z) 2026. február lezárt időszak, ide nem lehet könyvelni. Rögzítse helyesbítő tételként a nyitott időszakban.",
      );
      // Közvetlen adatbázis-módosítással sem megkerülhető.
      const draft = (await admin.post(url(), supplierInvoice({ accountingDate: "2026-02-15" }))).json();
      await expect(
        appQuery(
          "UPDATE documents SET status = 'POSTED', seq_no = 999, serial_number = 'X', posted_at = now(), posted_by = created_by, content_hash = 'x' WHERE id = $1",
          [draft.id],
        ),
      ).rejects.toThrow(/Lezárt időszakba/);
    } finally {
      await ownerQuery("UPDATE periods SET status = 'OPEN' WHERE company_id = $1 AND start_date = '2026-02-01'", [companyId]);
    }
  });

  it("kiegyensúlyozatlan bizonylat az adatbázisban sem állítható könyveltre", async () => {
    const draft = (await admin.post(url(), supplierInvoice({ lines: [{ accountId: acc["529"], side: "D", amount: 100 }, { accountId: acc["454"], side: "C", amount: 99 }] }))).json();
    await expect(
      appQuery(
        "UPDATE documents SET status = 'POSTED', seq_no = 999, serial_number = 'X', posted_at = now(), posted_by = created_by, content_hash = 'x' WHERE id = $1",
        [draft.id],
      ),
    ).rejects.toThrow(/nem egyezik/);
  });
});

describe("a könyvelt bizonylat védett", () => {
  let doc: { id: string; lines: Array<{ id: string }> };
  beforeAll(async () => {
    doc = (await admin.post(url(), { ...supplierInvoice({ externalNumber: "VEDETT-1" }), post: true })).json();
  });

  it("API: nem módosítható, nem törölhető", async () => {
    const p = await admin.patch(url(`/${doc.id}`), supplierInvoice({ description: "Átírva" }));
    expect(p.statusCode).toBe(409);
    expect(p.json().error.message).toMatch(/sztornóval vagy helyesbítő/);
    expect((await admin.delete(url(`/${doc.id}`))).statusCode).toBe(409);
    expect((await admin.post(url(`/${doc.id}/post`))).statusCode).toBe(409);
  });

  it("adatbázis: a bizonylat és a tételsorai sem írhatók át", async () => {
    await expect(appQuery("UPDATE documents SET description = 'x' WHERE id = $1", [doc.id])).rejects.toThrow(/nem módosítható/);
    await expect(appQuery("DELETE FROM documents WHERE id = $1", [doc.id])).rejects.toThrow(/nem törölhető/);
    await expect(appQuery("UPDATE journal_lines SET amount = 1 WHERE id = $1", [doc.lines[0]!.id])).rejects.toThrow(/nem módosítható/);
    await expect(appQuery("DELETE FROM journal_lines WHERE id = $1", [doc.lines[0]!.id])).rejects.toThrow(/nem módosítható/);
    await expect(
      appQuery("INSERT INTO journal_lines (company_id, document_id, line_no, account_id, side, amount) VALUES ($1, $2, 99, $3, 'D', 1)", [companyId, doc.id, acc["529"]]),
    ).rejects.toThrow(/nem vehető fel/);
    await expect(appQuery("TRUNCATE journal_lines CASCADE")).rejects.toThrow();
  });

  it("a felhasznált számla és partner nem törölhető", async () => {
    expect((await admin.delete(`/api/companies/${companyId}/accounts/${acc["529"]}`)).statusCode).toBe(409);
    expect((await admin.delete(`/api/companies/${companyId}/partners/${supplierId}`)).statusCode).toBe(409);
  });
});

describe("sztornó és helyesbítés", () => {
  it("sztornó: fordított tételek, saját sorszám, kölcsönös hivatkozás; csak egyszer", async () => {
    const orig = (await admin.post(url(), { ...supplierInvoice({ externalNumber: "STORNO-1" }), post: true })).json();
    const res = await admin.post(url(`/${orig.id}/reverse`), { accountingDate: "2026-04-02", reason: "Téves rögzítés" });
    expect(res.statusCode).toBe(201);
    const s = res.json();
    expect(s).toMatchObject({
      docType: "SZT",
      status: "POSTED",
      serialNumber: "SZT-2026-00001",
      externalNumber: orig.serialNumber,
      description: `Sztornó: ${orig.serialNumber} – Téves rögzítés`,
      reverses: { id: orig.id, serialNumber: orig.serialNumber },
      partnerId: supplierId,
    });
    expect(s.lines.map((l: { accountNumber: string; side: string; amount: number }) => [l.accountNumber, l.side, l.amount])).toEqual([
      ["529", "C", ft(10000)],
      ["466", "C", ft(2700)],
      ["454", "D", ft(12700)],
    ]);
    expect((await admin.get(url(`/${orig.id}`))).json().reversedBy).toMatchObject({ id: s.id, serialNumber: "SZT-2026-00001" });

    const again = await admin.post(url(`/${orig.id}/reverse`), { accountingDate: "2026-04-02", reason: "Még egyszer" });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.message).toMatch(/már sztornózták \(SZT-2026-00001\)/);
    expect((await admin.post(url(`/${s.id}/reverse`), { accountingDate: "2026-04-02", reason: "Sztornó sztornója" })).statusCode).toBe(409);

    const reversed = (await admin.get(url("?status=REVERSED"))).json();
    expect(reversed.items.map((i: { id: string }) => i.id)).toContain(orig.id);
    expect(reversed.items.find((i: { id: string }) => i.id === orig.id).reversed).toBe(true);
  });

  it("piszkozat nem sztornózható; az ok kötelező", async () => {
    const draft = (await admin.post(url(), supplierInvoice())).json();
    expect((await admin.post(url(`/${draft.id}/reverse`), { accountingDate: "2026-04-02", reason: "Hiba" })).statusCode).toBe(409);
    const posted = (await admin.post(url(), { ...supplierInvoice({ externalNumber: "OK-NELKUL" }), post: true })).json();
    const r = await admin.post(url(`/${posted.id}/reverse`), { accountingDate: "2026-04-02", reason: "" });
    expect(r.json().error.fields.reason).toMatch(/okát/);
  });

  it("helyesbítő bizonylat az eredetire hivatkozik", async () => {
    const orig = (await admin.post(url(), { ...supplierInvoice({ externalNumber: "HELY-1" }), post: true })).json();
    const noRef = await admin.post(url(), { docType: "HELY", accountingDate: "2026-04-03" });
    expect(noRef.json().error.fields.docType).toMatch(/eredeti/);
    const res = await admin.post(url(), {
      docType: "HELY",
      correctsDocumentId: orig.id,
      partnerId: supplierId,
      description: "Helyesbítés: utólagos engedmény",
      issueDate: "2026-04-03",
      accountingDate: "2026-04-03",
      lines: [
        { accountId: acc["454"], side: "D", amount: ft(1270) },
        { accountId: acc["529"], side: "C", amount: ft(1000) },
        { accountId: acc["466"], side: "C", amount: ft(270) },
      ],
      post: true,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ serialNumber: "HELY-2026-00001", corrects: { id: orig.id }, affectsFiscalYearId: null });
    expect((await admin.get(url(`/${orig.id}`))).json().correctedBy).toEqual([expect.objectContaining({ serialNumber: "HELY-2026-00001" })]);
  });
});

describe("lista, teendők, jogosultság", () => {
  it("keresés és szűrés", async () => {
    const byType = (await admin.get(url("?type=BANK&status=POSTED"))).json();
    expect(byType.items.length).toBeGreaterThan(0);
    expect(byType.items.every((i: { docType: string; status: string }) => i.docType === "BANK" && i.status === "POSTED")).toBe(true);
    const search = (await admin.get(url("?q=irodaszer"))).json();
    expect(search.items.length).toBeGreaterThan(0);
    const paged = (await admin.get(url("?limit=2&offset=0"))).json();
    expect(paged.items).toHaveLength(2);
    expect(paged.total).toBeGreaterThan(2);
  });

  it("teendők: piszkozatok határidővel, késve könyvelt bizonylatok", async () => {
    // Pénztári piszkozat régi dátummal: a határidő (a pénzmozgás napja) lejárt.
    const cash = (
      await admin.post(url(), {
        docType: "PK",
        description: "Postaköltség",
        issueDate: "2026-01-12",
        accountingDate: "2026-01-12",
        lines: [
          { accountId: acc["527"], side: "D", amount: ft(1500) },
          { accountId: acc["381"], side: "C", amount: ft(1500) },
        ],
      })
    ).json();
    // Január eleji teljesítés, csak most könyvelve: a negyedévet követő hó vége (04.30.) után.
    await admin.post(url(), { ...supplierInvoice({ externalNumber: "KESO-1", issueDate: "2026-01-10", fulfillmentDate: "2026-01-10", accountingDate: "2026-01-10" }), post: true });

    const todos = (await admin.get(`/api/companies/${companyId}/todos`)).json();
    const item = todos.drafts.find((d: { id: string }) => d.id === cash.id);
    expect(item).toMatchObject({ docType: "PK", total: ft(1500), deadline: { kind: "CASH", deadline: "2026-01-12", status: "OVERDUE" } });
    expect(todos.latePostedLast30Days).toBeGreaterThanOrEqual(1);
    expect(todos.unmappedAccounts).toBe(0);
    const late = (await admin.get(url("?late=1"))).json();
    expect(late.items.some((i: { externalNumber: string }) => i.externalNumber === "KESO-1")).toBe(true);
    expect(late.items.every((i: { deadline: { status: string } }) => i.deadline.status === "LATE")).toBe(true);
  });

  it("a Megtekintő olvashat, de nem rögzíthet; más cég bizonylata nem érhető el", async () => {
    await admin.post(`/api/companies/${companyId}/members`, { email: "nezo@example.hu", name: "Néző Nóra", role: "VIEWER", initialPassword: PASSWORD });
    const viewer = await login(ctx.app, "nezo@example.hu");
    expect((await viewer.get(url())).statusCode).toBe(200);
    expect((await viewer.post(url(), supplierInvoice())).statusCode).toBe(403);
    const other = (await createCompany(admin)).id;
    const someDoc = (await admin.get(url("?limit=1"))).json().items[0];
    expect((await admin.get(`/api/companies/${other}/documents/${someDoc.id}`)).statusCode).toBe(404);
  });
});

describe("kontírozási sablonok", () => {
  it("új cég alapértelmezett sablonokkal indul", async () => {
    const list = (await admin.get(`/api/companies/${companyId}/templates`)).json();
    expect(list.map((t: { shortcut: string }) => t.shortcut).sort()).toEqual(["ANYAG", "BBE", "BKI", "BKTG", "SZOLG", "VEVO"]);
    const szolg = list.find((t: { shortcut: string }) => t.shortcut === "SZOLG");
    expect(szolg).toMatchObject({ docType: "SZSZ", vatRate: 27 });
    expect(szolg.lines).toEqual([
      { accountId: acc["529"], side: "D", base: "NET" },
      { accountId: acc["466"], side: "D", base: "VAT" },
      { accountId: acc["454"], side: "C", base: "GROSS" },
    ]);
  });

  it("létrehozás, foglalt rövid kód, gyűjtőszámla, módosítás, törlés", async () => {
    const t = { name: "Telefonszámla", shortcut: "TEL", docType: "SZSZ", vatRate: 27, lines: [{ accountId: acc["527"], side: "D", base: "NET" }, { accountId: acc["466"], side: "D", base: "VAT" }, { accountId: acc["454"], side: "C", base: "GROSS" }] };
    const created = await admin.post(`/api/companies/${companyId}/templates`, t);
    expect(created.statusCode).toBe(201);
    expect((await admin.post(`/api/companies/${companyId}/templates`, { ...t, shortcut: "tel" })).json().error.fields.shortcut).toMatch(/foglalt/);
    const bad = await admin.post(`/api/companies/${companyId}/templates`, { ...t, shortcut: null, lines: [{ accountId: acc["52"], side: "D", base: "NET" }, { accountId: acc["454"], side: "D", base: "GROSS" }] });
    expect(bad.json().error.fields).toMatchObject({ "lines.0.accountId": expect.stringMatching(/gyűjtőszámla/), lines: expect.stringMatching(/követel/) });
    const id = created.json().id;
    expect((await admin.patch(`/api/companies/${companyId}/templates/${id}`, { vatRate: 5 })).json().vatRate).toBe(5);
    expect((await admin.delete(`/api/companies/${companyId}/templates/${id}`)).statusCode).toBe(200);
    expect((await admin.post(`/api/companies/${companyId}/templates/load-default`)).statusCode).toBe(409);
  });
});
