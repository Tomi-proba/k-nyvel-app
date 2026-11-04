import { createHash, randomBytes } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { and, eq, gt } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { hasPermission, type Permission, type Role } from "@konyvelo/shared";
import type { Config } from "../config";
import type { Db, Executor } from "./db";
import { AppError, assertUuid, forbidden, notFound, unauthorized } from "./errors";
import { companyMemberships, sessions, users } from "./schema";

export const SESSION_COOKIE = "konyvelo_session";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  mustChangePassword: boolean;
};

/** A munkamenet állapota: aal 1 = csak jelszó; a kétlépcsős kód nélkül semmi más nem érhető el. */
export type SessionInfo = {
  id: string;
  aal: 1 | 2;
  totpEnabled: boolean;
  /** Közös belépéssel (a portál jegyével) jött létre. */
  sso: boolean;
  portalCompanyId: string | null;
};

declare module "fastify" {
  interface FastifyRequest {
    /** Csak teljes (kétlépcsős) belépés után van kitöltve. */
    authUser: AuthUser | null;
    sessionId: string | null;
    session: SessionInfo | null;
    /** Félig belépett (jelszó megvan, a kétlépcsős kód még nincs) felhasználó: csak a 2FA-végpontoknak. */
    partialUser: AuthUser | null;
  }
}

// ---------- Jelszó ----------

export function hashPassword(password: string): Promise<string> {
  // Argon2id, a könyvtár alapértelmezett (OWASP által ajánlott) paramétereivel.
  return argonHash(password);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

// Nem létező felhasználónál is lefuttatunk egy ellenőrzést, hogy a válaszidő
// ne árulja el, létezik-e az e-mail-cím.
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("nem-letezo-felhasznalo-jelszava");
  await verifyPassword(await dummyHash, password);
}

// ---------- Munkamenet ----------

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Jelszó után, a kétlépcsős kód megadásáig: rövid idő. */
const PARTIAL_IDLE_MINUTES = 10;

export type SessionOptions = {
  aal?: 1 | 2;
  /** Közös belépés: a portál munkamenete és a jegyben kapott tétlenségi idő. */
  portal?: { sid: string; sub: string; companyId: string; idleMinutes: number };
};

export function idleMinutesOf(config: Config, aal: 1 | 2, own: number | null): number {
  if (aal === 1) return PARTIAL_IDLE_MINUTES;
  return Math.min(own ?? config.sessionIdleMinutes, config.sessionMaxHours * 60);
}

export async function createSession(
  db: Executor,
  config: Config,
  userId: string,
  meta: { ip: string; userAgent: string | undefined },
  opts: SessionOptions = {},
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const aal = opts.aal ?? 1;
  const now = Date.now();
  const idle = idleMinutesOf(config, aal, opts.portal?.idleMinutes ?? null);
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(now + idle * 60_000),
    maxExpiresAt: new Date(now + config.sessionMaxHours * 3_600_000),
    ip: meta.ip,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    aal,
    portalSid: opts.portal?.sid ?? null,
    portalSub: opts.portal?.sub ?? null,
    portalCompanyId: opts.portal?.companyId ?? null,
    idleMinutes: opts.portal ? Math.min(opts.portal.idleMinutes, config.sessionMaxHours * 60) : null,
  });
  return token;
}

/** A kétlépcsős kód elfogadása után a munkamenet teljes jogú lesz (és a tétlenségi ideje a rendes). */
export async function elevateSession(db: Executor, config: Config, sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ aal: 2, lastSeenAt: new Date(), expiresAt: new Date(Date.now() + idleMinutesOf(config, 2, null) * 60_000) })
    .where(eq(sessions.id, sessionId));
}

export function setSessionCookie(reply: FastifyReply, config: Config, token: string): void {
  // A süti a munkamenet felső határáig él; a tétlenségi lejáratot a szerver ellenőrzi.
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "strict",
    maxAge: config.sessionMaxHours * 3600,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** A süti alapján betölti a bejelentkezett felhasználót; lejárt munkamenetnél null. */
export async function loadSession(
  db: Db,
  config: Config,
  token: string | undefined,
): Promise<{ user: AuthUser; session: SessionInfo } | null> {
  if (!token) return null;
  const now = new Date();
  const [row] = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      aal: sessions.aal,
      idleMinutes: sessions.idleMinutes,
      maxExpiresAt: sessions.maxExpiresAt,
      portalSid: sessions.portalSid,
      portalCompanyId: sessions.portalCompanyId,
      totpEnabledAt: users.totpEnabledAt,
      id: users.id,
      email: users.email,
      name: users.name,
      mustChangePassword: users.mustChangePassword,
      isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row || !row.isActive) return null;
  // Abszolút felső határ (12 óra), tétlenségtől függetlenül.
  if (row.maxExpiresAt && row.maxExpiresAt <= now) return null;
  const aal = row.aal === 2 ? 2 : 1;

  // Csúszó lejárat (a teljes belépésnél); legfeljebb percenként frissítjük, hogy ne írjunk minden kérésnél.
  if (aal === 2 && now.getTime() - row.lastSeenAt.getTime() > 60_000) {
    let expiresAt = new Date(now.getTime() + idleMinutesOf(config, 2, row.idleMinutes) * 60_000);
    if (row.maxExpiresAt && expiresAt > row.maxExpiresAt) expiresAt = row.maxExpiresAt;
    await db.update(sessions).set({ lastSeenAt: now, expiresAt }).where(eq(sessions.id, row.sessionId));
  }
  return {
    session: { id: row.sessionId, aal, totpEnabled: row.totpEnabledAt !== null, sso: row.portalSid !== null, portalCompanyId: row.portalCompanyId },
    user: { id: row.id, email: row.email, name: row.name, mustChangePassword: row.mustChangePassword },
  };
}

// ---------- Hozzáférés-ellenőrzés ----------

/** Teljes (kétlépcsős) belépést követel. Félig belépett felhasználónál megmondja, mi hiányzik. */
export function requireUser(request: FastifyRequest): AuthUser {
  if (request.authUser) return request.authUser;
  if (request.partialUser && request.session) {
    throw request.session.totpEnabled
      ? new AppError(401, "TOTP_REQUIRED", "Adja meg a hitelesítő alkalmazás 6 jegyű kódját.")
      : new AppError(401, "TOTP_SETUP_REQUIRED", "A belépéshez be kell állítania a kétlépcsős azonosítást.");
  }
  throw unauthorized();
}

/** A 2FA-végpontokhoz: jelszóval belépett, de a kódot még meg nem adott felhasználó (vagy teljes belépés). */
export function requirePartialUser(request: FastifyRequest): { user: AuthUser; session: SessionInfo } {
  const user = request.authUser ?? request.partialUser;
  if (!user || !request.session) throw unauthorized();
  return { user, session: request.session };
}

/**
 * Ellenőrzi, hogy a felhasználó tagja-e a cégnek, és van-e jogosultsága.
 * Ha nem tagja, 404-et adunk (nem áruljuk el, hogy a cég létezik).
 */
export async function requireCompanyPermission(
  db: Executor,
  request: FastifyRequest,
  companyId: string,
  permission: Permission,
): Promise<{ user: AuthUser; role: Role }> {
  const user = requireUser(request);
  assertUuid(companyId, "A cég nem található.");
  const [m] = await db
    .select({ role: companyMemberships.role })
    .from(companyMemberships)
    .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.userId, user.id)))
    .limit(1);
  if (!m) throw notFound("A cég nem található.");
  if (!hasPermission(m.role, permission)) throw forbidden();
  return { user, role: m.role };
}
