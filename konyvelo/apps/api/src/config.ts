import path from "node:path";
import { fileURLToPath } from "node:url";

export type Config = {
  port: number;
  host: string;
  /** Az alkalmazás futás közbeni (korlátozott jogú) adatbázis-kapcsolata. */
  databaseUrl: string;
  /** A séma tulajdonosának kapcsolata – csak a migrációkhoz. */
  migrationDatabaseUrl: string;
  /** Éles környezetben a munkamenet-süti csak HTTPS-en megy át. */
  cookieSecure: boolean;
  /** Munkamenet lejárata tétlenség esetén (perc). */
  sessionIdleMinutes: number;
  /** A lefordított felület (apps/web/dist) – ha létezik, a szerver ezt is kiszolgálja. */
  webDistDir: string | null;
  trustProxy: boolean;
  logLevel: string;
  /** További engedélyezett Origin-címek a CSRF-ellenőrzéshez (pl. a Codespace címe). */
  allowedOrigins: string[];
};

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultWebDist = path.resolve(here, "../../web/dist");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Hiányzik a DATABASE_URL környezeti változó (lásd .env.example).");
  }
  const production = env.NODE_ENV === "production";
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "127.0.0.1",
    databaseUrl,
    migrationDatabaseUrl: env.DATABASE_MIGRATION_URL ?? databaseUrl,
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : production,
    sessionIdleMinutes: Number(env.SESSION_IDLE_MINUTES ?? 12 * 60),
    webDistDir: env.WEB_DIST_DIR ?? defaultWebDist,
    trustProxy: env.TRUST_PROXY === "true",
    logLevel: env.LOG_LEVEL ?? (production ? "info" : "warn"),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim().replace(/\/$/, ""))
      .filter(Boolean),
  };
}
