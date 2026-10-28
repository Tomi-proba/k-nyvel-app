import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { verifyExport, type AttachmentDto, type DocumentDto, type IntegrityReport } from "@konyvelo/shared";
import { S3FileStore } from "../src/core/filestore";
import { createCompany, createTestApp, nextTaxNumber, ownerQuery, resetDatabase, setupAdmin, type Client, type TestContext } from "./helpers";

/** Csatolmányok (K9): típus a tartalom alapján, méretkorlát, SHA-256, lenyomat és lánc, védelem. */

let ctx: TestContext;
let admin: Client;
let companyId: string;
let acc: Record<string, string>;
let supplier: string;

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("IHDR-teszt-kep")]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("JFIF-teszt")]);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const docs = () => `/api/companies/${companyId}/documents`;

function upload(documentId: string, fileName: string, data: Buffer, client: Client = admin) {
  return client.post(`${docs()}/${documentId}/attachments`, data, { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(fileName) });
}

async function draft(post = false): Promise<DocumentDto> {
  const r = await admin.post(docs(), {
    docType: "SZSZ", partnerId: supplier, externalNumber: `SZ-${Math.random().toString(36).slice(2, 8)}`, description: "Irodaszer", issueDate: "2026-03-02",
    fulfillmentDate: "2026-03-02", accountingDate: "2026-03-02", post,
    lines: [{ accountId: acc["529"], side: "D", amount: 10_000 }, { accountId: acc["454"], side: "C", amount: 10_000 }],
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json();
}

const integrity = async () => (await admin.get(`/api/companies/${companyId}/integrity`)).json() as IntegrityReport;
const storedFile = (a: { id: string }) => path.join((ctx.config.fileStore as { dir: string }).dir, companyId, a.id);

beforeAll(async () => {
  await resetDatabase();
  ctx = await createTestApp({ attachmentMaxBytes: 64 * 1024 });
  admin = await setupAdmin(ctx.app);
  companyId = (await createCompany(admin)).id;
  await admin.post(`/api/companies/${companyId}/fiscal-years`, { startDate: "2026-01-01", endDate: "2026-12-31" });
  acc = Object.fromEntries(((await admin.get(`/api/companies/${companyId}/accounts`)).json() as Array<{ id: string; number: string }>).map((a) => [a.number, a.id]));
  supplier = (await admin.post(`/api/companies/${companyId}/partners`, { kind: "SUPPLIER", name: "Papír Kft.", taxNumber: nextTaxNumber() })).json().id;
});
afterAll(async () => ctx.close());

describe("feltöltés és ellenőrzés", () => {
  it("PDF, PNG és JPEG feltölthető; a letöltött tartalom azonos, a lenyomat SHA-256", async () => {
    const d = await draft();
    for (const [name, data, mime] of [["számla március.pdf", PDF, "application/pdf"], ["fotó.png", PNG, "image/png"], ["szkennelt.JPG", JPEG, "image/jpeg"]] as const) {
      const r = await upload(d.id, name, data);
      expect(r.statusCode, r.body).toBe(201);
      const a = r.json() as AttachmentDto;
      expect(a).toMatchObject({ fileName: name, mimeType: mime, sizeBytes: data.length, sha256: sha(data), locked: false, uploadedByName: "Admin Anna" });
      const c = await admin.get(`${docs()}/${d.id}/attachments/${a.id}/content`);
      expect(c.statusCode).toBe(200);
      expect(c.rawPayload.equals(data)).toBe(true);
      expect(c.headers["content-type"]).toBe(mime);
      expect(c.headers["content-disposition"]).toMatch(/^inline; .*filename\*=UTF-8''/);
      expect(c.headers["x-content-type-options"]).toBe("nosniff");
      expect(c.headers["content-security-policy"]).toContain("sandbox");
      const dl = await admin.get(`${docs()}/${d.id}/attachments/${a.id}/content?letoltes=1`);
      expect(dl.headers["content-disposition"]).toMatch(/^attachment;/);
    }
    const dto = (await admin.get(`${docs()}/${d.id}`)).json() as DocumentDto;
    expect(dto.attachments.map((a) => a.fileName)).toEqual(["számla március.pdf", "fotó.png", "szkennelt.JPG"]);
  });

  it("a típust a tartalom dönti el: álcázott, nem engedett, üres és túl nagy fájl nem tölthető fel", async () => {
    const d = await draft();
    const cases: Array<[string, Buffer, number, RegExp]> = [
      ["szamla.pdf", PNG, 422, /nem egyezik|kiterjesztés/i],
      ["kep.png", PDF, 422, /nem egyezik|kiterjesztés/i],
      ["virus.exe", Buffer.from("MZ\x90\x00 futtatható"), 422, /PDF, JPEG vagy PNG/],
      ["szamla.pdf", Buffer.from("<html><script>alert(1)</script>"), 422, /PDF, JPEG vagy PNG/],
      ["ures.pdf", Buffer.alloc(0), 422, /./],
      ["nagy.pdf", Buffer.concat([PDF, Buffer.alloc(70 * 1024)]), 0, /./],
    ];
    for (const [name, data, status, msg] of cases) {
      const r = await upload(d.id, name, data);
      if (status) expect(r.statusCode, `${name}: ${r.body}`).toBe(status);
      else expect([413, 422]).toContain(r.statusCode);
      expect(r.json().error.message).toMatch(msg);
    }
    expect(((await admin.get(`${docs()}/${d.id}/attachments`)).json() as unknown[]).length).toBe(0);
  });

  it("útvonal-trükk a fájlnévben nem jut ki a tárolóból; a név megtisztul", async () => {
    const d = await draft();
    const r = await upload(d.id, "../../etc/passwd.pdf", PDF);
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().fileName).not.toContain("/");
  });

  it("más cég bizonylatához nem lehet feltölteni, és más cég csatolmánya nem olvasható", async () => {
    const d = await draft();
    const a = (await upload(d.id, "a.pdf", PDF)).json() as AttachmentDto;
    const other = (await createCompany(admin)).id;
    expect((await admin.post(`/api/companies/${other}/documents/${d.id}/attachments`, PDF, { "content-type": "application/octet-stream", "x-file-name": "a.pdf" })).statusCode).toBe(404);
    expect((await admin.get(`/api/companies/${other}/documents/${d.id}/attachments/${a.id}/content`)).statusCode).toBe(404);
  });
});

describe("lenyomat, lánc és védelem", () => {
  it("a könyvelés előtt feltöltött csatolmány a bizonylat lenyomatába számít; csatolmány nélkül a lenyomat a régi szabály szerinti", async () => {
    const plain = await draft(true);
    const withFile = await draft();
    await upload(withFile.id, "szamla.pdf", PDF);
    const posted = (await admin.post(`${docs()}/${withFile.id}/post`)).json() as DocumentDto;
    expect(posted.status).toBe("POSTED");
    expect(posted.attachments[0]).toMatchObject({ locked: true, inDocumentHash: true });
    expect(plain.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const report = await integrity();
    expect(report, JSON.stringify(report)).toMatchObject({ ok: true });
    expect(report.documents.checked).toBeGreaterThanOrEqual(2);
  });

  it("könyvelt bizonylathoz újabb csatolmány tölthető, ez azonnal a láncba kerül; törölni nem lehet", async () => {
    const d = await draft(true);
    const a = (await upload(d.id, "utolag.png", PNG)).json() as AttachmentDto;
    expect(a).toMatchObject({ locked: true, inDocumentHash: false });
    const del = await admin.delete(`${docs()}/${d.id}/attachments/${a.id}`);
    expect(del.statusCode).toBe(409);
    expect(del.json().error.message).toMatch(/Szt. 169/);
    // Az adatbázis is tiltja, a séma tulajdonosaként is.
    await expect(ownerQuery("DELETE FROM attachments WHERE id = $1", [a.id])).rejects.toThrow(/nem törölhető/);
    await expect(ownerQuery("UPDATE attachments SET sha256 = repeat('0', 64) WHERE id = $1", [a.id])).rejects.toThrow(/nem módosítható/);
    expect((await integrity()).ok).toBe(true);
  });

  it("piszkozat csatolmánya törölhető (a fájllal együtt), és a piszkozat törlése a csatolmányait is törli", async () => {
    const d = await draft();
    const a = (await upload(d.id, "rossz.pdf", PDF)).json() as AttachmentDto;
    expect((await admin.delete(`${docs()}/${d.id}/attachments/${a.id}`)).statusCode).toBe(200);
    expect(() => readFileSync(storedFile(a))).toThrow();
    const b = (await upload(d.id, "masik.pdf", PDF)).json() as AttachmentDto;
    expect((await admin.delete(`${docs()}/${d.id}`)).statusCode).toBe(200);
    expect(() => readFileSync(storedFile(b))).toThrow();
    const audit = await ownerQuery("SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY id", [d.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(["attachment.upload", "attachment.delete", "document.delete"]));
  });

  it("a tárolt fájl utólagos cseréje kimutatható: az ellenőrzés jelzi, a letöltés 409", async () => {
    const d = await draft();
    const a = (await upload(d.id, "eredeti.pdf", PDF)).json() as AttachmentDto;
    await admin.post(`${docs()}/${d.id}/post`);
    writeFileSync(storedFile(a), Buffer.concat([PDF, Buffer.from("% hamis")]));
    const report = await integrity();
    expect(report.ok).toBe(false);
    expect(report.attachments.problems).toContainEqual(expect.objectContaining({ attachmentId: a.id, reason: "FILE_CHANGED" }));
    const c = await admin.get(`${docs()}/${d.id}/attachments/${a.id}/content`);
    expect(c.statusCode).toBe(409);
    expect(c.json().error.code).toBe("FILE_CHANGED");
    writeFileSync(storedFile(a), PDF);
    expect((await integrity()).ok).toBe(true);
  });

  it("a csatolmány adatainak cseréje az adatbázisban (a védelmet megkerülve) is kimutatható", async () => {
    const d = await draft();
    const a = (await upload(d.id, "x.pdf", PDF)).json() as AttachmentDto;
    await admin.post(`${docs()}/${d.id}/post`);
    const other = Buffer.concat([PDF, Buffer.from("% csere")]);
    writeFileSync(storedFile(a), other);
    await ownerQuery("ALTER TABLE attachments DISABLE TRIGGER attachments_protect");
    try {
      await ownerQuery("UPDATE attachments SET sha256 = $2, size_bytes = $3 WHERE id = $1", [a.id, sha(other), other.length]);
    } finally {
      await ownerQuery("ALTER TABLE attachments ENABLE TRIGGER attachments_protect");
    }
    const report = await integrity();
    expect(report.ok).toBe(false);
    expect(report.documents.problems).toContainEqual(expect.objectContaining({ documentId: d.id, reason: "CONTENT_CHANGED" }));
    expect(report.attachments.problems).toContainEqual(expect.objectContaining({ attachmentId: a.id, reason: "CHAIN_BROKEN" }));
  });
});

describe("cégexport", () => {
  it("a csatolmányok fájljai és listája a csomagban vannak, a tartalomjegyzék szerint sértetlenül", async () => {
    const d = await draft(true);
    const a = (await upload(d.id, "export számla.pdf", PDF)).json() as AttachmentDto;
    const r = await admin.get(`/api/companies/${companyId}/export`);
    expect(r.statusCode).toBe(200);
    const v = await verifyExport(new Uint8Array(r.rawPayload));
    expect(v).toMatchObject({ ok: true, errors: [], unexpected: [] });
    const entry = v.files.find((f) => f.path.endsWith(`${a.id.slice(0, 8)}-export_számla.pdf`));
    expect(entry, JSON.stringify(v.files.map((f) => f.path))).toBeTruthy();
    expect(entry!.path).toBe(`csatolmanyok/${d.serialNumber}/${a.id.slice(0, 8)}-export_számla.pdf`);
    expect(entry).toMatchObject({ status: "OK", expected: sha(PDF) });
    // A lista a feltöltéskori lenyomattal és az állapottal.
    const zip = r.rawPayload;
    let p = 0;
    let list: Array<{ id: string; sha256: string; allapot: string; path: string }> | null = null;
    while (zip.readUInt32LE(p) === 0x04034b50) {
      const size = zip.readUInt32LE(p + 18);
      const nameLen = zip.readUInt16LE(p + 26);
      const start = p + 30 + nameLen + zip.readUInt16LE(p + 28);
      if (zip.subarray(p + 30, p + 30 + nameLen).toString("utf8") === "csatolmanyok.json") list = JSON.parse(inflateRawSync(zip.subarray(start, start + size)).toString("utf8"));
      p = start + size;
    }
    expect(list!.find((x) => x.id === a.id)).toMatchObject({ sha256: sha(PDF), allapot: "RENDBEN", path: entry!.path });
  });
});

describe("S3-tároló", () => {
  let server: Server;
  const objects = new Map<string, Buffer>();
  beforeAll(async () => {
    // Egyszerű, helyi S3-utánzat: PUT, GET, DELETE (útvonal-stílusú címzés).
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const key = decodeURIComponent(new URL(req.url!, "http://x").pathname);
        if (req.method === "PUT") {
          objects.set(key, Buffer.concat(chunks));
          res.writeHead(200, { ETag: '"1"' }).end();
        } else if (req.method === "GET") {
          const o = objects.get(key);
          if (!o) res.writeHead(404, { "Content-Type": "application/xml" }).end("<Error><Code>NoSuchKey</Code><Message>x</Message></Error>");
          else res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": o.length }).end(o);
        } else if (req.method === "DELETE") {
          objects.delete(key);
          res.writeHead(204).end();
        } else res.writeHead(405).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("ugyanazzal a felülettel ír, olvas és töröl", async () => {
    const port = (server.address() as AddressInfo).port;
    const store = new S3FileStore({ endpoint: `http://127.0.0.1:${port}`, region: "eu-central-1", bucket: "csatolmanyok", accessKeyId: "teszt", secretAccessKey: "teszt-titok", forcePathStyle: true });
    const key = `${"1".repeat(8)}-1111-1111-1111-${"1".repeat(12)}/${"2".repeat(8)}-2222-2222-2222-${"2".repeat(12)}`;
    await store.put(key, PDF, "application/pdf");
    expect([...objects.keys()]).toEqual([`/csatolmanyok/${key}`]);
    expect((await store.get(key))?.equals(PDF)).toBe(true);
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
    await expect(store.put("../kilepes", PDF, "application/pdf")).rejects.toThrow(/tárolókulcs/);
  });
});
