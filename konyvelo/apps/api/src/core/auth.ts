import { createHash, randomBytes } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { and, eq, gt } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { hasPermission, type Permission, type Role } from "@konyvelo/shared";
import type { Config } from "../config";
import type { Db, Executor } from "./db";
import { assertUuid, forbidden, notFound, unauthorized } from "./errors";
import { companyMemberships, sessions, users } from "./schema";

export const SESSION_COOKIE = "konyvelo_session";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  mustChangePassword: boolean;
};

declare module "fastify" {
  interface FastifyRequest {
    authUser: AuthUser | null;
    sessionId: string | null;
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

export async function createSession(
  db: Executor,
  config: Config,
  userId: string,
  meta: { ip: string; userAgent: string | undefined },
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + config.sessionIdleMinutes * 60_000),
    ip: meta.ip,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return token;
}

export function setSessionCookie(reply: FastifyReply, config: Config, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "strict",
    maxAge: config.sessionIdleMinutes * 60,
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
): Promise<{ user: AuthUser; sessionId: string } | null> {
  if (!token) return null;
  const now = new Date();
  const [row] = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
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

  // Csúszó lejárat; legfeljebb percenként frissítjük, hogy ne írjunk minden kérésnél.
  if (now.getTime() - row.lastSeenAt.getTime() > 60_000) {
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + config.sessionIdleMinutes * 60_000) })
      .where(eq(sessions.id, row.sessionId));
  }
  return {
    sessionId: row.sessionId,
    user: { id: row.id, email: row.email, name: row.name, mustChangePassword: row.mustChangePassword },
  };
}

// ---------- Hozzáférés-ellenőrzés ----------

export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.authUser) throw unauthorized();
  return request.authUser;
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
