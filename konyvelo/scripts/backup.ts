/**
 * Teljes mentés:  npm run backup
 *
 * Környezeti változók (.env):
 *   DATABASE_MIGRATION_URL  a séma tulajdonosának kapcsolata (ezzel készül a mentés)
 *   BACKUP_DIR              hová kerüljön (alapból: ./mentesek)
 *   BACKUP_PASSPHRASE       ha meg van adva, a mentés titkosítva készül (legalább 12 karakter)
 *   BACKUP_KEEP             ennyi legutóbbi mentés marad meg (alapból 30; 0: mind)
 *   FAJLTAR, FAJLTAR_...    a csatolmányok tárolója (ugyanaz, mint a programé; lásd .env.example)
 *
 * Ütemezés: lásd README „Mentés és visszaállítás”.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BackupError, createBackup } from "../apps/api/src/core/backup";
import { writeAudit } from "../apps/api/src/core/audit";
import { createDb } from "../apps/api/src/core/db";
import { createFileStore } from "../apps/api/src/core/filestore";
import { fileStoreConfig } from "../apps/api/src/config";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // a környezeti változók kívülről jönnek
}

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("HIBA: hiányzik a DATABASE_MIGRATION_URL (lásd .env.example).");
  process.exit(1);
}
const dir = path.resolve(root, process.env.BACKUP_DIR || "mentesek");
const keep = Number(process.env.BACKUP_KEEP ?? 30);
const passphrase = process.env.BACKUP_PASSPHRASE || null;

try {
  const r = await createBackup({ databaseUrl: url, dir, passphrase, keep, files: createFileStore(fileStoreConfig(process.env)) });
  const { db, pool } = createDb(url);
  try {
    await db.transaction((tx) =>
      writeAudit(tx, {
        companyId: null,
        userId: null,
        action: "backup.create",
        entityType: "backup",
        entityId: path.basename(r.file),
        after: { file: path.basename(r.file), sha256: r.sha256, bytes: r.bytes, encrypted: r.encrypted, attachments: r.attachments, attachmentProblems: r.attachmentProblems.length },
      }),
    );
  } finally {
    await pool.end();
  }
  console.log(`Mentés kész: ${r.file}`);
  console.log(`Méret: ${(r.bytes / 1024 / 1024).toFixed(2)} MB · titkosítva: ${r.encrypted ? "igen" : "NEM (állítsa be a BACKUP_PASSPHRASE-t)"}`);
  console.log(`SHA-256: ${r.sha256}`);
  console.log(`Csatolmányok: ${r.attachments} db`);
  if (r.attachmentProblems.length) {
    console.error(`FIGYELEM: ${r.attachmentProblems.length} csatolmány hiányzik vagy megváltozott a tárolóban (${r.attachmentProblems.map((p) => `${p.key}: ${p.status === "MISSING" ? "hiányzik" : "megváltozott"}`).join(", ")}).`);
    console.error("A mentés elkészült, de ezeket vissza kell állítani egy korábbi mentésből. Részletek: Napló → Sértetlenség ellenőrzése.");
  }
  if (r.removed.length) console.log(`Törölt régi mentések: ${r.removed.join(", ")}`);
} catch (e) {
  console.error(`HIBA: ${e instanceof BackupError ? e.message : (e as Error).message}`);
  process.exit(1);
}
