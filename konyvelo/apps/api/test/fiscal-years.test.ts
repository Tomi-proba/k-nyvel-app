import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, PASSWORD, appQuery, createCompany, createTestApp, login, resetDatabase, setupAdmin, type TestContext } from "./helpers";

let ctx: TestContext;
let admin: Client;

beforeAll(async () => {
  await resetDatabase();
  ctx = await createTestApp();
  admin = await setupAdmin(ctx.app);
});
afterAll(async () => ctx.close());

describe("üzleti évek", () => {
  it("naptári év létrehozása 12 havi időszakkal", async () => {
    const c = await createCompany(admin);
    const res = await admin.post(`/api/companies/${c.id}/fiscal-years`, { startDate: "2026-01-01", endDate: "2026-12-31" });
    expect(res.statusCode).toBe(201);
    const fy = res.json();
    expect(fy.status).toBe("OPEN");
    expect(fy.periods).toHaveLength(12);
    expect(fy.periods[1]).toMatchObject({ startDate: "2026-02-01", endDate: "2026-02-28", status: "OPEN" });
  });

  it("javaslat a következő évre, majd folytonosság ellenőrzése", async () => {
    const c = await createCompany(admin);
    await admin.post(`/api/companies/${c.id}/fiscal-years`, { startDate: "2026-01-01", endDate: "2026-12-31" });
    const suggestion = (await admin.get(`/api/companies/${c.id}/fiscal-years/suggestion`)).json();
    expect(suggestion).toEqual({ startDate: "2027-01-01", endDate: "2027-12-31" });

    const gap = await admin.post(`/api/companies/${c.id}/fiscal-years`, { startDate: "2028-01-01", endDate: "2028-12-31" });
    expect(gap.statusCode).toBe(422);
    expect(gap.json().error.fields.startDate).toMatch(/folytonos/);

    expect((await admin.post(`/api/companies/${c.id}/fiscal-years`, suggestion)).statusCode).toBe(201);
    expect((await admin.get(`/api/companies/${c.id}/fiscal-years`)).json()).toHaveLength(2);
  });

  it("átfedő év elutasítva", async () => {
    const c = await createCompany(admin);
    await admin.post(`/api/companies/${c.id}/fiscal-years`, { startDate: "2026-01-01", endDate: "2026-12-31" });
    const res = await admin.post(`/api/companies/${c.id}/fiscal-years`, { startDate: "2026-07-01", endDate: "2027-06-30" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.fields.startDate).toMatch(/átfedésben/);
  });

  it("12 hónapnál hosszabb év csak indoklással", async () => {
    const c = await createCompany(admin);
    const body = { startDate: "2025-11-10", endDate: "2026-12-31" };
    expect((await admin.post(`/api/companies/${c.id}/fiscal-years`, body)).statusCode).toBe(422);
    const res = await admin.post(`/api/companies/${c.id}/fiscal-years`, { ...body, exceptionReason: "Előtársasági időszak" });
    expect(res.statusCode).toBe(201);
    expect(res.json().periods).toHaveLength(14);
  });

  it("hibás dátum magyar hibaüzenettel", async () => {
    const c = await createCompany(admin);
    const res = await admin.post(`/api/companies/${c.id}/fiscal-years`, { startDate: "2026-02-30", endDate: "2026-12-31" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.fields.startDate).toMatch(/érvénytelen dátum/);
  });

  it("az adatbázis is megakadályozza az átfedést (alkalmazást megkerülve)", async () => {
    const c = await createCompany(admin);
    await admin.post(`/api/companies/${c.id}/fiscal-years`, { startDate: "2026-01-01", endDate: "2026-12-31" });
    const userId = (await admin.get("/api/auth/me")).json().user.id;
    await expect(
      appQuery("INSERT INTO fiscal_years (company_id, start_date, end_date, created_by) VALUES ($1, '2026-06-01', '2027-05-31', $2)", [c.id, userId]),
    ).rejects.toThrow(/conflicting key|ütköz/);
  });

  it("üzleti év csak Vezető könyvelőnek vagy Adminisztrátornak", async () => {
    const c = await createCompany(admin);
    await admin.post(`/api/companies/${c.id}/members`, { email: "kata@example.hu", name: "Könyvelő Kata", role: "ACCOUNTANT", initialPassword: PASSWORD });
    await admin.post(`/api/companies/${c.id}/members`, { email: "vera@example.hu", name: "Vezető Vera", role: "CHIEF_ACCOUNTANT", initialPassword: PASSWORD });
    const kata = await login(ctx.app, "kata@example.hu");
    const vera = await login(ctx.app, "vera@example.hu");
    const body = { startDate: "2026-01-01", endDate: "2026-12-31" };
    expect((await kata.post(`/api/companies/${c.id}/fiscal-years`, body)).statusCode).toBe(403);
    expect((await kata.get(`/api/companies/${c.id}/fiscal-years`)).statusCode).toBe(200);
    expect((await vera.post(`/api/companies/${c.id}/fiscal-years`, body)).statusCode).toBe(201);
  });
});
