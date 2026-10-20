import { describe, expect, it } from "vitest";
import { type AuditRecord, computeAuditHash, verifyAuditChain } from "./audit-chain";
import { canonicalJson } from "./canonical-json";

function build(n: number): AuditRecord[] {
  const out: AuditRecord[] = [];
  let prev: string | null = null;
  for (let i = 1; i <= n; i++) {
    const base = {
      prevHash: prev,
      companyId: "c1",
      userId: "u1",
      at: `2026-10-20T10:00:0${i}.000Z`,
      action: "company.update",
      entityType: "company",
      entityId: "c1",
      before: { name: `A${i}` },
      after: { name: `B${i}` },
    };
    const hash = computeAuditHash(base);
    out.push({ ...base, id: i, hash });
    prev = hash;
  }
  return out;
}

describe("kanonikus JSON", () => {
  it("kulcssorrendtől független", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: null } })).toBe(canonicalJson({ a: { c: null, d: [1, 2] }, b: 1 }));
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe("audit hash-lánc", () => {
  it("ép lánc ellenőrzése sikeres", () => {
    expect(verifyAuditChain(build(5))).toEqual({ ok: true, count: 5 });
  });

  it("utólag módosított bejegyzés kimutatható", () => {
    const chain = build(5);
    chain[2] = { ...chain[2]!, after: { name: "HAMIS" } };
    expect(verifyAuditChain(chain)).toMatchObject({ ok: false, brokenAtId: 3, reason: "HASH_MISMATCH" });
  });

  it("törölt bejegyzés kimutatható", () => {
    const chain = build(5);
    chain.splice(1, 1);
    expect(verifyAuditChain(chain)).toMatchObject({ ok: false, brokenAtId: 3, reason: "LINK_BROKEN" });
  });

  it("üres lánc rendben", () => {
    expect(verifyAuditChain([])).toEqual({ ok: true, count: 0 });
  });
});
