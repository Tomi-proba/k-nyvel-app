/**
 * A böngészős tesztek szervere: újraépíti az e2e adatbázist, majd elindítja
 * az API-t, amely a lefordított felületet (apps/web/dist) is kiszolgálja.
 * Előtte: npm run build
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildApp } from "../apps/api/src/app";
import { loadConfig } from "../apps/api/src/config";
import { createDb } from "../apps/api/src/core/db";
import { runMigrations } from "../apps/api/src/core/migrate";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(here, "../.env"));
} catch {
  // környezeti változók kívülről
}

const appUrl = process.env.E2E_DATABASE_URL;
const ownerUrl = process.env.E2E_DATABASE_MIGRATION_URL;
if (!appUrl || !ownerUrl || !/_e2e\b/.test(appUrl) || !/_e2e\b/.test(ownerUrl)) {
  throw new Error("E2E_DATABASE_URL és E2E_DATABASE_MIGRATION_URL kell, _e2e végű adatbázisnévvel (lásd .env.example).");
}

const client = new pg.Client({ connectionString: ownerUrl });
await client.connect();
await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO konyvelo_app;");
await client.end();
await runMigrations(ownerUrl);

const port = Number(process.env.E2E_PORT ?? 3100);
const config = {
  ...loadConfig({ DATABASE_URL: appUrl, LOG_LEVEL: "warn" }),
  port,
  webDistDir: path.join(here, "../apps/web/dist"),
};
const { db } = createDb(appUrl);
const app = await buildApp(config, db);
await app.listen({ port, host: "127.0.0.1" });
console.log(`E2E szerver: http://127.0.0.1:${port}`);
