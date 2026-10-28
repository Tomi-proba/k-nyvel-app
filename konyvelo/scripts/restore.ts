/**
 * Visszaállítás mentésből:  npm run restore -- <mentésfájl> [--cel <adatbázis-kapcsolat>] [--ellenorzes] [--igen]
 *
 *   --ellenorzes  csak ellenőrzi a mentést (ellenőrzőösszeg, jelszó, olvashatóság), nem állít vissza
 *   --cel         a cél adatbázis TULAJDONOSÁNAK kapcsolata (alapból: DATABASE_MIGRATION_URL)
 *   --igen        megerősítés: a cél adatbázis MINDEN adata törlődik, és a mentés tartalma kerül a helyére
 *
 * Titkosított mentésnél a jelszó a BACKUP_PASSPHRASE környezeti változóból jön. A csatolmányok a
 * beállított fájltárolóba (FAJLTAR, FAJLTAR_...) kerülnek vissza.
 * Visszaállítás előtt állítsa le a programot, utána indítsa újra.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BackupError, restoreBackup, verifyBackup } from "../apps/api/src/core/backup";
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

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--cel");
if (!file) {
  console.error("Használat: npm run restore -- <mentésfájl> [--cel <kapcsolat>] [--ellenorzes] [--igen]");
  process.exit(1);
}
const passphrase = process.env.BACKUP_PASSPHRASE || null;

try {
  if (flag("--ellenorzes")) {
    const r = verifyBackup(path.resolve(file), passphrase);
    console.log(`A mentés rendben van. SHA-256: ${r.sha256}${r.checksumFile ? " (egyezik a .sha256 fájllal)" : " (nincs mellette .sha256 fájl)"}`);
    console.log(r.format === "tar" ? `Csatolmányok: ${r.attachments} db, mindegyik lenyomata egyezik.` : "Régi (csak adatbázist tartalmazó) mentés.");
    if (r.attachmentProblems) console.error(`FIGYELEM: ${r.attachmentProblems} csatolmány már a mentés készítésekor hiányzott vagy megváltozott.`);
    process.exit(0);
  }
  const target = option("--cel") ?? process.env.DATABASE_MIGRATION_URL;
  if (!target) throw new BackupError("Adja meg a cél adatbázist (--cel), vagy állítsa be a DATABASE_MIGRATION_URL-t.");
  const shown = target.replace(/\/\/([^:@/]+):[^@]*@/, "//$1:***@");
  if (!flag("--igen")) {
    console.error(`FIGYELEM: a(z) ${shown} adatbázis MINDEN adata törlődik, és a mentés tartalma kerül a helyére.`);
    console.error("Ha biztos benne, futtassa újra a --igen kapcsolóval. Előtte állítsa le a programot.");
    process.exit(2);
  }
  const r = await restoreBackup({ file: path.resolve(file), targetUrl: target, passphrase, files: createFileStore(fileStoreConfig(process.env)) });
  const { db, pool } = createDb(target);
  try {
    await db.transaction((tx) =>
      writeAudit(tx, {
        companyId: null,
        userId: null,
        action: "backup.restore",
        entityType: "backup",
        entityId: path.basename(file),
        after: { file: path.basename(file), sha256: r.sha256, attachments: r.attachments },
      }),
    );
  } finally {
    await pool.end();
  }
  console.log(`Visszaállítás kész (${shown}). Indítsa újra a programot.`);
} catch (e) {
  console.error(`HIBA: ${e instanceof BackupError ? e.message : (e as Error).message}`);
  process.exit(1);
}
