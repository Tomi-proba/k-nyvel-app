/**
 * Közös belépés a portálon át (AWEBOLDAL TERV.md F21).
 *
 *  - POST /api/auth/sso                belépés a portál egyszer használható, kétlépcsős (aal2) jegyével
 *  - POST /api/auth/sso/osszekapcsolas a portál-fiók összekapcsolása a régi fiókkal: EGYSZERI régi belépés
 *                                      (jelszó + kétlépcsős kód); pusztán az e-mail-cím egyezése nem elég
 *  - POST /api/auth/sso/ceg            a Könyvelő cégének összerendelése a portál cégével (cég-adminisztrátor)
 *  - POST /api/auth/sso/kilepes        a portál kilépési jelzése (szerverről szerverre, aláírt jeggyel)
 *  - GET  /api/auth/sso/atallas        átállási lista: ki kapcsolta már össze a fiókját, kinek van 2FA-ja
 *
 * A régi belépés (REGI_BELEPES) csak akkor kapcsol ki ténylegesen, ha minden aktív felhasználó
 * összekapcsolta a fiókját; addig bekapcsolva marad, hogy senki ne zárja ki magát.
 */
import { randomBytes } from "node:crypto";
import { and, count, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { JegyHiba, belepesiJegyEllenorzes, kilepesiJegyEllenorzes, type BelepesiJegy } from "@konyvelo/esemenyek";
import { hasPermission, type Role } from "@konyvelo/shared";
import type { Config } from "../../config";
import { writeAudit } from "../../core/audit";
import { burnPasswordCheck, createSession, hashPassword, requireCompanyPermission, requireUser, setSessionCookie, verifyPassword } from "../../core/auth";
import type { Executor, Tx } from "../../core/db";
import { AppError, conflict, notFound, parseBody } from "../../core/errors";
import { verifySecondFactor } from "../../core/ketlepcsos";
import type { AppModule } from "../../core/modules";
import { authEvents, companies, companyMemberships, sessions, ssoLinks, ssoPending, ssoUsedTickets, users } from "../../core/schema";
import { sha256 } from "../../core/totp";

const PENDING_MINUTES = 10;
const LOCK_WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_EMAIL = 5;

const jegySchema = z.object({ jegy: z.string().min(20).max(8000) });
const kapcsolasSchema = z.object({
  kapcsolas: z.string().min(20),
  email: z.string().trim().toLowerCase().email("Érvénytelen e-mail-cím."),
  jelszo: z.string().min(1, "Jelszó: kötelező mező."),
  kod: z.string().trim().optional(),
  visszaallitoKod: z.string().trim().optional(),
});
const cegSchema = z.object({ companyId: z.string().uuid() });

/** A portál cégszerepe (vagy a portálon megadott könyvelőbeli szerepkör) → a Könyvelő szerepköre. */
export function szerepkor(portalRole: string, moduleRole: string | null): Role {
  const m = moduleRole?.toUpperCase();
  if (m === "ADMIN" || m === "CHIEF_ACCOUNTANT" || m === "ACCOUNTANT" || m === "VIEWER") return m;
  if (portalRole === "tulajdonos") return "ADMIN";
  if (portalRole === "konyvelo") return "CHIEF_ACCOUNTANT";
  return "VIEWER";
}

/** Ténylegesen él-e még a régi belépés (a kapcsoló és az átállás állapota együtt). */
export async function regiBelepesAktiv(db: Executor, config: Config): Promise<boolean> {
  if (config.regiBelepes || !config.sso) return true;
  const [link] = await db.select({ n: count() }).from(ssoLinks);
  if ((link?.n ?? 0) === 0) return true;
  const [r] = await db
    .select({ n: count() })
    .from(users)
    .leftJoin(ssoLinks, eq(ssoLinks.userId, users.id))
    .where(and(eq(users.isActive, true), eq(users.isSystem, false), isNull(ssoLinks.portalSub)));
  return (r?.n ?? 0) > 0;
}

function hiba(e: unknown): never {
  if (e instanceof JegyHiba) {
    throw new AppError(401, `SSO_${e.kod.toUpperCase().replace(/-/g, "_")}`, e.message);
  }
  throw e;
}

export const ssoModule: AppModule = {
  name: "sso",
  register(app, { db, config }) {
    let remote: JWTVerifyGetKey | null = null;
    const kulcsok = (): JWTVerifyGetKey => {
      const sso = config.sso!;
      return sso.keys ?? (remote ??= createRemoteJWKSet(new URL(sso.jwksUrl)));
    };
    const felhasznal = async (jti: string, lejar: Date) => {
      await db.delete(ssoUsedTickets).where(lt(ssoUsedTickets.expiresAt, sql`now() - interval '1 hour'`));
      const r = await db.insert(ssoUsedTickets).values({ jti, expiresAt: lejar }).onConflictDoNothing().returning({ jti: ssoUsedTickets.jti });
      return r.length === 1;
    };
    const kellSso = () => {
      if (!config.sso) throw new AppError(404, "NOT_FOUND", "A közös belépés nincs bekapcsolva.");
      return config.sso;
    };
    const meta = (request: { ip: string; headers: Record<string, unknown> }) => ({
      ip: request.ip,
      userAgent: request.headers["user-agent"] as string | undefined,
    });

    /** A portál cégéhez rendelt Könyvelő-cég; ha van, a felhasználó tagsága a portál szerepe szerint jön létre. */
    async function tagsag(tx: Tx, userId: string, portalCompanyId: string, portalRole: string, moduleRole: string | null) {
      const [c] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.portalCompanyId, portalCompanyId)).limit(1);
      if (!c) return null;
      const [m] = await tx
        .select({ role: companyMemberships.role })
        .from(companyMemberships)
        .where(and(eq(companyMemberships.companyId, c.id), eq(companyMemberships.userId, userId)));
      if (!m) {
        const role = szerepkor(portalRole, moduleRole);
        await tx.insert(companyMemberships).values({ companyId: c.id, userId, role, createdBy: null });
        await writeAudit(tx, {
          companyId: c.id,
          userId,
          action: "member.add",
          entityType: "membership",
          entityId: userId,
          after: { role, forras: "portál (közös belépés)" },
          ip: null,
        });
      }
      return c.id;
    }

    async function munkamenet(reply: Parameters<typeof setSessionCookie>[0], request: Parameters<typeof meta>[0], userId: string, p: { sid: string; sub: string; companyId: string; idleMinutes: number }) {
      const token = await createSession(db, config, userId, meta(request), { aal: 2, portal: p });
      setSessionCookie(reply, config, token);
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
    }

    app.post("/api/auth/sso", async (request, reply) => {
      const sso = kellSso();
      const { jegy } = parseBody(jegySchema, request.body);
      let j: BelepesiJegy;
      try {
        j = await belepesiJegyEllenorzes(jegy, { kulcsok: kulcsok(), kiado: sso.kiado, modul: "konyvelo", felhasznal });
      } catch (e) {
        await db.insert(authEvents).values({ event: "SSO_FAILURE", ip: request.ip, userAgent: request.headers["user-agent"]?.slice(0, 300) ?? null });
        hiba(e);
      }
      const portal = { sid: j.sid, sub: j.sub, companyId: j.ceg.id, idleMinutes: j.tetlenseg_perc };

      const [link] = await db.select().from(ssoLinks).where(eq(ssoLinks.portalSub, j.sub)).limit(1);
      if (link) {
        const [u] = await db.select({ isActive: users.isActive, email: users.email }).from(users).where(eq(users.id, link.userId)).limit(1);
        if (!u?.isActive) throw new AppError(403, "USER_INACTIVE", "A fiókja a Könyvelőben le van tiltva. Kérjük, szóljon a cég adminisztrátorának.");
        const companyId = await db.transaction((tx) => tagsag(tx, link.userId, j.ceg.id, j.ceg.szerep, j.ceg.modulSzerep));
        await munkamenet(reply, request, link.userId, portal);
        await db.insert(authEvents).values({ userId: link.userId, email: u.email, event: "SSO_LOGIN", ip: request.ip });
        return { kovetkezo: "kesz", companyId };
      }

      // Nincs még összekapcsolva. Ha a cég össze van rendelve, és ezzel az e-mail-címmel nincs régi fiók,
      // új fiók készül (a portál a kétlépcsős azonosítást már elvégezte). Különben: összekapcsolás.
      const [regi] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${j.email.toLowerCase()}`).limit(1);
      const [mapped] = await db.select({ id: companies.id }).from(companies).where(eq(companies.portalCompanyId, j.ceg.id)).limit(1);
      if (!regi && mapped) {
        const passwordHash = await hashPassword(randomBytes(32).toString("base64url")); // régi belépésre nem használható
        const userId = await db.transaction(async (tx) => {
          const [u] = await tx.insert(users).values({ email: j.email.toLowerCase(), name: j.name || j.email, passwordHash }).returning({ id: users.id });
          await tx.insert(ssoLinks).values({ portalSub: j.sub, userId: u!.id, method: "UJ_FIOK" });
          await writeAudit(tx, {
            companyId: mapped.id,
            userId: u!.id,
            action: "user.create",
            entityType: "user",
            entityId: u!.id,
            after: { email: j.email, forras: "portál (közös belépés)" },
            ip: request.ip,
          });
          await tagsag(tx, u!.id, j.ceg.id, j.ceg.szerep, j.ceg.modulSzerep);
          return u!.id;
        });
        await munkamenet(reply, request, userId, portal);
        await db.insert(authEvents).values({ userId, email: j.email, event: "SSO_LINKED", ip: request.ip });
        return { kovetkezo: "kesz", companyId: mapped.id };
      }

      const kapcsolas = randomBytes(32).toString("base64url");
      await db.delete(ssoPending).where(lt(ssoPending.expiresAt, new Date()));
      await db.insert(ssoPending).values({
        tokenHash: sha256(kapcsolas),
        portalSub: j.sub,
        portalSid: j.sid,
        email: j.email.toLowerCase(),
        name: j.name,
        portalCompanyId: j.ceg.id,
        portalRole: j.ceg.szerep,
        moduleRole: j.ceg.modulSzerep,
        idleMinutes: j.tetlenseg_perc,
        expiresAt: new Date(Date.now() + PENDING_MINUTES * 60_000),
      });
      return { kovetkezo: "osszekapcsolas", kapcsolas, email: j.email, cegOsszerendelve: Boolean(mapped) };
    });

    app.post("/api/auth/sso/osszekapcsolas", async (request, reply) => {
      kellSso();
      const input = parseBody(kapcsolasSchema, request.body);
      const [p] = await db
        .select()
        .from(ssoPending)
        .where(and(eq(ssoPending.tokenHash, sha256(input.kapcsolas)), gt(ssoPending.expiresAt, new Date())))
        .limit(1);
      if (!p) throw new AppError(401, "SSO_KAPCSOLAS_LEJART", "Az összekapcsolás ideje lejárt. Kérjük, nyissa meg újra a Könyvelőt a portálról.");

      const since = sql`now() - make_interval(mins => ${LOCK_WINDOW_MINUTES})`;
      const [fails] = await db
        .select({ n: count() })
        .from(authEvents)
        .where(and(eq(authEvents.event, "LOGIN_FAILURE"), sql`lower(${authEvents.email}) = ${input.email}`, gt(authEvents.at, since)));
      if ((fails?.n ?? 0) >= MAX_FAILURES_PER_EMAIL) {
        throw new AppError(429, "TOO_MANY_ATTEMPTS", `Túl sok sikertelen kísérlet. Kérjük, próbálja újra ${LOCK_WINDOW_MINUTES} perc múlva.`);
      }
      const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${input.email}`).limit(1);
      const ok = u && !u.isSystem ? u.isActive && (await verifyPassword(u.passwordHash, input.jelszo)) : (await burnPasswordCheck(input.jelszo), false);
      if (!u || !ok) {
        await db.insert(authEvents).values({ userId: u?.id ?? null, email: input.email, event: "LOGIN_FAILURE", ip: request.ip });
        throw new AppError(401, "INVALID_CREDENTIALS", "Hibás e-mail-cím vagy jelszó.");
      }
      // A régi fiók második faktora: ha be van kapcsolva, kötelező. Ha még nincs (régi, 2FA nélküli fiók),
      // a portál kétlépcsős belépése a második faktor, de csak akkor, ha a portál-fiók e-mail-címe ugyanaz.
      if (u.totpEnabledAt) {
        await verifySecondFactor(db, config, u.id, { kod: input.kod, visszaallitoKod: input.visszaallitoKod }, request.ip);
      } else if (u.email.toLowerCase() !== p.email) {
        throw new AppError(
          400,
          "TOTP_SETUP_REQUIRED",
          "Ehhez a fiókhoz még nincs kétlépcsős azonosítás. Lépjen be egyszer a régi belépéssel, állítsa be, majd próbálja újra.",
        );
      }
      const [mar] = await db.select({ sub: ssoLinks.portalSub }).from(ssoLinks).where(eq(ssoLinks.userId, u.id)).limit(1);
      if (mar) throw conflict("Ez a Könyvelő-fiók már egy másik portál-fiókhoz van kapcsolva.");

      const companyId = await db.transaction(async (tx) => {
        await tx.insert(ssoLinks).values({ portalSub: p.portalSub, userId: u.id, method: "REGI_BELEPES" });
        await tx.delete(ssoPending).where(eq(ssoPending.tokenHash, p.tokenHash));
        await writeAudit(tx, { companyId: null, userId: u.id, action: "user.sso_link", entityType: "user", entityId: u.id, after: { portal: p.email }, ip: request.ip });
        return tagsag(tx, u.id, p.portalCompanyId, p.portalRole, p.moduleRole);
      });
      await munkamenet(reply, request, u.id, { sid: p.portalSid, sub: p.portalSub, companyId: p.portalCompanyId, idleMinutes: p.idleMinutes });
      await db.insert(authEvents).values({ userId: u.id, email: u.email, event: "SSO_LINKED", ip: request.ip });
      return { kovetkezo: "kesz", companyId };
    });

    /** A Könyvelő cégének összerendelése azzal a portál-céggel, amelyből a felhasználó belépett. */
    app.post("/api/auth/sso/ceg", async (request) => {
      kellSso();
      const { companyId } = parseBody(cegSchema, request.body);
      const { user } = await requireCompanyPermission(db, request, companyId, "members:manage");
      const portalCompanyId = request.session?.portalCompanyId;
      if (!portalCompanyId) throw new AppError(400, "SSO_NINCS_PORTAL_CEG", "Az összerendeléshez a portálról kell megnyitni a Könyvelőt.");
      const [c] = await db.select({ portal: companies.portalCompanyId }).from(companies).where(eq(companies.id, companyId)).limit(1);
      if (c?.portal === portalCompanyId) return { ok: true };
      if (c?.portal) throw conflict("Ez a cég már egy másik portál-céghez van rendelve.");
      const [other] = await db.select({ id: companies.id }).from(companies).where(eq(companies.portalCompanyId, portalCompanyId)).limit(1);
      if (other) throw conflict("Ez a portál-cég már egy másik Könyvelő-céghez van rendelve.");
      await db.transaction(async (tx) => {
        await tx.update(companies).set({ portalCompanyId }).where(eq(companies.id, companyId));
        await writeAudit(tx, { companyId, userId: user.id, action: "company.portal_link", entityType: "company", entityId: companyId, after: { portalCompanyId }, ip: request.ip });
      });
      return { ok: true };
    });

    /** A portál kilépési jelzése: a portál-munkamenethez tartozó minden Könyvelő-munkamenet megszűnik. */
    app.post("/api/auth/sso/kilepes", async (request, reply) => {
      const sso = kellSso();
      const { jegy } = parseBody(jegySchema, request.body);
      let k;
      try {
        k = await kilepesiJegyEllenorzes(jegy, { kulcsok: kulcsok(), kiado: sso.kiado, modul: "konyvelo", felhasznal });
      } catch (e) {
        // Már feldolgozott (újraküldött) jelzés: kész.
        if (e instanceof JegyHiba && e.kod === "mar-felhasznalt") return reply.code(204).send();
        hiba(e);
      }
      const torolt = await db.delete(sessions).where(eq(sessions.portalSid, k.sid)).returning({ userId: sessions.userId });
      if (torolt.length) await db.insert(authEvents).values({ userId: torolt[0]!.userId, event: "SSO_LOGOUT", ip: request.ip });
      return reply.code(204).send();
    });

    /** Átállási lista a cég-adminisztrátornak: az általa kezelt cégek tagjai. */
    app.get("/api/auth/sso/atallas", async (request) => {
      const user = requireUser(request);
      const admin = await db.select({ companyId: companyMemberships.companyId, role: companyMemberships.role }).from(companyMemberships).where(eq(companyMemberships.userId, user.id));
      const cegek = admin.filter((m) => hasPermission(m.role, "members:manage")).map((m) => m.companyId);
      if (!cegek.length) throw notFound("Nincs olyan cég, amelynek a tagjait kezelheti.");
      const rows = await db
        .selectDistinct({ id: users.id, email: users.email, name: users.name, totp: users.totpEnabledAt, link: ssoLinks.method })
        .from(companyMemberships)
        .innerJoin(users, eq(users.id, companyMemberships.userId))
        .leftJoin(ssoLinks, eq(ssoLinks.userId, users.id))
        .where(and(inArray(companyMemberships.companyId, cegek), eq(users.isActive, true)))
        .orderBy(users.name);
      return {
        sso: Boolean(config.sso),
        regiBelepes: await regiBelepesAktiv(db, config),
        regiBelepesKapcsolo: config.regiBelepes,
        tagok: rows.map((r) => ({ id: r.id, email: r.email, name: r.name, ketlepcsos: r.totp !== null, osszekapcsolva: r.link !== null })),
      };
    });
  },
};

