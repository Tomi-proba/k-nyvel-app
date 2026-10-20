import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import pg from "pg";
import { taxNumberCheckDigit } from "@konyvelo/domain";
import { CSRF_HEADER } from "@konyvelo/shared";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createDb, type Db } from "../src/core/db";
import { runMigrations } from "../src/core/migrate";

function testUrls() {
  const appUrl = process.env.TEST_DATABASE_URL;
  const ownerUrl = process.env.TEST_DATABASE_MIGRATION_URL;
  if (!appUrl || !ownerUrl) {
    throw new Error("A tesztekhez TEST_DATABASE_URL és TEST_DATABASE_MIGRATION_URL kell (lásd .env.example).");
  }
  if (!/_test\b/.test(appUrl) || !/_test\b/.test(ownerUrl)) {
    throw new Error("Biztonsági ellenőrzés: a teszt-adatbázis nevének _test-re kell végződnie, mert a tesztek törlik.");
  }
  return { appUrl, ownerUrl };
}

/** A teszt-adatbázis teljes újraépítése (séma törlése, migrációk futtatása). */
export async function resetDatabase(): Promise<void> {
  const { ownerUrl } = testUrls();
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT USAGE ON SCHEMA public TO konyvelo_app");
  } finally {
    await client.end();
  }
  await runMigrations(ownerUrl);
}

/** Közvetlen SQL a séma tulajdonosaként (pl. a védelmek ellenőrzéséhez). */
export async function ownerQuery(sql: string, params: unknown[] = []): Promise<pg.QueryResult> {
  const client = new pg.Client({ connectionString: testUrls().ownerUrl });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

/** Közvetlen SQL az alkalmazás (korlátozott jogú) felhasználójaként. */
export async function appQuery(sql: string, params: unknown[] = []): Promise<pg.QueryResult> {
  const client = new pg.Client({ connectionString: testUrls().appUrl });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

export type TestContext = { app: FastifyInstance; db: Db; close: () => Promise<void> };

export async function createTestApp(): Promise<TestContext> {
  const { appUrl } = testUrls();
  const config = { ...loadConfig({ DATABASE_URL: appUrl, NODE_ENV: "test", LOG_LEVEL: "silent" }), webDistDir: null };
  const { db, pool } = createDb(appUrl);
  const app = await buildApp(config, db);
  await app.ready();
  return {
    app,
    db,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

/** Egyszerű „böngésző”: megjegyzi a munkamenet-sütit, és küldi a CSRF fejlécet. */
export class Client {
  private cookie: string | null = null;
  constructor(private readonly app: FastifyInstance) {}

  async request(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    const headers: Record<string, string> = { ...(method !== "GET" ? { [CSRF_HEADER]: "1" } : {}), ...extraHeaders };
    if (this.cookie) headers.cookie = this.cookie;
    const res = await this.app.inject({ method, url, headers, ...(body !== undefined ? { payload: body as object } : {}) });
    const setCookie = res.headers["set-cookie"];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (raw) {
      const pair = raw.split(";")[0]!;
      this.cookie = pair.endsWith("=") ? null : pair;
    }
    return res;
  }

  get = (url: string) => this.request("GET", url);
  post = (url: string, body?: unknown, headers?: Record<string, string>) => this.request("POST", url, body ?? {}, headers);
  patch = (url: string, body?: unknown) => this.request("PATCH", url, body ?? {});
  delete = (url: string) => this.request("DELETE", url);
}

let taxSeq = 1000000;
/** Érvényes (ellenőrző számjegyű) teszt-adószám. */
export function nextTaxNumber(): string {
  const first7 = String(taxSeq++);
  return `${first7}${taxNumberCheckDigit(first7)}-2-41`;
}

export const PASSWORD = "nagyon-titkos-jelszo-123";

export function companyInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Minta Kereskedelmi Kft.",
    shortName: "Minta Kft.",
    taxNumber: nextTaxNumber(),
    reportType: "SIMPLIFIED_ANNUAL",
    fxRateSource: "MNB",
    ...overrides,
  };
}

/** Első indítás: adminisztrátor létrehozása és bejelentkezett kliens. */
export async function setupAdmin(app: FastifyInstance, email = "admin@example.hu"): Promise<Client> {
  const client = new Client(app);
  const res = await client.post("/api/setup", { name: "Admin Anna", email, password: PASSWORD });
  if (res.statusCode !== 201) throw new Error(`Setup sikertelen: ${res.body}`);
  return client;
}

export async function login(app: FastifyInstance, email: string, password = PASSWORD): Promise<Client> {
  const client = new Client(app);
  const res = await client.post("/api/auth/login", { email, password });
  if (res.statusCode !== 200) throw new Error(`Belépés sikertelen: ${res.body}`);
  return client;
}

export async function createCompany(client: Client, overrides: Record<string, unknown> = {}): Promise<{ id: string; taxNumber: string }> {
  const res = await client.post("/api/companies", companyInput(overrides));
  if (res.statusCode !== 201) throw new Error(`Cég létrehozása sikertelen: ${res.body}`);
  return res.json();
}
