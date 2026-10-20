import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

// A PostgreSQL "date" típust szövegként kérjük vissza ("2026-10-20"),
// különben a pg JavaScript Date-té alakítaná, ami időzóna miatt elcsúszhat.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

export function createDb(connectionString: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/** PostgreSQL hibakódok, amelyeket felhasználóbarát üzenetté alakítunk. */
export const PG_UNIQUE_VIOLATION = "23505";
export const PG_EXCLUSION_VIOLATION = "23P01";
export const PG_CHECK_VIOLATION = "23514";

export function pgErrorCode(err: unknown): string | undefined {
  let e: unknown = err;
  // A Drizzle az eredeti pg hibát a "cause" mezőbe csomagolhatja.
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

export function pgConstraint(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    const c = (e as { constraint?: unknown }).constraint;
    if (typeof c === "string") return c;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}
