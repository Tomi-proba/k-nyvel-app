// Közös belépés (AWEBOLDAL TERV.md F21) a Könyvelőben: kötelező kétlépcsős azonosítás a régi belépésben is,
// belépés a portál jegyével (csak aal2, egyszer használható), összekapcsolás egyszeri régi belépéssel,
// cég-összerendelés, kilépési jelzés, tétlenségi idő, a régi belépés biztonságos kapcsolója, átállási lista.
import { randomUUID } from "node:crypto";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { belepesiCimzett, kilepesiCimzett } from "@konyvelo/esemenyek";
import type { Config } from "../src/config";
import { totpKod, totpLepes } from "../src/core/totp";
import {
  Client,
  PASSWORD,
  aktualisKod,
  appQuery,
  createCompany,
  createTestApp,
  login,
  ownerQuery,
  resetDatabase,
  setupAdmin,
  totpTitkok,
  type TestContext,
} from "./helpers";

const KIADO = "http://portal.teszt";
let ctx: TestContext;
let sso: TestContext;
let kulcs: CryptoKey;
let jwk: JWK;

async function ssoConfig(): Promise<Partial<Config>> {
  return { sso: { kiado: KIADO, portalUrl: KIADO, jwksUrl: `${KIADO}/.well-known/jwks.json`, keys: createLocalJWKSet({ keys: [jwk] }) } };
}

type JegyAdat = { sub: string; sid?: string; email: string; name?: string; cegId: string; szerep?: string; modulSzerep?: string | null; tetlenseg?: number; aal?: string };

async function belepesiJegy(a: JegyAdat, modul: "konyvelo" | "afa" = "konyvelo"): Promise<string> {
  return new SignJWT({
    sid: a.sid ?? `sid-${a.sub}`,
    email: a.email,
    name: a.name ?? "Portál Péter",
    aal: a.aal ?? "aal2",
    tetlenseg_perc: a.tetlenseg ?? 30,
    ceg: { id: a.cegId, nev: "Minta Kft.", szerep: a.szerep ?? "tulajdonos", modulSzerep: a.modulSzerep ?? null, csakOlvashato: false },
  })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setIssuer(KIADO)
    .setSubject(a.sub)
    .setAudience(belepesiCimzett(modul))
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("120s")
    .sign(kulcs);
}

async function kilepesiJegy(sub: string, sid: string): Promise<string> {
  return new SignJWT({ sid, esemeny: "kilepes" })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setIssuer(KIADO)
    .setSubject(sub)
    .setAudience(kilepesiCimzett("konyvelo"))
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("300s")
    .sign(kulcs);
}

beforeAll(async () => {
  await resetDatabase();
  const p = await generateKeyPair("ES256", { extractable: true });
  kulcs = p.privateKey;
  jwk = { ...(await exportJWK(p.publicKey)), kid: "k1", alg: "ES256", use: "sig" };
  ctx = await createTestApp();
  sso = await createTestApp(await ssoConfig());
});
afterAll(async () => {
  await ctx?.close();
  await sso?.close();
});

describe("kötelező kétlépcsős azonosítás a régi belépésben", () => {
  it("első adminisztrátor: a beállításig semmi nem érhető el", async () => {
    const c = new Client(ctx.app);
    const r = await c.post("/api/setup", { name: "Admin Anna", email: "admin@example.hu", password: PASSWORD });
    expect(r.json()).toMatchObject({ kovetkezo: "totp-beallitas" });
    const me = await c.get("/api/auth/me");
    expect(me.statusCode).toBe(401);
    expect(me.json().error.code).toBe("TOTP_SETUP_REQUIRED");
    expect((await c.get("/api/companies")).statusCode).toBe(401);

    const b = (await c.post("/api/auth/totp/beallitas")).json();
    expect(b.qr).toMatch(/^data:image\/png;base64,/);
    expect(b.otpauthUrl).toContain("otpauth://totp/");
    expect((await c.post("/api/auth/totp/aktivalas", { kod: "000000" })).statusCode).toBe(400);
    const a = await c.post("/api/auth/totp/aktivalas", { kod: totpKod(b.titok, totpLepes()) });
    expect(a.statusCode).toBe(200);
    expect(a.json().visszaallitoKodok).toHaveLength(10);
    totpTitkok.set("admin@example.hu", b.titok);
    visszaallito = a.json().visszaallitoKodok;
    expect((await c.get("/api/auth/me")).statusCode).toBe(200);
    // Bekapcsolt 2FA nem írható felül új titokkal.
    expect((await c.post("/api/auth/totp/beallitas")).statusCode).toBe(409);
    // A titok titkosítva van tárolva.
    const { rows } = await ownerQuery("SELECT totp_secret FROM users WHERE email = 'admin@example.hu'");
    expect(rows[0].totp_secret).toMatch(/^v1\./);
    expect(rows[0].totp_secret).not.toContain(b.titok);
  });

  let visszaallito: string[] = [];

  it("jelszó után a kód kell; rossz kód, ugyanaz a kód kétszer, visszaállító kód egyszer", async () => {
    const c = new Client(ctx.app);
    expect((await c.post("/api/auth/login", { email: "admin@example.hu", password: PASSWORD })).json()).toMatchObject({ kovetkezo: "totp" });
    const me = await c.get("/api/auth/me");
    expect(me.json().error.code).toBe("TOTP_REQUIRED");
    expect((await c.post("/api/auth/totp/ellenorzes", { kod: "123456" })).statusCode).toBe(400);
    const kod = await aktualisKod(ctx.app, "admin@example.hu");
    expect((await c.post("/api/auth/totp/ellenorzes", { kod })).statusCode).toBe(200);
    expect((await c.get("/api/auth/me")).statusCode).toBe(200);

    const c2 = new Client(ctx.app);
    await c2.post("/api/auth/login", { email: "admin@example.hu", password: PASSWORD });
    expect((await c2.post("/api/auth/totp/ellenorzes", { kod })).statusCode).toBe(400); // ismételt kód
    expect((await c2.post("/api/auth/totp/ellenorzes", { visszaallitoKod: visszaallito[0] })).statusCode).toBe(200);
    const c3 = new Client(ctx.app);
    await c3.post("/api/auth/login", { email: "admin@example.hu", password: PASSWORD });
    expect((await c3.post("/api/auth/totp/ellenorzes", { visszaallitoKod: visszaallito[0] })).statusCode).toBe(400);
  });

  it("5 hibás kód után 15 percig zárolva", async () => {
    const c = new Client(ctx.app);
    await c.post("/api/auth/login", { email: "admin@example.hu", password: PASSWORD });
    // Az előző teszt 3 hibás kódja is számít.
    for (let i = 0; i < 2; i++) await c.post("/api/auth/totp/ellenorzes", { kod: "111111" });
    const r = await c.post("/api/auth/totp/ellenorzes", { kod: await aktualisKod(ctx.app, "admin@example.hu") });
    expect(r.statusCode).toBe(429);
    await ownerQuery("ALTER TABLE auth_events DISABLE TRIGGER auth_events_no_update_delete");
    await ownerQuery("DELETE FROM auth_events WHERE event = 'TOTP_FAILURE'");
    await ownerQuery("ALTER TABLE auth_events ENABLE TRIGGER auth_events_no_update_delete");
  });

  it("a meglévő (jelszavas) munkamenetek a migráció után kódot kérnek", async () => {
    const admin = await login(ctx.app, "admin@example.hu");
    await ownerQuery("UPDATE sessions SET aal = 1");
    const me = await admin.get("/api/auth/me");
    expect(me.statusCode).toBe(401);
    expect(me.json().error.code).toBe("TOTP_REQUIRED");
  });

  it("az új tag első belépéskor beállítja a 2FA-t", async () => {
    const admin = await login(ctx.app, "admin@example.hu");
    const c = await createCompany(admin);
    await admin.post(`/api/companies/${c.id}/members`, { email: "tag@example.hu", name: "Tag Tamás", role: "ACCOUNTANT", initialPassword: PASSWORD });
    const t = new Client(ctx.app);
    expect((await t.post("/api/auth/login", { email: "tag@example.hu", password: PASSWORD })).json()).toMatchObject({ kovetkezo: "totp-beallitas" });
    expect((await t.get(`/api/companies/${c.id}`)).statusCode).toBe(401);
    await login(ctx.app, "tag@example.hu"); // a helper végigmegy a beállításon
    expect((await (await login(ctx.app, "tag@example.hu")).get("/api/auth/me")).statusCode).toBe(200);
  });

  it("tétlenség: 30 perc; felső határ: 12 óra", async () => {
    const admin = await login(ctx.app, "admin@example.hu");
    const { rows } = await appQuery("SELECT round(extract(epoch FROM expires_at - last_seen_at) / 60) AS idle, round(extract(epoch FROM max_expires_at - created_at) / 3600) AS max FROM sessions ORDER BY created_at DESC LIMIT 1",
    );
    expect(rows[0]).toEqual({ idle: "30", max: "12" });
    await ownerQuery("UPDATE sessions SET max_expires_at = now() - interval '1 second', expires_at = now() + interval '10 minutes'");
    expect((await admin.get("/api/auth/me")).statusCode).toBe(401);
  });
});

describe("közös belépés a portál jegyével", () => {
  const portalCeg = randomUUID();
  let companyId: string;

  it("kikapcsolt közös belépésnél nincs végpont", async () => {
    expect((await new Client(ctx.app).post("/api/auth/sso", { jegy: "x".repeat(40) })).statusCode).toBe(404);
  });

  it("csak érvényes, kétlépcsős, ennek a modulnak szóló jegy jó", async () => {
    const c = new Client(sso.app);
    expect((await c.post("/api/auth/sso", { jegy: await belepesiJegy({ sub: "p-admin", email: "admin@example.hu", cegId: portalCeg, aal: "aal1" }) })).json().error.code).toBe(
      "SSO_NEM_KETLEPCSOS",
    );
    expect((await c.post("/api/auth/sso", { jegy: await belepesiJegy({ sub: "p-admin", email: "admin@example.hu", cegId: portalCeg }, "afa") })).json().error.code).toBe(
      "SSO_ROSSZ_CIMZETT",
    );
    const masik = await generateKeyPair("ES256");
    const hamis = await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: "k1" }).setIssuer(KIADO).setAudience(belepesiCimzett("konyvelo")).sign(masik.privateKey);
    expect((await c.post("/api/auth/sso", { jegy: hamis })).statusCode).toBe(401);
  });

  it("régi fiók: összekapcsolás csak jelszóval ÉS kétlépcsős kóddal; utána a jegy azonnal beléptet", async () => {
    const c = new Client(sso.app);
    const jegy = await belepesiJegy({ sub: "p-admin", sid: "sid-admin-1", email: "admin@example.hu", cegId: portalCeg });
    const r = (await c.post("/api/auth/sso", { jegy })).json();
    expect(r).toMatchObject({ kovetkezo: "osszekapcsolas", cegOsszerendelve: false });
    // Ugyanaz a jegy másodszor nem jó.
    expect((await new Client(sso.app).post("/api/auth/sso", { jegy })).json().error.code).toBe("SSO_MAR_FELHASZNALT");
    // Az e-mail egyezése önmagában nem elég, és a jelszó sem: a kód is kell.
    expect((await c.get("/api/auth/me")).statusCode).toBe(401);
    expect((await c.post("/api/auth/sso/osszekapcsolas", { kapcsolas: r.kapcsolas, email: "admin@example.hu", jelszo: "rossz-jelszo-1234" })).statusCode).toBe(401);
    expect((await c.post("/api/auth/sso/osszekapcsolas", { kapcsolas: r.kapcsolas, email: "admin@example.hu", jelszo: PASSWORD })).statusCode).toBe(400);
    const ok = await c.post("/api/auth/sso/osszekapcsolas", {
      kapcsolas: r.kapcsolas,
      email: "admin@example.hu",
      jelszo: PASSWORD,
      kod: await aktualisKod(sso.app, "admin@example.hu"),
    });
    expect(ok.json()).toMatchObject({ kovetkezo: "kesz" });
    const me = (await c.get("/api/auth/me")).json();
    expect(me).toMatchObject({ sso: true, portalUrl: KIADO, user: { email: "admin@example.hu" } });
    companyId = me.companies[0].id;

    const c2 = new Client(sso.app);
    expect((await c2.post("/api/auth/sso", { jegy: await belepesiJegy({ sub: "p-admin", sid: "sid-admin-2", email: "admin@example.hu", cegId: portalCeg }) })).json()).toMatchObject({
      kovetkezo: "kesz",
    });
    expect((await c2.get("/api/auth/me")).statusCode).toBe(200);
  });

  it("a cég összerendelése után az új portál-felhasználó fiókja magától létrejön, a portál szerepe szerint", async () => {
    const admin = new Client(sso.app);
    await admin.post("/api/auth/sso", { jegy: await belepesiJegy({ sub: "p-admin", sid: "sid-admin-3", email: "admin@example.hu", cegId: portalCeg }) });
    expect((await admin.post("/api/auth/sso/ceg", { companyId })).statusCode).toBe(200);
    // A régi belépéssel (portál-cég nélkül) nem lehet összerendelni.
    expect((await (await login(sso.app, "admin@example.hu")).post("/api/auth/sso/ceg", { companyId })).statusCode).toBe(400);

    const uj = new Client(sso.app);
    const r = await uj.post("/api/auth/sso", { jegy: await belepesiJegy({ sub: "p-konyvelo", sid: "sid-konyvelo", email: "iroda@example.hu", name: "Iroda Ilona", cegId: portalCeg, szerep: "konyvelo" }) });
    expect(r.json()).toMatchObject({ kovetkezo: "kesz", companyId });
    const me = (await uj.get("/api/auth/me")).json();
    expect(me.companies).toEqual([expect.objectContaining({ id: companyId, role: "CHIEF_ACCOUNTANT" })]);
    // A régi belépéshez nincs ismert jelszava.
    expect((await new Client(sso.app).post("/api/auth/login", { email: "iroda@example.hu", password: PASSWORD })).statusCode).toBe(401);
  });

  it("a tétlenségi idő a jegyből jön (legfeljebb 12 óra)", async () => {
    const c = new Client(sso.app);
    await c.post("/api/auth/sso", { jegy: await belepesiJegy({ sub: "p-admin", sid: "sid-hosszu", email: "admin@example.hu", cegId: portalCeg, tetlenseg: 480 }) });
    const { rows } = await appQuery("SELECT idle_minutes, aal FROM sessions WHERE portal_sid = 'sid-hosszu'");
    expect(rows[0]).toEqual({ idle_minutes: 480, aal: 2 });
  });

  it("kilépési jelzés: a portál-munkamenet minden Könyvelő-munkamenete megszűnik; az újraküldés is rendben", async () => {
    const c = new Client(sso.app);
    await c.post("/api/auth/sso", { jegy: await belepesiJegy({ sub: "p-admin", sid: "sid-kilepes-1", email: "admin@example.hu", cegId: portalCeg }) });
    const masik = new Client(sso.app);
    await masik.post("/api/auth/sso", { jegy: await belepesiJegy({ sub: "p-admin", sid: "sid-marad", email: "admin@example.hu", cegId: portalCeg }) });
    expect((await c.get("/api/auth/me")).statusCode).toBe(200);

    const jegy = await kilepesiJegy("p-admin", "sid-kilepes-1");
    // Szerverről szerverre jön: CSRF-fejléc és süti nélkül.
    const r = await sso.app.inject({ method: "POST", url: "/api/auth/sso/kilepes", payload: { jegy } });
    expect(r.statusCode).toBe(204);
    expect((await c.get("/api/auth/me")).statusCode).toBe(401);
    expect((await masik.get("/api/auth/me")).statusCode).toBe(200);
    expect((await sso.app.inject({ method: "POST", url: "/api/auth/sso/kilepes", payload: { jegy } })).statusCode).toBe(204);
    expect((await sso.app.inject({ method: "POST", url: "/api/auth/sso/kilepes", payload: { jegy: "hamis.jegy.ertek-xxxxxxxxxxxx" } })).statusCode).toBe(401);
  });

  it("a kijelentkezés közös belépésnél a portálon folytatódik", async () => {
    const c = new Client(sso.app);
    await c.post("/api/auth/sso", { jegy: await belepesiJegy({ sub: "p-admin", sid: "sid-kilep", email: "admin@example.hu", cegId: portalCeg }) });
    expect((await c.post("/api/auth/logout")).json()).toEqual({ ok: true, portalKilepes: `${KIADO}/kilepes` });
    const regi = await login(sso.app, "admin@example.hu");
    expect((await regi.post("/api/auth/logout")).json()).toEqual({ ok: true, portalKilepes: null });
  });

  it("átállási lista és a régi belépés kapcsolója: amíg valaki nincs összekapcsolva, a régi belépés marad", async () => {
    const admin = await login(sso.app, "admin@example.hu");
    const l = (await admin.get("/api/auth/sso/atallas")).json();
    expect(l).toMatchObject({ sso: true, regiBelepes: true });
    expect(l.tagok).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: "admin@example.hu", osszekapcsolva: true, ketlepcsos: true }),
        expect.objectContaining({ email: "iroda@example.hu", osszekapcsolva: true }),
      ]),
    );

    const ki = await createTestApp({ ...(await ssoConfig()), regiBelepes: false });
    try {
      // A tag@example.hu még nincs összekapcsolva: a régi belépés a kapcsoló ellenére is él.
      expect((await new Client(ki.app).get("/api/setup/status")).json()).toMatchObject({ regiBelepes: true });
      await login(ki.app, "tag@example.hu");
      await ownerQuery("UPDATE users SET is_active = false WHERE email = 'tag@example.hu'");
      expect((await new Client(ki.app).get("/api/setup/status")).json()).toMatchObject({ regiBelepes: false, portalUrl: KIADO });
      const r = await new Client(ki.app).post("/api/auth/login", { email: "admin@example.hu", password: PASSWORD });
      expect(r.statusCode).toBe(403);
      expect(r.json().error.code).toBe("REGI_BELEPES_KIKAPCSOLVA");
    } finally {
      await ownerQuery("UPDATE users SET is_active = true WHERE email = 'tag@example.hu'");
      await ki.close();
    }
  });
});
