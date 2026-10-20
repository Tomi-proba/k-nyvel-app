/**
 * Egyszerű, átlátható migrációfuttató: a migrations/ könyvtár .sql fájljait
 * név szerinti sorrendben, egyenként egy-egy tranzakcióban futtatja, és a
 * schema_migrations táblában tartja nyilván. Egy már lefutott fájl
 * utólagos módosítását (ellenőrzőösszeg-eltérés) hibának tekinti.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, "../../migrations");

export async function runMigrations(connectionString: string, log: (msg: string) => void = () => {}): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Map<string, string>(
      (await client.query<{ name: string; checksum: string }>("SELECT name, checksum FROM schema_migrations")).rows.map(
        (r) => [r.name, r.checksum],
      ),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const previous = done.get(file);
      if (previous) {
        if (previous !== checksum) {
          throw new Error(`A már lefuttatott migráció megváltozott: ${file}. Új migrációs fájlt kell létrehozni.`);
        }
        continue;
      }
      log(`Migráció futtatása: ${file}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [file, checksum]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Hiba a(z) ${file} migrációban: ${(err as Error).message}`, { cause: err });
      }
      applied.push(file);
    }
  } finally {
    await client.end();
  }
  return applied;
}

// Parancssori futtatás: npm run db:migrate
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("Hiányzik a DATABASE_MIGRATION_URL (vagy DATABASE_URL) környezeti változó.");
    process.exit(1);
  }
  runMigrations(url, console.log)
    .then((applied) => {
      console.log(applied.length ? `Kész: ${applied.length} migráció lefutott.` : "Az adatbázis naprakész.");
    })
    .catch((err: Error) => {
      console.error(err.message);
      process.exit(1);
    });
}
