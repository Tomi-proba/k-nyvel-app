import { and, count, eq, gt, ne, sql } from "drizzle-orm";
import { changePasswordSchema, loginSchema, setupSchema, type MeResponse } from "@konyvelo/shared";
import { writeAudit } from "../../core/audit";
import QRCode from "qrcode";
import { z } from "zod";
import {
  burnPasswordCheck,
  clearSessionCookie,
  createSession,
  elevateSession,
  hashPassword,
  requirePartialUser,
  requireUser,
  setSessionCookie,
  verifyPassword,
} from "../../core/auth";
import { activateTotp, startTotpSetup, verifySecondFactor } from "../../core/ketlepcsos";
import { otpauthUrl } from "../../core/totp";
import { AppError, conflict, parseBody, validationError } from "../../core/errors";
import { regiBelepesAktiv } from "../sso";
import type { AppModule } from "../../core/modules";
import { authEvents, companies, companyMemberships, sessions, users } from "../../core/schema";

const kodSchema = z.object({ kod: z.string({ error: "Kód: kötelező mező." }).trim().regex(/^\d{6}$/, "A kód 6 számjegy.") });
const ellenorzesSchema = z
  .object({ kod: z.string().trim().optional(), visszaallitoKod: z.string().trim().min(4).optional() })
  .refine((v) => v.kod || v.visszaallitoKod, { message: "Adja meg a kódot.", path: ["kod"] });

/** A jelszó után mi következik: a kód megadása, vagy (első alkalommal) a kétlépcsős azonosítás beállítása. */
export type Kovetkezo = "totp" | "totp-beallitas";

/** Belépési kísérletek korlátozása (15 perces ablak). */
const LOCK_WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_EMAIL = 5;
const MAX_FAILURES_PER_IP = 30;

export const authModule: AppModule = {
  name: "auth",
  register(app, { db, config }) {
    /** Első indítás: van-e már felhasználó? */
    app.get("/api/setup/status", async () => {
      // A gépi felhasználó (integráció) nem számít: első indításkor csak ő van.
      const [row] = await db.select({ n: count() }).from(users).where(eq(users.isSystem, false));
      return {
        needsSetup: (row?.n ?? 0) === 0,
        regiBelepes: await regiBelepesAktiv(db, config),
        portalUrl: config.sso?.portalUrl ?? null,
      };
    });

    /** Az első (adminisztrátor) felhasználó létrehozása – csak üres rendszerben. */
    app.post("/api/setup", async (request, reply) => {
      const input = parseBody(setupSchema, request.body);
      const passwordHash = await hashPassword(input.password);
      const user = await db.transaction(async (tx) => {
        // Zár, hogy két egyidejű kérés ne hozhasson létre két első felhasználót.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('setup', 0))`);
        const [row] = await tx.select({ n: count() }).from(users).where(eq(users.isSystem, false));
        if ((row?.n ?? 0) > 0) throw conflict("A rendszer már be van állítva. Kérjük, jelentkezzen be.");
        const [created] = await tx
          .insert(users)
          .values({ email: input.email, name: input.name, passwordHash })
          .returning({ id: users.id, email: users.email, name: users.name });
        await writeAudit(tx, {
          companyId: null,
          userId: created!.id,
          action: "user.create",
          entityType: "user",
          entityId: created!.id,
          after: { email: created!.email, name: created!.name, firstSetup: true },
          ip: request.ip,
        });
        return created!;
      });
      // Az első adminisztrátornak is kötelező a kétlépcsős azonosítás: a munkamenet addig félig belépett.
      const token = await createSession(db, config, user.id, { ip: request.ip, userAgent: request.headers["user-agent"] });
      setSessionCookie(reply, config, token);
      return reply.code(201).send({ ok: true, kovetkezo: "totp-beallitas" satisfies Kovetkezo });
    });

    app.post("/api/auth/login", async (request, reply) => {
      if (!(await regiBelepesAktiv(db, config))) {
        throw new AppError(403, "REGI_BELEPES_KIKAPCSOLVA", "A belépés a portálon át történik.");
      }
      const input = parseBody(loginSchema, request.body);
      const since = sql`now() - make_interval(mins => ${LOCK_WINDOW_MINUTES})`;
      const ua = request.headers["user-agent"]?.slice(0, 300) ?? null;

      const [byEmail] = await db
        .select({ n: count() })
        .from(authEvents)
        .where(and(eq(authEvents.event, "LOGIN_FAILURE"), sql`lower(${authEvents.email}) = ${input.email}`, gt(authEvents.at, since)));
      const [byIp] = await db
        .select({ n: count() })
        .from(authEvents)
        .where(and(eq(authEvents.event, "LOGIN_FAILURE"), eq(authEvents.ip, request.ip), gt(authEvents.at, since)));
      if ((byEmail?.n ?? 0) >= MAX_FAILURES_PER_EMAIL || (byIp?.n ?? 0) >= MAX_FAILURES_PER_IP) {
        await db.insert(authEvents).values({ email: input.email, event: "LOGIN_BLOCKED", ip: request.ip, userAgent: ua });
        throw new AppError(
          429,
          "TOO_MANY_ATTEMPTS",
          `Túl sok sikertelen belépési kísérlet. Kérjük, próbálja újra ${LOCK_WINDOW_MINUTES} perc múlva.`,
        );
      }

      const [user] = await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${input.email}`)
        .limit(1);
      const ok = user ? user.isActive && (await verifyPassword(user.passwordHash, input.password)) : (await burnPasswordCheck(input.password), false);

      if (!user || !ok) {
        await db.insert(authEvents).values({ userId: user?.id ?? null, email: input.email, event: "LOGIN_FAILURE", ip: request.ip, userAgent: ua });
        throw new AppError(401, "INVALID_CREDENTIALS", "Hibás e-mail-cím vagy jelszó.");
      }

      await db.insert(authEvents).values({ userId: user.id, email: input.email, event: "LOGIN_SUCCESS", ip: request.ip, userAgent: ua });
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      // A jelszó után a munkamenet félig belépett (aal 1): a kétlépcsős kód nélkül semmi nem érhető el.
      const token = await createSession(db, config, user.id, { ip: request.ip, userAgent: request.headers["user-agent"] });
      setSessionCookie(reply, config, token);
      return { ok: true, kovetkezo: (user.totpEnabledAt ? "totp" : "totp-beallitas") satisfies Kovetkezo };
    });

    /** Kétlépcsős azonosítás beállítása: új titok és QR-kód (csak ha még nincs bekapcsolva). */
    app.post("/api/auth/totp/beallitas", async (request) => {
      const { user } = requirePartialUser(request);
      const titok = await startTotpSetup(db, config, user.id);
      const url = otpauthUrl(titok, user.email);
      return { titok, otpauthUrl: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
    });

    /** Bekapcsolás az első kóddal; a válaszban a 10 visszaállító kód (csak most látható). */
    app.post("/api/auth/totp/aktivalas", async (request) => {
      const { user, session } = requirePartialUser(request);
      const { kod } = parseBody(kodSchema, request.body);
      const visszaallitoKodok = await activateTotp(db, config, user.id, kod, request.ip);
      await elevateSession(db, config, session.id);
      return { ok: true, visszaallitoKodok };
    });

    /** A kód (vagy egy visszaállító kód) megadása a jelszó után. */
    app.post("/api/auth/totp/ellenorzes", async (request) => {
      const { user, session } = requirePartialUser(request);
      const input = parseBody(ellenorzesSchema, request.body);
      await verifySecondFactor(db, config, user.id, input, request.ip);
      await elevateSession(db, config, session.id);
      return { ok: true };
    });

    app.post("/api/auth/logout", async (request, reply) => {
      if (request.sessionId) {
        await db.delete(sessions).where(eq(sessions.id, request.sessionId));
        await db.insert(authEvents).values({
          userId: (request.authUser ?? request.partialUser)?.id ?? null,
          email: (request.authUser ?? request.partialUser)?.email ?? null,
          event: "LOGOUT",
          ip: request.ip,
          userAgent: request.headers["user-agent"]?.slice(0, 300) ?? null,
        });
      }
      clearSessionCookie(reply);
      // Közös belépésnél a kijelentkezés a portálon folytatódik: onnan minden modul kilépési jelzést kap.
      const portalKilepes = request.session?.sso && config.sso ? `${config.sso.portalUrl}/kilepes` : null;
      return { ok: true, portalKilepes };
    });

    app.get("/api/auth/me", async (request): Promise<MeResponse> => {
      const user = requireUser(request);
      const rows = await db
        .select({ id: companies.id, name: companies.name, shortName: companies.shortName, role: companyMemberships.role })
        .from(companyMemberships)
        .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
        .where(eq(companyMemberships.userId, user.id))
        .orderBy(companies.shortName);
      return { user, companies: rows, sso: request.session?.sso ?? false, portalUrl: config.sso?.portalUrl ?? null };
    });

    app.post("/api/auth/password", async (request) => {
      const authUser = requireUser(request);
      const input = parseBody(changePasswordSchema, request.body);
      const [user] = await db.select().from(users).where(eq(users.id, authUser.id)).limit(1);
      if (!user || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
        throw validationError({ currentPassword: "A jelenlegi jelszó nem megfelelő." });
      }
      const passwordHash = await hashPassword(input.newPassword);
      await db.transaction(async (tx) => {
        await tx.update(users).set({ passwordHash, mustChangePassword: false }).where(eq(users.id, user.id));
        // A többi eszközön lévő munkamenet megszűnik.
        if (request.sessionId) {
          await tx.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, request.sessionId)));
        }
        await tx.insert(authEvents).values({ userId: user.id, email: user.email, event: "PASSWORD_CHANGED", ip: request.ip });
        await writeAudit(tx, {
          companyId: null,
          userId: user.id,
          action: "user.password_change",
          entityType: "user",
          entityId: user.id,
          ip: request.ip,
        });
      });
      return { ok: true };
    });
  },
};
