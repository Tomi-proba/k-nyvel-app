import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CSRF_HEADER } from "@konyvelo/shared";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { Client, PASSWORD, appQuery, createTestApp, login, resetDatabase, setupAdmin, type TestContext } from "./helpers";

let ctx: TestContext;

beforeAll(async () => {
  await resetDatabase();
  ctx = await createTestApp();
});
afterAll(async () => ctx.close());

describe("első indítás és belépés", () => {
  it("üres rendszerben beállítás szükséges", async () => {
    const res = await new Client(ctx.app).get("/api/setup/status");
    expect(res.json()).toEqual({ needsSetup: true });
  });

  it("gyenge jelszót elutasít magyar hibaüzenettel", async () => {
    const res = await new Client(ctx.app).post("/api/setup", { name: "A", email: "a@example.hu", password: "rovid" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.fields.password).toMatch(/legalább 12 karakter/);
  });

  it("létrehozza az első felhasználót és be is lépteti", async () => {
    const client = await setupAdmin(ctx.app);
    const me = await client.get("/api/auth/me");
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ email: "admin@example.hu", name: "Admin Anna", mustChangePassword: false });
  });

  it("második beállítás nem lehetséges", async () => {
    const res = await new Client(ctx.app).post("/api/setup", { name: "B", email: "b@example.hu", password: PASSWORD });
    expect(res.statusCode).toBe(409);
    expect((await new Client(ctx.app).get("/api/setup/status")).json()).toEqual({ needsSetup: false });
  });

  it("bejelentkezés nélkül nincs hozzáférés", async () => {
    const res = await new Client(ctx.app).get("/api/auth/me");
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toMatch(/be kell jelentkeznie/);
  });

  it("belépés: kis- és nagybetű nem számít az e-mail-címben", async () => {
    const client = await login(ctx.app, "ADMIN@example.hu");
    expect((await client.get("/api/auth/me")).statusCode).toBe(200);
  });

  it("a süti HttpOnly és SameSite=Strict", async () => {
    const res = await new Client(ctx.app).post("/api/auth/login", { email: "admin@example.hu", password: PASSWORD });
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
  });

  it("kilépés után a munkamenet érvénytelen", async () => {
    const client = await login(ctx.app, "admin@example.hu");
    expect((await client.post("/api/auth/logout")).statusCode).toBe(200);
    expect((await client.get("/api/auth/me")).statusCode).toBe(401);
  });

  it("CSRF fejléc nélküli módosító kérés elutasítva", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@example.hu", password: PASSWORD } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("CSRF");
  });

  it("idegen Origin elutasítva", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { [CSRF_HEADER]: "1", origin: "https://tamado.example", host: "localhost:80" },
      payload: { email: "admin@example.hu", password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
  });

  it("az ALLOWED_ORIGINS-ban megadott cím (pl. Codespace) engedélyezett, más továbbra sem", async () => {
    const config = { ...loadConfig({ DATABASE_URL: "postgres://x", LOG_LEVEL: "silent", ALLOWED_ORIGINS: "https://proba-5173.app.github.dev/" }), webDistDir: null };
    const app = await buildApp(config, ctx.db);
    const send = (origin: string) =>
      app.inject({ method: "POST", url: "/api/auth/login", headers: { [CSRF_HEADER]: "1", origin, host: "localhost:5173" }, payload: { email: "nincs@example.hu", password: "rossz-jelszo-1234" } });
    expect((await send("https://proba-5173.app.github.dev")).statusCode).toBe(401);
    expect((await send("https://masik-5173.app.github.dev")).statusCode).toBe(403);
    await app.close();
  });
});

describe("sikertelen belépések", () => {
  it("rossz jelszó: általános hibaüzenet, esemény naplózva", async () => {
    const res = await new Client(ctx.app).post("/api/auth/login", { email: "admin@example.hu", password: "rossz-jelszo-123" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe("Hibás e-mail-cím vagy jelszó.");
    const ev = await appQuery("SELECT event FROM auth_events WHERE event = 'LOGIN_FAILURE'");
    expect(ev.rowCount).toBeGreaterThan(0);
  });

  it("nem létező felhasználó: ugyanaz az üzenet", async () => {
    const res = await new Client(ctx.app).post("/api/auth/login", { email: "nincs@example.hu", password: PASSWORD });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe("Hibás e-mail-cím vagy jelszó.");
  });

  it("5 hibás próbálkozás után átmeneti tiltás – helyes jelszóval sem lehet belépni", async () => {
    const email = "admin@example.hu";
    // Az előző tesztben már volt 1 hibás kísérlet ennél az e-mail-címnél.
    for (let i = 0; i < 4; i++) {
      await new Client(ctx.app).post("/api/auth/login", { email, password: "rossz-jelszo-123" });
    }
    const res = await new Client(ctx.app).post("/api/auth/login", { email, password: PASSWORD });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.message).toMatch(/15 perc/);
  });

  it("a belépési események nem módosíthatók", async () => {
    await expect(appQuery("DELETE FROM auth_events")).rejects.toThrow();
  });
});
