import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, type Hash } from "node:crypto";
import { closeSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import type { FileStore } from "./filestore";

/**
 * Teljes mentés és visszaállítás (PLAN 4.11, K8.1, K9).
 *
 * - A mentés egy tar-csomag: az adatbázis a PostgreSQL saját eszközével (`pg_dump`, egyedi formátum,
 *   a séma tulajdonosának kapcsolatával), mellette a csatolmányok fájljai és egy tartalomjegyzék
 *   (`mentes.json`, minden fájl SHA-256 lenyomatával). Az adatbázis és a csatolmányok listája ugyanabból
 *   a pillanatképből készül, így a kettő összetartozik.
 * - Jelszóval titkosítható (AES-256-GCM, a kulcs a jelszóból scrypt-tel). A titkosított mentés
 *   jelszó nélkül nem olvasható, és ha bármelyik bájtja megsérül, a visszaállítás megtagadja.
 * - Minden mentés mellé `.sha256` fájl kerül, amely a mentés ellenőrzőösszege (`sha256sum -c` is érti).
 * - A visszaállítás előbb mindent ellenőriz, utána a cél adatbázis `public` sémáját teljesen
 *   újraépíti, és egyetlen tranzakcióban tölti vissza; végül a csatolmányokat a fájltárolóba írja.
 * - A korábbi (K8-as, csak adatbázist tartalmazó `.dump`) mentések is visszaállíthatók.
 * - A fájlok darabonként, lemezen keresztül mennek, így a mentés mérete nem korlátozza a memóriát.
 */

const run = promisify(execFile);

/** A titkosított mentés fejléce (a fájl elején, olvasható szövegként). */
const MAGIC = Buffer.from("KONYVELO-MENTES-1\n", "utf8");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** scrypt: N=2^15, r=8, p=1 (kb. 32 MB memória, egy tized másodperc). */
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export class BackupError extends Error {}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function key(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.length < 12) throw new BackupError("A mentés jelszava legalább 12 karakter legyen.");
  return scryptSync(passphrase, salt, 32, SCRYPT);
}

export function encryptBackup(plain: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(passphrase, salt), iv);
  cipher.setAAD(MAGIC);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, body, cipher.getAuthTag()]);
}

export function isEncryptedBackup(data: Buffer): boolean {
  return data.subarray(0, MAGIC.length).equals(MAGIC);
}

export function decryptBackup(data: Buffer, passphrase: string): Buffer {
  if (!isEncryptedBackup(data)) throw new BackupError("Ez nem titkosított mentés.");
  const salt = data.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
  const iv = data.subarray(MAGIC.length + SALT_BYTES, MAGIC.length + SALT_BYTES + IV_BYTES);
  const body = data.subarray(MAGIC.length + SALT_BYTES + IV_BYTES, data.length - TAG_BYTES);
  const tag = data.subarray(data.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key(passphrase, salt), iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new BackupError("A mentés nem fejthető vissza: hibás a jelszó, vagy a fájl megsérült.");
  }
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function pgTool(tool: "pg_dump" | "pg_restore", args: string[]): Promise<void> {
  try {
    await run(tool, args, { maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT") {
      throw new BackupError(`A(z) ${tool} program nem található. Telepítse a PostgreSQL ügyféleszközeit (ugyanolyan vagy újabb főverzió, mint a szerveré).`);
    }
    throw new BackupError(`A(z) ${tool} hibát jelzett: ${(err.stderr ?? err.message).trim().split("\n").slice(-3).join(" ")}`);
  }
}

// ---------- Fájlkezelés darabonként ----------

const CHUNK = 1024 * 1024;

/** A fájl `[start, end)` szakaszának bejárása darabonként. */
function eachChunk(fd: number, start: number, end: number, fn: (chunk: Buffer) => void): void {
  const buf = Buffer.alloc(CHUNK);
  for (let pos = start; pos < end; ) {
    const n = readSync(fd, buf, 0, Math.min(CHUNK, end - pos), pos);
    if (n <= 0) throw new BackupError("A mentés váratlanul véget ért (csonka fájl).");
    fn(buf.subarray(0, n));
    pos += n;
  }
}

function fileSha256(file: string): string {
  const fd = openSync(file, "r");
  try {
    const h = createHash("sha256");
    eachChunk(fd, 0, fstatSync(fd).size, (c) => h.update(c));
    return h.digest("hex");
  } finally {
    closeSync(fd);
  }
}

function readRange(fd: number, start: number, length: number): Buffer {
  const out = Buffer.alloc(length);
  let done = 0;
  eachChunk(fd, start, start + length, (c) => {
    c.copy(out, done);
    done += c.length;
  });
  return out;
}

// ---------- Tar (ustar) ----------

/** Egy tar-bejegyzés fejléce (ustar; a név legfeljebb 100 bájt, a méret legfeljebb 8 GB). */
function tarHeader(name: string, size: number, mtime: Date): Buffer {
  const h = Buffer.alloc(512);
  const nameBytes = Buffer.from(name, "utf8");
  if (nameBytes.length > 100) throw new BackupError(`Túl hosszú név a mentésben: ${name}`);
  if (size > 0o77777777777) throw new BackupError(`Túl nagy fájl a mentésben: ${name}`);
  nameBytes.copy(h, 0);
  const oct = (v: number, len: number) => v.toString(8).padStart(len - 1, "0") + "\0";
  h.write(oct(0o600, 8), 100, "ascii");
  h.write(oct(0, 8), 108, "ascii");
  h.write(oct(0, 8), 116, "ascii");
  h.write(oct(size, 12), 124, "ascii");
  h.write(oct(Math.floor(mtime.getTime() / 1000), 12), 136, "ascii");
  h.write("        ", 148, "ascii");
  h.write("0", 156, "ascii");
  h.write("ustar\0" + "00", 257, "ascii");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}

const pad512 = (n: number) => (512 - (n % 512)) % 512;

class TarWriter {
  private fd: number;
  constructor(file: string, private readonly mtime: Date) {
    this.fd = openSync(file, "w", 0o600);
  }
  add(name: string, data: Buffer): void {
    writeSync(this.fd, tarHeader(name, data.length, this.mtime));
    writeSync(this.fd, data);
    writeSync(this.fd, Buffer.alloc(pad512(data.length)));
  }
  addFile(name: string, file: string): string {
    const src = openSync(file, "r");
    try {
      const size = fstatSync(src).size;
      writeSync(this.fd, tarHeader(name, size, this.mtime));
      const h = createHash("sha256");
      eachChunk(src, 0, size, (c) => {
        h.update(c);
        writeSync(this.fd, c);
      });
      writeSync(this.fd, Buffer.alloc(pad512(size)));
      return h.digest("hex");
    } finally {
      closeSync(src);
    }
  }
  close(): void {
    writeSync(this.fd, Buffer.alloc(1024));
    closeSync(this.fd);
  }
}

type TarEntry = { name: string; offset: number; size: number };

/** A tar-csomag bejegyzései (a tartalmuk nélkül). */
function tarEntries(fd: number): TarEntry[] {
  const total = fstatSync(fd).size;
  const out: TarEntry[] = [];
  for (let pos = 0; pos + 512 <= total; ) {
    const h = readRange(fd, pos, 512);
    if (h.every((b) => b === 0)) break;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i]!;
    if (parseInt(h.subarray(148, 156).toString("ascii"), 8) !== sum) throw new BackupError("A mentés megsérült (hibás fejléc).");
    const name = h.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(h.subarray(124, 136).toString("ascii"), 8);
    if (pos + 512 + size > total) throw new BackupError("A mentés váratlanul véget ért (csonka fájl).");
    out.push({ name, offset: pos + 512, size });
    pos += 512 + size + pad512(size);
  }
  return out;
}

// ---------- Titkosítás darabonként ----------

function encryptFile(src: string, dest: string, passphrase: string): void {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(passphrase, salt), iv);
  cipher.setAAD(MAGIC);
  const out = openSync(dest, "w", 0o600);
  const inp = openSync(src, "r");
  try {
    writeSync(out, Buffer.concat([MAGIC, salt, iv]));
    eachChunk(inp, 0, fstatSync(inp).size, (c) => writeSync(out, cipher.update(c)));
    writeSync(out, cipher.final());
    writeSync(out, cipher.getAuthTag());
  } finally {
    closeSync(inp);
    closeSync(out);
  }
}

/** Visszafejtés ideiglenes fájlba; a tartalom csak a hitelesítő címke ellenőrzése után használható. */
function decryptFile(src: string, dest: string, passphrase: string): void {
  const inp = openSync(src, "r");
  const out = openSync(dest, "w", 0o600);
  try {
    const size = fstatSync(inp).size;
    const head = MAGIC.length + SALT_BYTES + IV_BYTES;
    if (size < head + TAG_BYTES) throw new BackupError("A mentés nem fejthető vissza: a fájl csonka.");
    const salt = readRange(inp, MAGIC.length, SALT_BYTES);
    const iv = readRange(inp, MAGIC.length + SALT_BYTES, IV_BYTES);
    const tag = readRange(inp, size - TAG_BYTES, TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key(passphrase, salt), iv);
    decipher.setAAD(MAGIC);
    decipher.setAuthTag(tag);
    eachChunk(inp, head, size - TAG_BYTES, (c) => writeSync(out, decipher.update(c)));
    try {
      writeSync(out, decipher.final());
    } catch {
      throw new BackupError("A mentés nem fejthető vissza: hibás a jelszó, vagy a fájl megsérült.");
    }
  } finally {
    closeSync(inp);
    closeSync(out);
  }
}

function startsWithBytes(file: string, sig: Buffer, offset = 0): boolean {
  const fd = openSync(file, "r");
  try {
    if (fstatSync(fd).size < offset + sig.length) return false;
    return readRange(fd, offset, sig.length).equals(sig);
  } finally {
    closeSync(fd);
  }
}

// ---------- Mentés ----------

export const BACKUP_FORMAT = "konyvelo-mentes/2";
const DB_ENTRY = "adatbazis.dump";
const MANIFEST_ENTRY = "mentes.json";
const BACKUP_NAME = /^konyvelo-\d{8}-\d{6}\.(dump|tar)(\.enc)?$/;

export type BackupManifest = {
  format: typeof BACKUP_FORMAT;
  createdAt: string;
  database: { path: string; bytes: number; sha256: string };
  attachments: Array<{ key: string; path: string | null; sha256: string; bytes: number | null; status: "OK" | "MISSING" | "CHANGED" }>;
};

export type BackupResult = {
  file: string;
  sha256: string;
  bytes: number;
  encrypted: boolean;
  removed: string[];
  attachments: number;
  /** A tárolóból hiányzó vagy megváltozott csatolmányok (a mentés ettől elkészül, de jelezni kell). */
  attachmentProblems: Array<{ key: string; status: "MISSING" | "CHANGED" }>;
};

/**
 * Mentés készítése a `dir` mappába. A régebbi mentésekből a legutóbbi `keep` darab marad meg (0: mind).
 * @param databaseUrl a séma tulajdonosának kapcsolata (DATABASE_MIGRATION_URL)
 * @param files a csatolmányok tárolója (ha nincs megadva, csak az adatbázis kerül a mentésbe)
 */
export async function createBackup(opts: { databaseUrl: string; dir: string; files?: FileStore | null; passphrase?: string | null; keep?: number; now?: Date }): Promise<BackupResult> {
  mkdirSync(opts.dir, { recursive: true });
  const now = opts.now ?? new Date();
  const work = mkdtempSync(path.join(tmpdir(), "konyvelo-mentes-"));
  try {
    const raw = path.join(work, DB_ENTRY);
    // Közös pillanatkép: a pg_dump és a csatolmányok listája ugyanazt az állapotot látja.
    const client = new pg.Client({ connectionString: opts.databaseUrl });
    await client.connect();
    let keys: Array<{ storage_key: string; sha256: string }> = [];
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const snap = (await client.query<{ s: string }>("SELECT pg_export_snapshot() AS s")).rows[0]!.s;
      const hasTable = (await client.query("SELECT to_regclass('public.attachments') IS NOT NULL AS ok")).rows[0].ok as boolean;
      if (hasTable) keys = (await client.query("SELECT storage_key, sha256 FROM attachments ORDER BY storage_key")).rows;
      await pgTool("pg_dump", ["--format=custom", "--compress=6", "--no-owner", `--snapshot=${snap}`, `--file=${raw}`, `--dbname=${opts.databaseUrl}`]);
      await client.query("COMMIT");
    } finally {
      await client.end();
    }
    if (keys.length && !opts.files) throw new BackupError("A mentéshez a csatolmányok tárolója is kell (FAJLTAR beállítás).");

    const tarFile = path.join(work, "mentes.tar");
    const tar = new TarWriter(tarFile, now);
    const manifest: BackupManifest = { format: BACKUP_FORMAT, createdAt: now.toISOString(), database: { path: DB_ENTRY, bytes: statSync(raw).size, sha256: "" }, attachments: [] };
    manifest.database.sha256 = tar.addFile(DB_ENTRY, raw);
    rmSync(raw);
    for (const k of keys) {
      const data = await opts.files!.get(k.storage_key);
      if (!data) {
        manifest.attachments.push({ key: k.storage_key, path: null, sha256: k.sha256, bytes: null, status: "MISSING" });
        continue;
      }
      const entry = `csatolmanyok/${k.storage_key}`;
      tar.add(entry, data);
      const actual = sha256(data);
      manifest.attachments.push({ key: k.storage_key, path: entry, sha256: actual, bytes: data.length, status: actual === k.sha256 ? "OK" : "CHANGED" });
    }
    tar.add(MANIFEST_ENTRY, Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8"));
    tar.close();

    const encrypted = Boolean(opts.passphrase);
    const name = `konyvelo-${stamp(now)}.${encrypted ? "tar.enc" : "tar"}`;
    const file = path.join(opts.dir, name);
    const tmp = `${file}.tmp`;
    if (encrypted) encryptFile(tarFile, tmp, opts.passphrase!);
    else renameSync(tarFile, tmp);
    const hash = fileSha256(tmp);
    renameSync(tmp, file);
    writeFileSync(`${file}.sha256`, `${hash}  ${name}\n`, { mode: 0o600 });
    return {
      file,
      sha256: hash,
      bytes: statSync(file).size,
      encrypted,
      removed: prune(opts.dir, opts.keep ?? 0),
      attachments: keys.length,
      attachmentProblems: manifest.attachments.filter((a) => a.status !== "OK").map((a) => ({ key: a.key, status: a.status as "MISSING" | "CHANGED" })),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** A legrégebbi mentések törlése, hogy legfeljebb `keep` maradjon. */
function prune(dir: string, keep: number): string[] {
  if (!keep || keep < 1) return [];
  const backups = readdirSync(dir).filter((f) => BACKUP_NAME.test(f)).sort().reverse();
  const removed = backups.slice(keep);
  for (const f of removed) {
    rmSync(path.join(dir, f), { force: true });
    rmSync(path.join(dir, `${f}.sha256`), { force: true });
  }
  return removed;
}

// ---------- Ellenőrzés és visszaállítás ----------

type OpenedBackup = {
  sha256: string;
  checksumFile: boolean;
  format: "dump" | "tar";
  /** Az adatbázis-mentés (pg_dump) helye az ideiglenes mappában. */
  dumpFile: string;
  /** Új formátumnál: a tar-csomag és a tartalomjegyzéke. */
  tar: { file: string; entries: Map<string, TarEntry>; manifest: BackupManifest } | null;
};

/**
 * A mentés megnyitása a `work` mappába, és minden ellenőrzése: az ellenőrzőösszeg, a jelszó és a
 * titkosítás hitelesítése, a formátum, valamint új formátumnál minden fájl lenyomata.
 */
function openBackup(file: string, passphrase: string | null | undefined, work: string): OpenedBackup {
  try {
    statSync(file);
  } catch {
    throw new BackupError(`A mentés nem olvasható: ${file}`);
  }
  const hash = fileSha256(file);
  let checksumFile = false;
  try {
    const expected = readFileSync(`${file}.sha256`, "utf8").trim().split(/\s+/)[0];
    checksumFile = true;
    if (expected !== hash) throw new BackupError("A mentés ellenőrzőösszege nem egyezik: a fájl megsérült vagy módosult. Ne állítsa vissza; használjon egy másik mentést.");
  } catch (e) {
    if (e instanceof BackupError) throw e;
  }
  let plain = file;
  if (startsWithBytes(file, MAGIC)) {
    if (!passphrase) throw new BackupError("Ez a mentés titkosított: adja meg a jelszavát (BACKUP_PASSPHRASE).");
    plain = path.join(work, "mentes.visszafejtve");
    decryptFile(file, plain, passphrase);
  }
  if (startsWithBytes(plain, Buffer.from("PGDMP"))) return { sha256: hash, checksumFile, format: "dump", dumpFile: plain, tar: null };
  if (!startsWithBytes(plain, Buffer.from("ustar\0", "ascii"), 257)) throw new BackupError("Ez nem a Könyvelő mentése (ismeretlen fájlformátum).");

  const fd = openSync(plain, "r");
  try {
    const entries = new Map(tarEntries(fd).map((e) => [e.name, e]));
    const m = entries.get(MANIFEST_ENTRY);
    if (!m) throw new BackupError("A mentésből hiányzik a tartalomjegyzék (mentes.json): a fájl megsérült.");
    const manifest = JSON.parse(readRange(fd, m.offset, m.size).toString("utf8")) as BackupManifest;
    if (manifest.format !== BACKUP_FORMAT) throw new BackupError(`Ismeretlen mentésformátum: ${manifest.format}`);
    const db = entries.get(manifest.database.path);
    const dumpFile = path.join(work, DB_ENTRY);
    if (!db) throw new BackupError("A mentésből hiányzik az adatbázis.");
    const out = openSync(dumpFile, "w", 0o600);
    const h = createHash("sha256");
    try {
      eachChunk(fd, db.offset, db.offset + db.size, (c) => {
        h.update(c);
        writeSync(out, c);
      });
    } finally {
      closeSync(out);
    }
    if (h.digest("hex") !== manifest.database.sha256) throw new BackupError("A mentésben az adatbázis lenyomata nem egyezik: a fájl megsérült.");
    for (const a of manifest.attachments) {
      if (!a.path) continue;
      const e = entries.get(a.path);
      if (!e) throw new BackupError(`A mentésből hiányzik egy csatolmány: ${a.key}`);
      const ah: Hash = createHash("sha256");
      eachChunk(fd, e.offset, e.offset + e.size, (c) => ah.update(c));
      if (ah.digest("hex") !== a.sha256) throw new BackupError(`A mentésben egy csatolmány lenyomata nem egyezik: ${a.key}`);
    }
    return { sha256: hash, checksumFile, format: "tar", dumpFile, tar: { file: plain, entries, manifest } };
  } finally {
    closeSync(fd);
  }
}

export type BackupCheck = { sha256: string; checksumFile: boolean; format: "dump" | "tar"; attachments: number; attachmentProblems: number };

/** A mentés ellenőrzése visszaállítás nélkül (ellenőrzőösszeg, jelszó, minden fájl lenyomata). */
export function verifyBackup(file: string, passphrase?: string | null): BackupCheck {
  const work = mkdtempSync(path.join(tmpdir(), "konyvelo-ellenorzes-"));
  try {
    const b = openBackup(file, passphrase, work);
    const atts = b.tar?.manifest.attachments ?? [];
    return { sha256: b.sha256, checksumFile: b.checksumFile, format: b.format, attachments: atts.length, attachmentProblems: atts.filter((a) => a.status !== "OK").length };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Visszaállítás: a cél adatbázis `public` sémája törlődik és újraépül a mentésből, a csatolmányok a
 * `files` tárolóba kerülnek.
 * @param targetUrl a cél adatbázis tulajdonosának kapcsolata
 */
export async function restoreBackup(opts: { file: string; targetUrl: string; files?: FileStore | null; passphrase?: string | null; appRole?: string }): Promise<{ sha256: string; attachments: number }> {
  const work = mkdtempSync(path.join(tmpdir(), "konyvelo-visszaallitas-"));
  try {
    const b = openBackup(opts.file, opts.passphrase, work);
    const atts = (b.tar?.manifest.attachments ?? []).filter((a) => a.path);
    if (atts.length && !opts.files) throw new BackupError("A mentésben csatolmányok is vannak: a visszaállításhoz a fájltároló is kell (FAJLTAR beállítás).");
    // Előbb a fájl olvashatóságát ellenőrizzük (tartalomjegyzék), hogy sérült mentés miatt ne töröljünk semmit.
    await pgTool("pg_restore", ["--list", b.dumpFile]);
    const client = new pg.Client({ connectionString: opts.targetUrl });
    await client.connect();
    try {
      const role = opts.appRole ?? "konyvelo_app";
      await client.query("DROP SCHEMA IF EXISTS public CASCADE");
      await client.query("CREATE SCHEMA public");
      const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
      if (exists.rowCount) await client.query(`GRANT USAGE ON SCHEMA public TO ${client.escapeIdentifier(role)}`);
    } finally {
      await client.end();
    }
    await pgTool("pg_restore", ["--no-owner", "--exit-on-error", "--single-transaction", `--dbname=${opts.targetUrl}`, b.dumpFile]);
    if (atts.length) {
      const fd = openSync(b.tar!.file, "r");
      try {
        for (const a of atts) {
          const e = b.tar!.entries.get(a.path!)!;
          const data = readRange(fd, e.offset, e.size);
          try {
            await opts.files!.put(a.key, data, "application/octet-stream");
          } catch (err) {
            throw new BackupError(`Az adatbázis visszaállt, de egy csatolmányt nem sikerült a tárolóba írni (${a.key}): ${(err as Error).message}. A visszaállítás megismételhető.`);
          }
        }
      } finally {
        closeSync(fd);
      }
    }
    return { sha256: b.sha256, attachments: atts.length };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** A mappában lévő mentések, a legújabb elöl. */
export function listBackups(dir: string): Array<{ name: string; bytes: number; encrypted: boolean }> {
  try {
    return readdirSync(dir)
      .filter((f) => BACKUP_NAME.test(f))
      .sort()
      .reverse()
      .map((name) => ({ name, bytes: statSync(path.join(dir, name)).size, encrypted: name.endsWith(".enc") }));
  } catch {
    return [];
  }
}
