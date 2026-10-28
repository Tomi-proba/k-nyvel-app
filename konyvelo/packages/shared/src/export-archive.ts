/**
 * Cégexport (PLAN 4.11, K8.2): ZIP-csomag JSON- és CSV-fájlokkal, SHA-256-os tartalomjegyzékkel.
 *
 * A csomag gyökerében:
 * - `manifest.json`: a csomag leírása és MINDEN további fájl mérete és SHA-256 lenyomata;
 * - `sha256sums.txt`: ugyanezek a lenyomatok a szabványos `sha256sum -c` formában (és a manifesté is).
 *
 * Az ellenőrzés (`verifyExport`) a böngészőben és Node-ban is fut: kiolvassa a ZIP-et, és fájlonként
 * összeveti a lenyomatot a tartalomjegyzékkel. Kimutatja a módosult, hiányzó, olvashatatlan és a
 * tartalomjegyzékben nem szereplő fájlokat. A manifest saját lenyomatát a program az audit naplóba is
 * beírja, így az is kiderül, ha valaki a tartalomjegyzéket is átírta.
 */

export const EXPORT_FORMAT = "konyvelo-cegexport/1";
export const EXPORT_MANIFEST = "manifest.json";
export const EXPORT_SUMS = "sha256sums.txt";

export type ExportManifest = {
  format: string;
  company: { id: string; name: string; taxNumber: string };
  generatedAt: string;
  generatedBy: string;
  counts: Record<string, number>;
  files: Array<{ path: string; bytes: number; sha256: string }>;
};

export type ExportFileCheck = {
  path: string;
  status: "OK" | "MODIFIED" | "MISSING" | "UNREADABLE";
  expected: string;
  actual: string | null;
};

export type ExportVerification = {
  ok: boolean;
  /** A manifest olvasható volt-e (ha nem, a fájlonkénti ellenőrzés nem lehetséges). */
  manifest: (Pick<ExportManifest, "format" | "company" | "generatedAt" | "generatedBy"> & { sha256: string }) | null;
  files: ExportFileCheck[];
  /** A csomagban van, de a tartalomjegyzékben nem szerepel. */
  unexpected: string[];
  /** Általános hibák magyarul (pl. nem ZIP, hiányzó manifest, eltérő sha256sums.txt). */
  errors: string[];
};

const td = new TextDecoder("utf-8");

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type ZipEntry = { name: string; method: number; compressedSize: number; offset: number };

/** A ZIP központi könyvtárának kiolvasása (Zip64 nélkül; a cégexport ennél jóval kisebb). */
function centralDirectory(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("A fájl nem ZIP-csomag, vagy a vége hiányzik (csonka letöltés?).");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new Error("A ZIP tartalomjegyzéke sérült.");
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = td.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compressedSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Egy ZIP-bejegyzés tartalma; `null`, ha nem olvasható. */
async function entryData(bytes: Uint8Array, e: ZipEntry): Promise<Uint8Array | null> {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(e.offset, true) !== 0x04034b50) return null;
    const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
    const raw = bytes.subarray(start, start + e.compressedSize);
    if (raw.length !== e.compressedSize) return null;
    if (e.method === 0) return raw;
    if (e.method === 8) return await inflateRaw(raw);
    return null;
  } catch {
    return null;
  }
}

/** A cégexport ellenőrzése: fájlonként a SHA-256 lenyomat a tartalomjegyzékhez képest. */
export async function verifyExport(bytes: Uint8Array): Promise<ExportVerification> {
  const result: ExportVerification = { ok: false, manifest: null, files: [], unexpected: [], errors: [] };
  let entries: ZipEntry[];
  try {
    entries = centralDirectory(bytes);
  } catch (e) {
    result.errors.push((e as Error).message);
    return result;
  }
  const byName = new Map(entries.filter((e) => !e.name.endsWith("/")).map((e) => [e.name, e]));
  const manifestEntry = byName.get(EXPORT_MANIFEST);
  if (!manifestEntry) {
    result.errors.push("A csomagban nincs tartalomjegyzék (manifest.json): ez nem a Könyvelő cégexportja, vagy megsérült.");
    return result;
  }
  const manifestBytes = await entryData(bytes, manifestEntry);
  let manifest: ExportManifest;
  try {
    if (!manifestBytes) throw new Error();
    manifest = JSON.parse(td.decode(manifestBytes)) as ExportManifest;
    if (manifest.format !== EXPORT_FORMAT || !Array.isArray(manifest.files)) throw new Error();
  } catch {
    result.errors.push("A tartalomjegyzék (manifest.json) olvashatatlan vagy sérült.");
    return result;
  }
  const manifestSha = await sha256Hex(manifestBytes);
  result.manifest = {
    format: manifest.format,
    company: manifest.company,
    generatedAt: manifest.generatedAt,
    generatedBy: manifest.generatedBy,
    sha256: manifestSha,
  };

  for (const f of manifest.files) {
    const entry = byName.get(f.path);
    if (!entry) {
      result.files.push({ path: f.path, status: "MISSING", expected: f.sha256, actual: null });
      continue;
    }
    const data = await entryData(bytes, entry);
    if (!data) {
      result.files.push({ path: f.path, status: "UNREADABLE", expected: f.sha256, actual: null });
      continue;
    }
    const actual = await sha256Hex(data);
    result.files.push({ path: f.path, status: actual === f.sha256 && data.length === f.bytes ? "OK" : "MODIFIED", expected: f.sha256, actual });
  }
  const listed = new Set([EXPORT_MANIFEST, EXPORT_SUMS, ...manifest.files.map((f) => f.path)]);
  result.unexpected = [...byName.keys()].filter((n) => !listed.has(n)).sort();

  // A sha256sums.txt-nek ugyanazt kell mondania (a manifestre is).
  const sumsEntry = byName.get(EXPORT_SUMS);
  const sums = sumsEntry ? await entryData(bytes, sumsEntry) : null;
  if (!sums) {
    result.errors.push("Hiányzik vagy olvashatatlan a sha256sums.txt.");
  } else {
    const lines = new Map(
      td
        .decode(sums)
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => {
          const m = l.match(/^([0-9a-f]{64}) [ *](.+)$/);
          return m ? ([m[2]!, m[1]!] as const) : (["", ""] as const);
        }),
    );
    if (lines.get(EXPORT_MANIFEST) !== manifestSha) result.errors.push("A sha256sums.txt szerint a tartalomjegyzék (manifest.json) megváltozott.");
    for (const f of manifest.files) if (lines.get(f.path) !== f.sha256) result.errors.push(`A sha256sums.txt és a manifest.json eltér: ${f.path}`);
  }
  result.ok = result.errors.length === 0 && result.unexpected.length === 0 && result.files.every((f) => f.status === "OK");
  return result;
}

export const EXPORT_FILE_STATUS_LABELS: Record<ExportFileCheck["status"], string> = {
  OK: "Rendben",
  MODIFIED: "Megváltozott vagy megsérült",
  MISSING: "Hiányzik",
  UNREADABLE: "Nem olvasható (sérült)",
};

/** Egy korábbi export az audit naplóból (az ellenőrzéskor ehhez vetjük a manifest lenyomatát). */
export type CompanyExportDto = { at: string; userName: string | null; manifestSha256: string; files: number; bytes: number };
