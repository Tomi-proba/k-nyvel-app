import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FileStoreConfig } from "./core/filestore";

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
  /**
   * Az eÁFA NAV-átjárója (7. lépés). A Könyvelőben nincs NAV-titok és nincs NAV-cím: a NAV Online
   * Számla adatait az eÁFA kérdezi le a cég NAV-kapcsolatával. Ha bármelyik hiányzik, a NAV-import
   * nem érhető el (a felület ezt kiírja).
   */
  eafaGateway: { url: string; secret: string } | null;
  /** Csatolmányok tárolása (helyi mappa vagy S3-kompatibilis tároló), beállításból. */
  fileStore: FileStoreConfig;
  /** Egy csatolmány legnagyobb mérete bájtban. */
  attachmentMaxBytes: number;
  /**
   * Az integrációs központ (I2, TERV.md F14). Ha nincs megadva, nincs integráció: a Könyvelő önállóan,
   * pontosan úgy működik, mint eddig.
   */
  hub: { url: string; secret: string } | null;
  /** A többi modul felületének címe a forrásra mutató linkekhez (a közös felület elkészültéig). */
  moduleUrls: { keszlet: string | null; eafa: string | null };
};

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultWebDist = path.resolve(here, "../../web/dist");
/** A Könyvelő gyökérmappája: a relatív FAJLTAR_MAPPA ehhez képest értendő (a szerver és a parancsok is ugyanazt látják). */
const projectRoot = path.resolve(here, "../../..");

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
    eafaGateway: gatewayConfig(env),
    fileStore: fileStoreConfig(env),
    attachmentMaxBytes: Math.round(Number(env.CSATOLMANY_MAX_MB ?? 10) * 1024 * 1024),
    hub: hubConfig(env),
    moduleUrls: { keszlet: env.KESZLET_URL?.trim().replace(/\/$/, "") || null, eafa: env.EAFA_URL?.trim().replace(/\/$/, "") || null },
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim().replace(/\/$/, ""))
      .filter(Boolean),
  };
}

/** A központ címe és a Könyvelő titka (a központban KOZPONT_KONYVELO_TITOK), legalább 32 karakter. */
function hubConfig(env: NodeJS.ProcessEnv): Config["hub"] {
  const url = env.KOZPONT_URL?.trim().replace(/\/$/, "");
  const secret = env.KOZPONT_TITOK?.trim();
  if (!url && !secret) return null;
  if (!url || !secret) throw new Error("Az integrációhoz a KOZPONT_URL és a KOZPONT_TITOK is kell (lásd .env.example).");
  if (secret.length < 32) throw new Error("A KOZPONT_TITOK legalább 32 karakter legyen (ugyanaz, mint a központban a KOZPONT_KONYVELO_TITOK).");
  return { url, secret };
}

/** A közös titok legalább 32 karakter, ugyanaz, mint az eÁFA-ban (EAFA_KONYVELO_ATJARO_TITOK). */
function gatewayConfig(env: NodeJS.ProcessEnv): Config["eafaGateway"] {
  const url = env.EAFA_ATJARO_URL?.trim().replace(/\/$/, "");
  const secret = env.EAFA_KONYVELO_ATJARO_TITOK?.trim();
  if (!url || !secret) return null;
  if (secret.length < 32) {
    throw new Error("Az EAFA_KONYVELO_ATJARO_TITOK legalább 32 karakter legyen (ugyanaz, mint az eÁFA-ban).");
  }
  return { url, secret };
}

/**
 * Fájltárolás: FAJLTAR=local (alapértelmezés, FAJLTAR_MAPPA) vagy FAJLTAR=s3 (pl. Supabase Storage):
 * FAJLTAR_S3_VEGPONT, FAJLTAR_S3_REGIO, FAJLTAR_S3_VODOR, FAJLTAR_S3_KULCS, FAJLTAR_S3_TITOK.
 */
export function fileStoreConfig(env: NodeJS.ProcessEnv): FileStoreConfig {
  const kind = (env.FAJLTAR ?? "local").trim();
  if (kind === "local") return { kind: "local", dir: path.resolve(projectRoot, env.FAJLTAR_MAPPA?.trim() || "storage") };
  if (kind !== "s3") throw new Error(`Ismeretlen fájltároló: FAJLTAR=${kind} (local vagy s3).`);
  const need = (name: string) => {
    const v = env[name]?.trim();
    if (!v) throw new Error(`S3 fájltárolóhoz a ${name} is kell (lásd ELESITES.md).`);
    return v;
  };
  return {
    kind: "s3",
    endpoint: env.FAJLTAR_S3_VEGPONT?.trim() || null,
    region: need("FAJLTAR_S3_REGIO"),
    bucket: need("FAJLTAR_S3_VODOR"),
    accessKeyId: need("FAJLTAR_S3_KULCS"),
    secretAccessKey: need("FAJLTAR_S3_TITOK"),
    forcePathStyle: env.FAJLTAR_S3_UTVONAL_STILUS !== "false",
  };
}
