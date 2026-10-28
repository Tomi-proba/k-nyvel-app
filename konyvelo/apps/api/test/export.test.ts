import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { inflateRawSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyExport, type ExportManifest } from "@konyvelo/shared";
import { buildZip } from "../src/core/zip";
import { appQuery, createCompany, createTestApp, nextTaxNumber, PASSWORD, resetDatabase, setupAdmin, login, type Client, type TestContext } from "./helpers";

/** Cégexport (K8.2): ZIP SHA-256-os tartalomjegyzékkel, és ellenőrzés, amely kimutatja a sérülést. */

let ctx: TestContext;
let admin: Client;
let companyId: string;
let otherCompanyId: string;

/** A ZIP fájljai (a teszt saját, független kiolvasásával). */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extra = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString("utf8");
    const start = p + 30 + nameLen + extra;
    out.set(name, inflateRawSync(buf.subarray(start, start + size)));
    p = start + size;
  }
  return out;
}
const rezip = (files: Map<string, Buffer>) => buildZip([...files].map(([name, data]) => ({ name, data })));

async function download(client: Client = admin, id = companyId) {
  const r = await client.get(`/api/companies/${id}/export`);
  expect(r.statusCode, r.body).toBe(200);
  return { zip: r.rawPayload, manifestSha: String(r.headers["x-manifest-sha256"]), headers: r.headers };
}

beforeAll(async () => {
  await resetDatabase();
  ctx = await createTestApp();
  admin = await setupAdmin(ctx.app);
  companyId = (await createCompany(admin, { name: "Export Teszt Kft.", shortName: "Export Kft." })).id;
  otherCompanyId = (await createCompany(admin, { name: "Másik Cég Bt.", shortName: "Másik Bt." })).id;
  await admin.post(`/api/companies/${companyId}/fiscal-years`, { startDate: "2026-01-01", endDate: "2026-12-31" });
  const acc: Record<string, string> = Object.fromEntries(((await admin.get(`/api/companies/${companyId}/accounts`)).json() as Array<{ id: string; number: string }>).map((a) => [a.number, a.id]));
  const supplier = (await admin.post(`/api/companies/${companyId}/partners`, { kind: "SUPPLIER", name: "=HYPERLINK(\"x\") Kft.", taxNumber: nextTaxNumber() })).json().id;
  const r = await admin.post(`/api/companies/${companyId}/documents`, {
    docType: "SZSZ", partnerId: supplier, externalNumber: "SZ-1", description: "Irodaszer; tollak", issueDate: "2026-03-02", fulfillmentDate: "2026-03-02",
    accountingDate: "2026-03-02", post: true,
    lines: [{ accountId: acc["529"], side: "D", amount: 1_000_050 }, { accountId: acc["466"], side: "D", amount: 270_000 }, { accountId: acc["454"], side: "C", amount: 1_270_050 }],
  });
  expect(r.statusCode, r.body).toBe(201);
  await admin.post(`/api/companies/${otherCompanyId}/partners`, { kind: "CUSTOMER", name: "Csak a másik cégé Zrt.", taxNumber: nextTaxNumber() });
});
afterAll(async () => ctx.close());

describe("cégexport", () => {
  it("a csomag minden fájlja szerepel a tartalomjegyzékben, és az ellenőrzés szerint sértetlen", async () => {
    const { zip, manifestSha, headers } = await download();
    expect(headers["content-type"]).toBe("application/zip");
    expect(headers["content-disposition"]).toMatch(/konyvelo-cegexport-\d{11}-\d{4}-\d{2}-\d{2}\.zip/);
    const files = unzip(zip);
    const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8")) as ExportManifest;
    expect(manifest.files.map((f) => f.path)).toEqual(expect.arrayContaining(["ceg.json", "bizonylatok.json", "tetelek.csv", "partnerek.csv", "audit-naplo.json", "README.txt"]));
    expect(manifest.counts).toMatchObject({ bizonylatok: 1, tetelsorok: 3, partnerek: 1 });
    expect([...files.keys()].sort()).toEqual([...manifest.files.map((f) => f.path), "manifest.json", "sha256sums.txt"].sort());

    const v = await verifyExport(new Uint8Array(zip));
    expect(v).toMatchObject({ ok: true, unexpected: [], errors: [] });
    expect(v.manifest).toMatchObject({ company: { name: "Export Teszt Kft." }, sha256: manifestSha, generatedBy: "Admin Anna" });

    // Csak ennek a cégnek az adatai; jelszó-hash és az eÁFA-összekapcsolás azonosítója nincs benne.
    const all = [...files.values()].map((b) => b.toString("utf8")).join("\n");
    expect(all).not.toContain("Csak a másik cégé");
    expect(all).not.toMatch(/argon2|password/i);
    // CSV a magyar Excelnek: BOM, pontosvessző, forintösszeg tizedesvesszővel, képletnek látszó cella hatástalanítva.
    const tetelek = files.get("tetelek.csv")!.toString("utf8");
    expect(tetelek.startsWith("﻿Bizonylat;")).toBe(true);
    expect(tetelek).toContain("SZSZ-2026-00001;POSTED;2026-03-02;1;529;T;10000,50;");
    expect(files.get("partnerek.csv")!.toString("utf8")).toContain(`"'=HYPERLINK(""x"") Kft."`);
    // Az export az audit naplóba kerül a tartalomjegyzék lenyomatával.
    const history = (await admin.get(`/api/companies/${companyId}/exports`)).json();
    expect(history[0]).toMatchObject({ manifestSha256: manifestSha, userName: "Admin Anna" });
  });

  it("kimutatja a módosult, hiányzó, sérült és oda nem tartozó fájlt", async () => {
    const { zip } = await download();
    const files = unzip(zip);

    const modified = new Map(files);
    modified.set("tetelek.csv", Buffer.from(files.get("tetelek.csv")!.toString("utf8").replace("10000,50", "100,50")));
    const m = await verifyExport(new Uint8Array(rezip(modified)));
    expect(m.ok).toBe(false);
    expect(m.files.filter((f) => f.status !== "OK")).toEqual([expect.objectContaining({ path: "tetelek.csv", status: "MODIFIED" })]);

    const missing = new Map(files);
    missing.delete("audit-naplo.json");
    missing.set("valami-mas.txt", Buffer.from("x"));
    const mi = await verifyExport(new Uint8Array(rezip(missing)));
    expect(mi.files.find((f) => f.path === "audit-naplo.json")?.status).toBe("MISSING");
    expect(mi.unexpected).toEqual(["valami-mas.txt"]);

    // Bájtszintű sérülés a tömörített adatban.
    const broken = Buffer.from(zip);
    broken[200] = broken[200]! ^ 0xff;
    const b = await verifyExport(new Uint8Array(broken));
    expect(b.ok).toBe(false);
    expect(b.files.some((f) => f.status === "UNREADABLE" || f.status === "MODIFIED") || b.errors.length > 0).toBe(true);

    // Csonka letöltés.
    const cut = await verifyExport(new Uint8Array(zip.subarray(0, zip.length - 50)));
    expect(cut.errors.join(" ")).toMatch(/nem ZIP-csomag|vége hiányzik/);
  });

  it("ha a tartalomjegyzéket is átírják, a lenyomata eltér az audit naplóban rögzítettől", async () => {
    const { zip, manifestSha } = await download();
    const files = unzip(zip);
    const csv = Buffer.from(files.get("tetelek.csv")!.toString("utf8").replace("10000,50", "100,50"));
    const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8")) as ExportManifest;
    const { createHash } = await import("node:crypto");
    const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    manifest.files = manifest.files.map((f) => (f.path === "tetelek.csv" ? { ...f, bytes: csv.length, sha256: sha(csv) } : f));
    const newManifest = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
    const sums = Buffer.from([...manifest.files.map((f) => `${f.sha256}  ${f.path}`), `${sha(newManifest)}  manifest.json`].join("\n") + "\n");
    const forged = new Map(files);
    forged.set("tetelek.csv", csv);
    forged.set("manifest.json", newManifest);
    forged.set("sha256sums.txt", sums);
    const v = await verifyExport(new Uint8Array(rezip(forged)));
    // A csomag önmagában következetes, de a lenyomata nem szerepel a program exportjai között.
    expect(v.ok).toBe(true);
    const known = ((await admin.get(`/api/companies/${companyId}/exports`)).json() as Array<{ manifestSha256: string }>).map((e) => e.manifestSha256);
    expect(known).toContain(manifestSha);
    expect(known).not.toContain(v.manifest!.sha256);
  });

  it("a parancssori ellenőrző ugyanezt mondja", async () => {
    const { zip } = await download();
    const dir = mkdtempSync(path.join(tmpdir(), "export-teszt-"));
    try {
      const ok = path.join(dir, "jo.zip");
      writeFileSync(ok, zip);
      const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../scripts/export-check.ts");
      const run = promisify(execFile);
      const r = await run("npx", ["tsx", script, ok]);
      expect(r.stdout).toContain("A csomag sértetlen.");
      const files = unzip(zip);
      files.set("ceg.json", Buffer.from("{}"));
      const bad = path.join(dir, "rossz.zip");
      writeFileSync(bad, rezip(files));
      await expect(run("npx", ["tsx", script, bad])).rejects.toMatchObject({ code: 1, stdout: expect.stringMatching(/HIBA\s+ceg\.json – Megváltozott vagy megsérült/) });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("csak Adminisztrátor és Vezető könyvelő exportálhat", async () => {
    const add = await admin.post(`/api/companies/${companyId}/members`, { email: "konyvelo@example.hu", name: "Könyvelő Kata", role: "ACCOUNTANT", initialPassword: PASSWORD });
    expect([200, 201]).toContain(add.statusCode);
    const accountant = await login(ctx.app, "konyvelo@example.hu");
    expect((await accountant.get(`/api/companies/${companyId}/export`)).statusCode).toBe(403);
    const audit = await appQuery("SELECT count(*)::int AS n FROM audit_log WHERE action = 'company.export' AND company_id = $1", [companyId]);
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(4);
  });
});
