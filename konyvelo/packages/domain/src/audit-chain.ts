import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json";

/**
 * Audit napló hash-lánc. Minden bejegyzés hash-e a bejegyzés tartalmából és
 * az előző bejegyzés hash-éből számolódik. Ha bármelyik korábbi bejegyzést
 * utólag megváltoztatják vagy törlik, a lánc ellenőrzése jelzi.
 *
 * Láncok: cégenként egy, valamint egy közös a céghez nem köthető
 * eseményeknek (company_id = null).
 */

export type AuditHashInput = {
  prevHash: string | null;
  companyId: string | null;
  userId: string | null;
  /** ISO időbélyeg, ezredmásodperc pontossággal (UTC). */
  at: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
};

export function computeAuditHash(input: AuditHashInput): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        v: 1,
        prevHash: input.prevHash,
        companyId: input.companyId,
        userId: input.userId,
        at: input.at,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before ?? null,
        after: input.after ?? null,
      }),
    )
    .digest("hex");
}

export type AuditRecord = AuditHashInput & { id: number | string; hash: string };

export type ChainVerification =
  | { ok: true; count: number }
  | { ok: false; count: number; brokenAtId: number | string; reason: "HASH_MISMATCH" | "LINK_BROKEN" };

/** A bejegyzéseket azonosító szerint növekvő sorrendben kell átadni (egy láncon belül). */
export function verifyAuditChain(records: readonly AuditRecord[]): ChainVerification {
  let prev: string | null = null;
  for (const r of records) {
    if (r.prevHash !== prev) return { ok: false, count: records.length, brokenAtId: r.id, reason: "LINK_BROKEN" };
    if (computeAuditHash(r) !== r.hash) {
      return { ok: false, count: records.length, brokenAtId: r.id, reason: "HASH_MISMATCH" };
    }
    prev = r.hash;
  }
  return { ok: true, count: records.length };
}
