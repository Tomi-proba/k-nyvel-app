import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import pg from "pg";

/**
 * Teljes mentés és visszaállítás (PLAN 4.11, K8.1).
 *
 * - A mentés a PostgreSQL saját eszközével készül (`pg_dump`, egyedi formátum), a séma tulajdonosának
 *   kapcsolatával. Benne van minden cég minden adata, az audit napló és a jogosultságok is.
 * - Jelszóval titkosítható (AES-256-GCM, a kulcs a jelszóból scrypt-tel). A titkosított mentés
 *   jelszó nélkül nem olvasható, és ha bármelyik bájtja megsérül, a visszaállítás megtagadja.
 * - Minden mentés mellé `.sha256` fájl kerül, amely a mentés ellenőrzőösszege (`sha256sum -c` is érti).
 * - A visszaállítás a cél adatbázis `public` sémáját teljesen újraépíti, majd egyetlen tranzakcióban
 *   tölti vissza a mentést: vagy minden visszakerül, vagy semmi.
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

export type BackupResult = { file: string; sha256: string; bytes: number; encrypted: boolean; removed: string[] };

/**
 * Mentés készítése a `dir` mappába. A régebbi mentésekből a legutóbbi `keep` darab marad meg (0: mind).
 * @param databaseUrl a séma tulajdonosának kapcsolata (DATABASE_MIGRATION_URL)
 */
export async function createBackup(opts: { databaseUrl: string; dir: string; passphrase?: string | null; keep?: number; now?: Date }): Promise<BackupResult> {
  mkdirSync(opts.dir, { recursive: true });
  const work = mkdtempSync(path.join(tmpdir(), "konyvelo-mentes-"));
  try {
    const raw = path.join(work, "mentes.dump");
    await pgTool("pg_dump", ["--format=custom", "--compress=6", "--no-owner", `--file=${raw}`, `--dbname=${opts.databaseUrl}`]);
    const plain = readFileSync(raw);
    const encrypted = Boolean(opts.passphrase);
    const data = encrypted ? encryptBackup(plain, opts.passphrase!) : plain;
    const name = `konyvelo-${stamp(opts.now ?? new Date())}.${encrypted ? "dump.enc" : "dump"}`;
    const file = path.join(opts.dir, name);
    writeFileSync(file, data, { mode: 0o600 });
    const hash = sha256(data);
    writeFileSync(`${file}.sha256`, `${hash}  ${name}\n`, { mode: 0o600 });
    return { file, sha256: hash, bytes: data.length, encrypted, removed: prune(opts.dir, opts.keep ?? 0) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** A legrégebbi mentések törlése, hogy legfeljebb `keep` maradjon. */
function prune(dir: string, keep: number): string[] {
  if (!keep || keep < 1) return [];
  const backups = readdirSync(dir)
    .filter((f) => /^konyvelo-\d{8}-\d{6}\.dump(\.enc)?$/.test(f))
    .sort()
    .reverse();
  const removed = backups.slice(keep);
  for (const f of removed) {
    rmSync(path.join(dir, f), { force: true });
    rmSync(path.join(dir, `${f}.sha256`), { force: true });
  }
  return removed;
}

/**
 * A mentés ellenőrzése visszaállítás nélkül: az ellenőrzőösszeg egyezik-e, és (titkosított mentésnél)
 * a jelszóval visszafejthető-e. Visszaadja a visszafejtett tartalmat.
 */
export function verifyBackup(file: string, passphrase?: string | null): { plain: Buffer; sha256: string; checksumFile: boolean } {
  let data: Buffer;
  try {
    data = readFileSync(file);
  } catch {
    throw new BackupError(`A mentés nem olvasható: ${file}`);
  }
  const hash = sha256(data);
  let checksumFile = false;
  try {
    const expected = readFileSync(`${file}.sha256`, "utf8").trim().split(/\s+/)[0];
    checksumFile = true;
    if (expected !== hash) throw new BackupError("A mentés ellenőrzőösszege nem egyezik: a fájl megsérült vagy módosult. Ne állítsa vissza; használjon egy másik mentést.");
  } catch (e) {
    if (e instanceof BackupError) throw e;
  }
  if (isEncryptedBackup(data)) {
    if (!passphrase) throw new BackupError("Ez a mentés titkosított: adja meg a jelszavát (BACKUP_PASSPHRASE).");
    return { plain: decryptBackup(data, passphrase), sha256: hash, checksumFile };
  }
  if (!data.subarray(0, 5).equals(Buffer.from("PGDMP"))) throw new BackupError("Ez nem a Könyvelő mentése (ismeretlen fájlformátum).");
  return { plain: data, sha256: hash, checksumFile };
}

/**
 * Visszaállítás: a cél adatbázis `public` sémája törlődik és újraépül a mentésből.
 * @param targetUrl a cél adatbázis tulajdonosának kapcsolata
 */
export async function restoreBackup(opts: { file: string; targetUrl: string; passphrase?: string | null; appRole?: string }): Promise<{ sha256: string }> {
  const { plain, sha256: hash } = verifyBackup(opts.file, opts.passphrase);
  const work = mkdtempSync(path.join(tmpdir(), "konyvelo-visszaallitas-"));
  try {
    const raw = path.join(work, "mentes.dump");
    writeFileSync(raw, plain, { mode: 0o600 });
    // Előbb a fájl olvashatóságát ellenőrizzük (tartalomjegyzék), hogy sérült mentés miatt ne töröljünk semmit.
    await pgTool("pg_restore", ["--list", raw]);
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
    await pgTool("pg_restore", ["--no-owner", "--exit-on-error", "--single-transaction", `--dbname=${opts.targetUrl}`, raw]);
    return { sha256: hash };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** A mappában lévő mentések, a legújabb elöl. */
export function listBackups(dir: string): Array<{ name: string; bytes: number; encrypted: boolean }> {
  try {
    return readdirSync(dir)
      .filter((f) => /^konyvelo-\d{8}-\d{6}\.dump(\.enc)?$/.test(f))
      .sort()
      .reverse()
      .map((name) => ({ name, bytes: statSync(path.join(dir, name)).size, encrypted: name.endsWith(".enc") }));
  } catch {
    return [];
  }
}
