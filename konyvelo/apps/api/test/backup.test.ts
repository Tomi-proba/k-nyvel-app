import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BackupError, createBackup, restoreBackup, verifyBackup } from "../src/core/backup";
import { createCompany, createTestApp, login, nextTaxNumber, resetDatabase, setupAdmin, type Client, type TestContext } from "./helpers";

/**
 * Mentés és visszaállítás (K8.1): egy teljes mentésből egy MÁSIK adatbázisba visszaállítva minden
 * kimutatás pontosan ugyanazt adja, mint az eredeti adatbázison, és az audit-lánc sértetlen.
 */

const sourceOwner = process.env.TEST_DATABASE_MIGRATION_URL!;
const targetApp = process.env.RESTORE_TEST_DATABASE_URL;
const targetOwner = process.env.RESTORE_TEST_DATABASE_MIGRATION_URL;
if (!targetApp || !targetOwner || !/_restore_test\b/.test(targetApp) || !/_restore_test\b/.test(targetOwner)) {
  throw new Error("A visszaállítás tesztjéhez RESTORE_TEST_DATABASE_URL és RESTORE_TEST_DATABASE_MIGRATION_URL kell, _restore_test végű adatbázissal (lásd .env.example; npm run db:setup).");
}

const PASSPHRASE = "teszt-mentes-jelszava-2026";
const ft = (n: number) => n * 100;
let ctx: TestContext;
let admin: Client;
let companyId: string;
let acc: Record<string, string>;
let supplier: string;
let customer: string;
let dir: string;

/** Minden kimutatás és lista, amelyet a visszaállítás után össze kell vetni. */
async function snapshot(client: Client): Promise<Record<string, unknown>> {
  const c = `/api/companies/${companyId}`;
  const paths: Record<string, string> = {
    fokonyviKivonat: `${c}/reports/trial-balance?from=2026-01-01&to=2026-12-31`,
    fokonyviKivonatJanuar: `${c}/reports/trial-balance?from=2026-01-01&to=2026-01-31`,
    naplofokonyv: `${c}/reports/journal?from=2026-01-01&to=2026-12-31`,
    kartonSzallitok: `${c}/reports/ledger?accountId=${acc["454"]}&from=2026-01-01&to=2026-12-31`,
    kartonBank: `${c}/reports/ledger?accountId=${acc["384"]}&from=2026-01-01&to=2026-12-31`,
    kartonPartner: `${c}/reports/ledger?partnerId=${customer}&from=2026-01-01&to=2026-12-31`,
    merleg: `${c}/reports/balance-sheet?asOf=2026-12-31`,
    eredmenykimutatas: `${c}/reports/income-statement?from=2026-01-01&to=2026-12-31`,
    nyitottTetelek: `${c}/open-items?asOf=2026-12-31`,
    egyeztetes: `${c}/reconciliation?asOf=2026-12-31`,
    bizonylatok: `${c}/documents?limit=500`,
    partnerek: `${c}/partners`,
    szamlatukor: `${c}/accounts`,
    uzletiEvek: `${c}/fiscal-years`,
    auditNaplo: `${c}/audit-log?limit=500`,
    auditEllenorzes: `${c}/audit-log/verify`,
  };
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(paths)) {
    const r = await client.get(p);
    expect(r.statusCode, `${k}: ${r.body}`).toBe(200);
    out[k] = r.json();
  }
  return out;
}

beforeAll(async () => {
  await resetDatabase();
  ctx = await createTestApp();
  admin = await setupAdmin(ctx.app);
  companyId = (await createCompany(admin)).id;
  const fy = await admin.post(`/api/companies/${companyId}/fiscal-years`, { startDate: "2026-01-01", endDate: "2026-12-31" });
  expect(fy.statusCode).toBe(201);
  acc = Object.fromEntries(((await admin.get(`/api/companies/${companyId}/accounts`)).json() as Array<{ id: string; number: string }>).map((a) => [a.number, a.id]));
  supplier = (await admin.post(`/api/companies/${companyId}/partners`, { kind: "SUPPLIER", name: "Irodaház Kft.", taxNumber: nextTaxNumber(), defaultPayableAccountId: acc["454"] })).json().id;
  customer = (await admin.post(`/api/companies/${companyId}/partners`, { kind: "CUSTOMER", name: "Ügyfél Zrt.", taxNumber: nextTaxNumber() })).json().id;
  const L = (n: string, side: "D" | "C", amount: number) => ({ accountId: acc[n], side, amount: ft(amount) });
  const post = async (body: Record<string, unknown>) => {
    const r = await admin.post(`/api/companies/${companyId}/documents`, { ...body, post: true });
    expect(r.statusCode, r.body).toBe(201);
    return r.json();
  };
  // Január: nyitó tőke, majd az időszak lezárása.
  await post({ docType: "VEGY", description: "Jegyzett tőke befizetése", issueDate: "2026-01-05", accountingDate: "2026-01-05", lines: [L("384", "D", 3000000), L("411", "C", 3000000)] });
  // Október: szállítói és vevőszámla, kifizetés kiegyenlítéssel, bankköltség, egy sztornó és egy helyesbítő.
  const rent = await post({
    docType: "SZSZ", partnerId: supplier, externalNumber: "IH-101", description: "Irodabérlet", issueDate: "2026-10-01", fulfillmentDate: "2026-10-01",
    accountingDate: "2026-10-01", dueDate: "2026-10-15", lines: [L("522", "D", 100000), L("466", "D", 27000), L("454", "C", 127000)],
  });
  const sale = await post({
    docType: "VSZ", partnerId: customer, externalNumber: "2026/0001", description: "Tanácsadás", issueDate: "2026-10-05", fulfillmentDate: "2026-10-05",
    accountingDate: "2026-10-05", dueDate: "2026-10-20", lines: [L("311", "D", 254000), L("912", "C", 200000), L("467", "C", 54000)],
  });
  const payableLine = rent.lines.find((l: { accountId: string }) => l.accountId === acc["454"]).id;
  await post({
    docType: "BANK", partnerId: supplier, description: "Kifizetés IH-101", issueDate: "2026-10-10", accountingDate: "2026-10-10",
    lines: [L("454", "D", 127000), L("384", "C", 127000)], settlements: [{ itemLineId: payableLine, amount: ft(127000) }],
  });
  await post({ docType: "BANK", description: "Számlavezetési díj", issueDate: "2026-10-31", accountingDate: "2026-10-31", lines: [L("532", "D", 2350), L("384", "C", 2350)] });
  const dup = await post({
    docType: "SZSZ", partnerId: supplier, externalNumber: "IH-101 dupla", description: "Kétszer rögzítve", issueDate: "2026-10-01", fulfillmentDate: "2026-10-01",
    accountingDate: "2026-10-01", lines: [L("522", "D", 100000), L("466", "D", 27000), L("454", "C", 127000)],
  });
  expect((await admin.post(`/api/companies/${companyId}/documents/${dup.id}/reverse`, { accountingDate: "2026-10-02", reason: "Kétszer rögzítve" })).statusCode).toBe(201);
  await post({
    docType: "HELY", partnerId: customer, correctsDocumentId: sale.id, externalNumber: "2026/0001-H", description: "Árengedmény", issueDate: "2026-10-25",
    fulfillmentDate: "2026-10-25", accountingDate: "2026-10-25", lines: [L("912", "D", 20000), L("467", "D", 5400), L("311", "C", 25400)],
  });
  // Egy piszkozat is (a visszaállítás után is piszkozat marad).
  expect((await admin.post(`/api/companies/${companyId}/documents`, { docType: "VEGY", description: "Félkész", accountingDate: "2026-11-02" })).statusCode).toBe(201);
  const periods = (await admin.get(`/api/companies/${companyId}/fiscal-years`)).json()[0].periods as Array<{ id: string; startDate: string }>;
  const jan = periods.find((p) => p.startDate === "2026-01-01")!;
  expect((await admin.post(`/api/companies/${companyId}/periods/${jan.id}/close`)).statusCode).toBe(200);
  dir = mkdtempSync(path.join(tmpdir(), "konyvelo-mentes-teszt-"));
});

afterAll(async () => {
  await ctx?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("mentés és visszaállítás", () => {
  it("egy teljes, titkosított mentésből visszaállított adatbázison minden kimutatás ugyanaz", async () => {
    const before = await snapshot(admin);
    expect((before.auditEllenorzes as { ok: boolean }).ok).toBe(true);
    expect((before.bizonylatok as { total: number }).total).toBe(9);

    const backup = await createBackup({ databaseUrl: sourceOwner, dir, passphrase: PASSPHRASE });
    expect(backup.encrypted).toBe(true);
    // A titkosított mentésben a cégnév és a partnerek nevei sem olvashatók.
    expect(readFileSync(backup.file).includes(Buffer.from("Irodaház"))).toBe(false);
    expect(readFileSync(`${backup.file}.sha256`, "utf8")).toBe(`${backup.sha256}  ${path.basename(backup.file)}\n`);

    await restoreBackup({ file: backup.file, targetUrl: targetOwner!, passphrase: PASSPHRASE });
    const restored = await createTestApp({}, targetApp);
    try {
      const client = await login(restored.app, "admin@example.hu");
      const after = await snapshot(client);
      for (const key of Object.keys(before)) expect(after[key], key).toEqual(before[key]);
      // A védelmek is visszakerültek: a könyvelt bizonylat nem módosítható, a lezárt időszakba nem lehet könyvelni.
      const closed = await client.post(`/api/companies/${companyId}/documents`, {
        docType: "VEGY", description: "Januári utólagos", issueDate: "2026-01-20", accountingDate: "2026-01-20", post: true,
        lines: [{ accountId: acc["532"], side: "D", amount: 100 }, { accountId: acc["384"], side: "C", amount: 100 }],
      });
      expect(closed.statusCode).toBe(422);
      expect(closed.json().error.fields.accountingDate).toMatch(/lezárt időszak/);
      // A restore után is tovább lehet könyvelni, hézagmentes sorszámmal.
      const next = await client.post(`/api/companies/${companyId}/documents`, {
        docType: "BANK", description: "Új tétel a visszaállítás után", issueDate: "2026-11-05", accountingDate: "2026-11-05", post: true,
        lines: [{ accountId: acc["532"], side: "D", amount: 100 }, { accountId: acc["384"], side: "C", amount: 100 }],
      });
      expect(next.statusCode, next.body).toBe(201);
      expect(next.json().serialNumber).toBe("BANK-2026-00003");
    } finally {
      await restored.close();
    }
  });

  it("hibás jelszóval vagy sérült fájllal nem állít vissza, és a cél adatbázishoz nem nyúl", async () => {
    const backup = await createBackup({ databaseUrl: sourceOwner, dir, passphrase: PASSPHRASE });
    expect(() => verifyBackup(backup.file, "rossz-jelszo-12345")).toThrow(/hibás a jelszó/);
    expect(() => verifyBackup(backup.file, null)).toThrow(/titkosított/);

    const damaged = Buffer.from(readFileSync(backup.file));
    damaged[damaged.length - 100] = damaged[damaged.length - 100]! ^ 0xff;
    writeFileSync(backup.file, damaged);
    await expect(restoreBackup({ file: backup.file, targetUrl: targetOwner!, passphrase: PASSPHRASE })).rejects.toThrow(/ellenőrzőösszege nem egyezik/);
    // A .sha256 fájl nélkül is kiderül (a titkosítás hitelesítő címkéje miatt).
    rmSync(`${backup.file}.sha256`);
    await expect(restoreBackup({ file: backup.file, targetUrl: targetOwner!, passphrase: PASSPHRASE })).rejects.toThrow(BackupError);
    // Az előző teszt visszaállítása érintetlen maradt.
    const restored = await createTestApp({}, targetApp);
    try {
      const client = await login(restored.app, "admin@example.hu");
      expect((await client.get(`/api/companies/${companyId}/audit-log/verify`)).json().ok).toBe(true);
    } finally {
      await restored.close();
    }
  });

  it("titkosítás nélkül is ment; a régi mentésekből csak a beállított számú marad", async () => {
    const sub = mkdtempSync(path.join(dir, "rotacio-"));
    const times = ["2026-10-01T02:00:00", "2026-10-02T02:00:00", "2026-10-03T02:00:00"];
    let last;
    for (const t of times) last = await createBackup({ databaseUrl: sourceOwner, dir: sub, keep: 2, now: new Date(t) });
    expect(last!.encrypted).toBe(false);
    expect(last!.removed).toEqual(["konyvelo-20261001-020000.dump"]);
    expect(verifyBackup(last!.file).checksumFile).toBe(true);
  });
});
