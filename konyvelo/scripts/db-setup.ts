/**
 * Helyi adatbázis előkészítése – egyszer kell lefuttatni (Windowson, macOS-en
 * és Linuxon is):  npm run db:setup
 *
 * 1. Ha még nincs .env fájl, létrehozza a .env.example alapján.
 * 2. A PostgreSQL rendszergazda-felhasználójával (alapból „postgres”) belép –
 *    a jelszót megkérdezi, vagy a PGPASSWORD környezeti változóból veszi.
 * 3. Létrehozza a két adatbázis-felhasználót a .env-ben megadott jelszóval:
 *      konyvelo_owner – a séma tulajdonosa, csak a migrációkat futtatja
 *      konyvelo_app   – az alkalmazás ezzel fut; az audit naplót csak bővíteni tudja
 * 4. Létrehozza a három adatbázist (fejlesztés, automata tesztek, böngészős
 *    tesztek), UTF-8 kódolással és magyar ábécérenddel, ha a PostgreSQL ezt
 *    támogatja.
 *
 * Többször is lefuttatható: a már meglévő elemeket nem bántja.
 */
import { copyFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import pg from "pg";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const examplePath = fileURLToPath(new URL("../.env.example", import.meta.url));

function fail(message: string): never {
  console.error(`\nHIBA: ${message}\n`);
  process.exit(1);
}

/** Jelszó bekérése úgy, hogy gépelés közben ne látszódjon. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    const writer = rl as unknown as { _writeToOutput: (s: string) => void };
    writer._writeToOutput = (s: string) => {
      if (!muted) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

const NAME_RE = /^[a-z_][a-z0-9_]*$/;

function parseUrl(key: string): { user: string; password: string; database: string } {
  const raw = process.env[key];
  if (!raw) fail(`A .env fájlból hiányzik a ${key} sor. Másolja újra a .env.example tartalmát.`);
  const u = new URL(raw);
  const out = { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) };
  if (!NAME_RE.test(out.user) || !NAME_RE.test(out.database)) fail(`A ${key} felhasználó- vagy adatbázisneve csak kisbetűt, számot és _ jelet tartalmazhat.`);
  return out;
}

async function main() {
  if (!existsSync(envPath)) {
    copyFileSync(examplePath, envPath);
    console.log("✓ Létrehoztam a .env fájlt (a .env.example alapján).");
  } else {
    console.log("✓ A .env fájl már megvan.");
  }
  process.loadEnvFile(envPath);

  const app = parseUrl("DATABASE_URL");
  const owner = parseUrl("DATABASE_MIGRATION_URL");
  const databases = [...new Set(["DATABASE_URL", "TEST_DATABASE_URL", "E2E_DATABASE_URL"].filter((k) => process.env[k]).map((k) => parseUrl(k).database))];

  const superuser = {
    host: process.env.PGHOST ?? "localhost",
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? "postgres",
  };
  const password =
    process.env.PGPASSWORD ?? (await askHidden(`A PostgreSQL „${superuser.user}” felhasználójának jelszava (amit a telepítéskor adott meg): `));

  const connect = async (database: string) => {
    const client = new pg.Client({ ...superuser, password, database });
    try {
      await client.connect();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "ECONNREFUSED") fail(`Nem érem el a PostgreSQL-t (${superuser.host}:${superuser.port}). Fut a PostgreSQL szolgáltatás?`);
      if (code === "28P01") fail("Hibás jelszó. A PostgreSQL telepítésekor megadott jelszót kell beírni.");
      throw err;
    }
    return client;
  };

  const admin = await connect("postgres");
  try {
    for (const role of [owner, app]) {
      const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role.user]);
      const verb = exists.rowCount ? "ALTER" : "CREATE";
      await admin.query(`${verb} ROLE ${admin.escapeIdentifier(role.user)} LOGIN PASSWORD ${admin.escapeLiteral(role.password)}`);
      console.log(`✓ Adatbázis-felhasználó: ${role.user}${exists.rowCount ? " (már létezett, a jelszava a .env szerint)" : " (létrehozva)"}`);
    }

    for (const db of databases) {
      const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [db]);
      if (exists.rowCount) {
        console.log(`✓ Adatbázis: ${db} (már létezett)`);
      } else {
        const base = `CREATE DATABASE ${admin.escapeIdentifier(db)} OWNER ${admin.escapeIdentifier(owner.user)} ENCODING 'UTF8' TEMPLATE template0`;
        try {
          // Magyar ábécérend (ICU); a C beállítás minden operációs rendszeren összefér az UTF-8-cal.
          await admin.query(`${base} LOCALE_PROVIDER icu ICU_LOCALE 'hu-HU' LC_COLLATE 'C' LC_CTYPE 'C'`);
          console.log(`✓ Adatbázis: ${db} (létrehozva, magyar ábécérenddel)`);
        } catch {
          await admin.query(`${base} LC_COLLATE 'C' LC_CTYPE 'C'`);
          console.log(`✓ Adatbázis: ${db} (létrehozva; a magyar ábécérend ezen a PostgreSQL-en nem elérhető)`);
        }
      }
      const c = await connect(db);
      try {
        await c.query(
          `REVOKE ALL ON SCHEMA public FROM PUBLIC; ALTER SCHEMA public OWNER TO ${c.escapeIdentifier(owner.user)}; GRANT USAGE ON SCHEMA public TO ${c.escapeIdentifier(app.user)};`,
        );
      } finally {
        await c.end();
      }
    }
  } finally {
    await admin.end();
  }
  console.log("\nKész. Következő lépés:  npm run db:migrate");
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
