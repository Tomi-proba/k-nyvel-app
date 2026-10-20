import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, appQuery, createCompany, createTestApp, ownerQuery, resetDatabase, setupAdmin, type TestContext } from "./helpers";

let ctx: TestContext;
let admin: Client;

beforeAll(async () => {
  await resetDatabase();
  ctx = await createTestApp();
  admin = await setupAdmin(ctx.app);
});
afterAll(async () => ctx.close());

describe("audit napló", () => {
  it("minden módosítás bekerül, ép lánccal", async () => {
    const c = await createCompany(admin);
    await admin.patch(`/api/companies/${c.id}`, { addressCity: "Debrecen" });
    await admin.post(`/api/companies/${c.id}/fiscal-years`, { startDate: "2026-01-01", endDate: "2026-12-31" });

    const log = (await admin.get(`/api/companies/${c.id}/audit-log`)).json();
    expect(log.entries.map((e: { action: string }) => e.action)).toEqual([
      "fiscal_year.create",
      "company.update",
      "accounts.load_default",
      "member.add",
      "company.create",
    ]);
    expect(log.entries[0].userName).toBe("Admin Anna");
    expect((await admin.get(`/api/companies/${c.id}/audit-log/verify`)).json()).toEqual({ ok: true, count: 5 });
  });

  it("párhuzamos módosításoknál is ép marad a lánc", async () => {
    const c = await createCompany(admin);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => admin.patch(`/api/companies/${c.id}`, { addressLine: `Fő utca ${i + 1}.` })),
    );
    const v = (await admin.get(`/api/companies/${c.id}/audit-log/verify`)).json();
    expect(v.ok).toBe(true);
    expect(v.count).toBe(13);
  });

  it("az alkalmazás nem módosíthatja és nem törölheti", async () => {
    await expect(appQuery("UPDATE audit_log SET action = 'x'")).rejects.toThrow();
    await expect(appQuery("DELETE FROM audit_log")).rejects.toThrow();
  });

  it("a tulajdonosnak sem engedi a trigger", async () => {
    await expect(ownerQuery("UPDATE audit_log SET action = 'x'")).rejects.toThrow(/nem módosítható/);
    await expect(ownerQuery("TRUNCATE audit_log")).rejects.toThrow(/nem módosítható/);
  });

  it("a trigger megkerülésével végzett módosítás kimutatható", async () => {
    const c = await createCompany(admin);
    await admin.patch(`/api/companies/${c.id}`, { addressCity: "Győr" });
    // Szándékos manipuláció: a tulajdonos kikapcsolja a triggert és átír egy bejegyzést.
    await ownerQuery(`
      BEGIN;
      ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update_delete;
      UPDATE audit_log SET after = '{"addressCity":"Sopron"}' WHERE company_id = '${c.id}' AND action = 'company.update';
      ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_update_delete;
      COMMIT;`);
    const v = (await admin.get(`/api/companies/${c.id}/audit-log/verify`)).json();
    expect(v).toMatchObject({ ok: false, reason: "HASH_MISMATCH" });
  });

  it("lapozás", async () => {
    const c = await createCompany(admin);
    for (let i = 0; i < 5; i++) await admin.patch(`/api/companies/${c.id}`, { addressLine: `Utca ${i}` });
    const first = (await admin.get(`/api/companies/${c.id}/audit-log?limit=3`)).json();
    expect(first.entries).toHaveLength(3);
    // 8 bejegyzés: cég létrehozása, tag hozzáadása, számlatükör betöltése, 5 módosítás → 3 + 3 + 2.
    const second = (await admin.get(`/api/companies/${c.id}/audit-log?limit=3&before=${first.nextBefore}`)).json();
    expect(second.entries).toHaveLength(3);
    expect(Number(second.entries[0].id)).toBeLessThan(Number(first.entries[2].id));
    const third = (await admin.get(`/api/companies/${c.id}/audit-log?limit=3&before=${second.nextBefore}`)).json();
    expect(third.entries.map((e: { action: string }) => e.action)).toEqual(["member.add", "company.create"]);
    expect(third.nextBefore).toBeNull();
  });
});
