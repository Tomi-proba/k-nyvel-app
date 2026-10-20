import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { computeAuditHash, verifyAuditChain, type ChainVerification } from "@konyvelo/domain/audit-chain";
import type { Executor, Tx } from "./db";
import { auditLog } from "./schema";

export type AuditEvent = {
  companyId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
};

/**
 * Bejegyzés az audit naplóba, UGYANABBAN a tranzakcióban, mint maga a
 * módosítás: ha a módosítás visszagörgetődik, a bejegyzés sem marad meg, és
 * fordítva. A láncon belüli sorrendet tranzakciós zár biztosítja.
 */
export async function writeAudit(tx: Tx, e: AuditEvent): Promise<void> {
  const chainKey = `audit:${e.companyId ?? "global"}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${chainKey}, 0))`);

  const [last] = await tx
    .select({ hash: auditLog.hash })
    .from(auditLog)
    .where(e.companyId ? eq(auditLog.companyId, e.companyId) : isNull(auditLog.companyId))
    .orderBy(desc(auditLog.id))
    .limit(1);

  const at = new Date();
  const record = {
    prevHash: last?.hash ?? null,
    companyId: e.companyId,
    userId: e.userId,
    at: at.toISOString(),
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    // A JSON-on keresztüli átalakítás biztosítja, hogy a hash ugyanabból az
    // adatból készüljön, ami a jsonb oszlopba kerül.
    before: e.before == null ? null : (JSON.parse(JSON.stringify(e.before)) as unknown),
    after: e.after == null ? null : (JSON.parse(JSON.stringify(e.after)) as unknown),
  };
  const hash = computeAuditHash(record);

  await tx.insert(auditLog).values({
    companyId: record.companyId,
    userId: record.userId,
    at,
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId,
    before: record.before,
    after: record.after,
    ip: e.ip ?? null,
    prevHash: record.prevHash,
    hash,
  });
}

/** Csak a ténylegesen megváltozott mezők (az audit naplóba így kevesebb zaj kerül). */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (after[key] === undefined) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return { before: b, after: a };
}

/** Egy cég (vagy a közös, céghez nem kötött) lánc teljes ellenőrzése. */
export async function verifyChain(db: Executor, companyId: string | null): Promise<ChainVerification> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(companyId ? eq(auditLog.companyId, companyId) : and(isNull(auditLog.companyId)))
    .orderBy(asc(auditLog.id));
  return verifyAuditChain(
    rows.map((r) => ({
      id: r.id,
      prevHash: r.prevHash,
      companyId: r.companyId,
      userId: r.userId,
      at: r.at.toISOString(),
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      before: r.before,
      after: r.after,
      hash: r.hash,
    })),
  );
}
