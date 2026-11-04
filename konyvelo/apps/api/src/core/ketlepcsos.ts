/**
 * Kétlépcsős azonosítás (TOTP) a Könyvelőben: beállítás, bekapcsolás, ellenőrzés, visszaállító kódok.
 * A kód nélkül (aal 1) a felhasználó semmit nem ér el a 2FA-végpontokon kívül (lásd core/auth.ts requireUser).
 */
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import type { Config } from "../config";
import type { Executor } from "./db";
import { AppError } from "./errors";
import { authEvents, userRecoveryCodes, users } from "./schema";
import { kodNormalizal, sha256, titkosit, totpEllenoriz, ujTotpTitok, visszaallitoKodok, visszafejt } from "./totp";

const LOCK_WINDOW_MINUTES = 15;
const MAX_TOTP_FAILURES = 5;

export type SecondFactor = { kod?: string | undefined; visszaallitoKod?: string | undefined };

/** Új (még nem bekapcsolt) titok; a bekapcsolt kétlépcsős azonosítás nem írható felül így. */
export async function startTotpSetup(db: Executor, config: Config, userId: string): Promise<string> {
  const [u] = await db.select({ enabled: users.totpEnabledAt }).from(users).where(eq(users.id, userId)).limit(1);
  if (u?.enabled) throw new AppError(409, "TOTP_ALREADY_ENABLED", "A kétlépcsős azonosítás már be van kapcsolva.");
  const titok = ujTotpTitok();
  await db.update(users).set({ totpSecret: titkosit(titok, config.totpKey), totpLastStep: null }).where(eq(users.id, userId));
  return titok;
}

/** A beállítás közbeni titok első kódjával bekapcsolja a kétlépcsős azonosítást; 10 visszaállító kódot ad. */
export async function activateTotp(db: Executor, config: Config, userId: string, kod: string, ip: string): Promise<string[]> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u || u.totpEnabledAt) throw new AppError(409, "TOTP_ALREADY_ENABLED", "A kétlépcsős azonosítás már be van kapcsolva.");
  if (!u.totpSecret) throw new AppError(400, "TOTP_NOT_STARTED", "Előbb kérjen új QR-kódot.");
  await assertNotLocked(db, userId);
  const lepes = totpEllenoriz(visszafejt(u.totpSecret, config.totpKey), kod.trim(), null);
  if (lepes === null) {
    await db.insert(authEvents).values({ userId, email: u.email, event: "TOTP_FAILURE", ip });
    throw new AppError(400, "INVALID_CODE", "A kód nem megfelelő. Ellenőrizze a telefon óráját, és próbálja újra.");
  }
  const kodok = visszaallitoKodok();
  await db.update(users).set({ totpEnabledAt: new Date(), totpLastStep: lepes }).where(eq(users.id, userId));
  await db.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
  await db.insert(userRecoveryCodes).values(kodok.map((k) => ({ userId, codeHash: sha256(kodNormalizal(k)) })));
  await db.insert(authEvents).values({ userId, email: u.email, event: "TOTP_ENABLED", ip });
  return kodok;
}

async function assertNotLocked(db: Executor, userId: string): Promise<void> {
  const since = sql`now() - make_interval(mins => ${LOCK_WINDOW_MINUTES})`;
  const [r] = await db
    .select({ n: count() })
    .from(authEvents)
    .where(and(eq(authEvents.userId, userId), eq(authEvents.event, "TOTP_FAILURE"), gt(authEvents.at, since)));
  if ((r?.n ?? 0) >= MAX_TOTP_FAILURES) {
    throw new AppError(429, "TOO_MANY_ATTEMPTS", `Túl sok hibás kód. Kérjük, próbálja újra ${LOCK_WINDOW_MINUTES} perc múlva.`);
  }
}

/** A bekapcsolt kétlépcsős azonosítás ellenőrzése (kóddal vagy egyszer használható visszaállító kóddal). */
export async function verifySecondFactor(db: Executor, config: Config, userId: string, f: SecondFactor, ip: string): Promise<void> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u?.totpEnabledAt || !u.totpSecret) throw new AppError(400, "TOTP_SETUP_REQUIRED", "Előbb be kell állítania a kétlépcsős azonosítást.");
  await assertNotLocked(db, userId);
  const fail = async () => {
    await db.insert(authEvents).values({ userId, email: u.email, event: "TOTP_FAILURE", ip });
    throw new AppError(400, "INVALID_CODE", "A kód nem megfelelő.");
  };
  if (f.visszaallitoKod) {
    const [used] = await db
      .update(userRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(userRecoveryCodes.userId, userId),
          eq(userRecoveryCodes.codeHash, sha256(kodNormalizal(f.visszaallitoKod))),
          isNull(userRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: userRecoveryCodes.id });
    if (!used) return fail();
    await db.insert(authEvents).values({ userId, email: u.email, event: "RECOVERY_CODE_USED", ip });
    return;
  }
  const lepes = totpEllenoriz(visszafejt(u.totpSecret, config.totpKey), (f.kod ?? "").trim(), u.totpLastStep);
  if (lepes === null) return fail();
  // Ugyanaz a kód kétszer nem jó: a lépés csak előre mehet (párhuzamos kérésnél is).
  const [ok] = await db
    .update(users)
    .set({ totpLastStep: lepes })
    .where(and(eq(users.id, userId), sql`coalesce(${users.totpLastStep}, -1) < ${lepes}`))
    .returning({ id: users.id });
  if (!ok) return fail();
  await db.insert(authEvents).values({ userId, email: u.email, event: "TOTP_SUCCESS", ip });
}
