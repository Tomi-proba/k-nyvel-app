/**
 * A böngészős tesztek szervere: újraépíti az e2e adatbázist, majd elindítja
 * az API-t, amely a lefordított felületet (apps/web/dist) is kiszolgálja.
 * Előtte: npm run build
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildApp } from "../apps/api/src/app";
import { loadConfig } from "../apps/api/src/config";
import { createDb } from "../apps/api/src/core/db";
import { runMigrations } from "../apps/api/src/core/migrate";
import { digest, FakeGateway } from "../apps/api/test/fake-gateway";

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

// Az eÁFA NAV-átjárója helyett ál-átjáró: a böngészős tesztek sem fordulnak az eÁFA-hoz vagy a NAV-hoz.
// A tesztcég (10773381-2-44) kapcsolódási kódja és egy bejövő számla az Irodaszer Kft.-től.
const gateway = new FakeGateway();
await gateway.start();
gateway.codes.set("E2EABCDEFGHJKMNP", "10773381");
gateway.digests.INBOUND = [
  digest({
    invoiceNumber: "IR-2026/0101",
    invoiceIssueDate: "2026-10-10",
    invoiceDeliveryDate: "2026-10-10",
    paymentDate: "2026-10-25",
    supplierTaxNumber: "10537914",
    supplierName: "Irodaszer Kft.",
    invoiceNetAmountHuf: 50000,
    invoiceVatAmountHuf: 13500,
  }),
];

const port = Number(process.env.E2E_PORT ?? 3100);
const config = {
  ...loadConfig({ DATABASE_URL: appUrl, LOG_LEVEL: "warn" }),
  // A csatolmányok egy ideiglenes mappába kerülnek.
  fileStore: { kind: "local" as const, dir: mkdtempSync(path.join(tmpdir(), "konyvelo-e2e-csatolmany-")) },
  port,
  webDistDir: path.join(here, "../apps/web/dist"),
  eafaGateway: { url: gateway.url, secret: gateway.secret },
};
const { db } = createDb(appUrl);
const app = await buildApp(config, db);
await app.listen({ port, host: "127.0.0.1" });
console.log(`E2E szerver: http://127.0.0.1:${port}`);
