// Közös belépés (AWEBOLDAL TERV.md F21) a Könyvelőben: kötelező kétlépcsős azonosítás a régi belépésben is,
// belépés a portál jegyével (csak aal2, egyszer használható), összekapcsolás egyszeri régi belépéssel,
// cég-összerendelés, kilépési jelzés, tétlenségi idő, a régi belépés biztonságos kapcsolója, átállási lista.
import { randomUUID } from "node:crypto";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { belepesiCimzett, kilepesiCimzett, tagsagCimzett } from "@konyvelo/esemenyek";
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

type JegyAdat = {
  sub: string;
  sid?: string;
  email: string;
  name?: string;
  cegId: string;
  szerep?: string;
  modulSzerep?: string | null;
  tetlenseg?: number;
  aal?: string;
  /** A kezelő könyvelőiroda (F26a), ha az ügyfélcégre szól a jegy. */
  iroda?: { id: string; nev: string } | null;
};

async function belepesiJegy(a: JegyAdat, modul: "konyvelo" | "afa" = "konyvelo"): Promise<string> {
  return new SignJWT({
    sid: a.sid ?? `sid-${a.sub}`,
    email: a.email,
    name: a.name ?? "Portál Péter",
    aal: a.aal ?? "aal2",
    tetlenseg_perc: a.tetlenseg ?? 30,
    ceg: { id: a.cegId, nev: "Minta Kft.", szerep: a.szerep ?? "tulajdonos", modulSzerep: a.modulSzerep ?? null, csakOlvashato: false, iroda: a.iroda ?? null },
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

async function tagsagJelzes(sub: string, email: string, cegId: string, modulSzerep: string | null): Promise<string> {
  return new SignJWT({ esemeny: "tagsag", email, name: "Portál Péter", ceg: { id: cegId, nev: "Minta Kft." }, modulSzerep })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setIssuer(KIADO)
    .setSubject(sub)
    .setAudience(tagsagCimzett("konyvelo"))
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
    // A portál-könyvelő alapértelmezése „könyvelő” (F25): vezető könyvelővé a portálon lehet emelni.
    expect(me.companies).toEqual([expect.objectContaining({ id: companyId, role: "ACCOUNTANT" })]);
    // A régi belépéshez nincs ismert jelszava.
    expect((await new Client(sso.app).post("/api/auth/login", { email: "iroda@example.hu", password: PASSWORD })).statusCode).toBe(401);
  });

  it("F25: a szerep minden belépéskor a portálhoz igazodik; szerep nélkül nincs belépés", async () => {
    const c = new Client(sso.app);
    const jegyes = async (modulSzerep: string | null, sid: string) =>
      c.post("/api/auth/sso", { jegy: await belepesiJegy({ sub: "p-f25", sid, email: "f25@example.hu", name: "Füge Ferenc", cegId: portalCeg, szerep: "munkatars", modulSzerep }) });
    expect((await jegyes("VIEWER", "sid-f25-1")).json()).toMatchObject({ kovetkezo: "kesz", companyId });
    expect((await c.get("/api/auth/me")).json().companies).toEqual([expect.objectContaining({ id: companyId, role: "VIEWER" })]);
    // A portálon vezető könyvelővé emelték: a következő belépéskor már az.
    await jegyes("CHIEF_ACCOUNTANT", "sid-f25-2");
    expect((await c.get("/api/auth/me")).json().companies).toEqual([expect.objectContaining({ id: companyId, role: "CHIEF_ACCOUNTANT" })]);
    // A Könyvelő Tagok oldalán ez a tag a portálon kezelt: itt nem változtatható és nem távolítható el.
    const admin = new Client(sso.app);
    await admin.post("/api/auth/sso", { jegy: await belepesiJegy({ sub: "p-admin", sid: "sid-admin-f25", email: "admin@example.hu", cegId: portalCeg }) });
    const tagok = (await admin.get(`/api/companies/${companyId}/members`)).json() as Array<{ email: string; userId: string; portalKezeli: boolean }>;
    const f = tagok.find((t) => t.email === "f25@example.hu")!;
    expect(f.portalKezeli).toBe(true);
    expect((await admin.patch(`/api/companies/${companyId}/members/${f.userId}`, { role: "ADMIN" })).statusCode).toBe(409);
    expect((await admin.delete(`/api/companies/${companyId}/members/${f.userId}`)).statusCode).toBe(409);
    // Szerep nélküli jegy (régebbi portál, munkatárs): nincs belépés, a tagság megszűnik.
    const r = await jegyes(null, "sid-f25-3");
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("NINCS_HOZZAFERES");
    const { rows } = await ownerQuery("SELECT count(*)::int AS n FROM company_memberships m JOIN users u ON u.id = m.user_id WHERE u.email = 'f25@example.hu'");
    expect(rows[0].n).toBe(0);
  });

  it("F25: a portál tagság-jelzése azonnal igazít, eltávolításkor a munkamenet is megszűnik; hamis vagy idegen jelzés nem jó", async () => {
    const c = new Client(sso.app);
    await c.post("/api/auth/sso", { jegy: await belepesiJegy({ sub: "p-jelzes", sid: "sid-jelzes", email: "jelzes@example.hu", name: "Jel Zsófi", cegId: portalCeg, szerep: "munkatars", modulSzerep: "ACCOUNTANT" }) });
    expect((await c.get("/api/auth/me")).json().companies).toEqual([expect.objectContaining({ id: companyId, role: "ACCOUNTANT" })]);
    const kuld = async (j: string) => sso.app.inject({ method: "POST", url: "/api/auth/sso/tagsag", payload: { jelzes: j } });
    // Szerepváltás: azonnal érvényes, a munkamenet marad.
    const j1 = await tagsagJelzes("p-jelzes", "jelzes@example.hu", portalCeg, "VIEWER");
    expect((await kuld(j1)).statusCode).toBe(204);
    expect((await c.get("/api/auth/me")).json().companies).toEqual([expect.objectContaining({ id: companyId, role: "VIEWER" })]);
    // Ugyanaz a jelzés még egyszer: ártalmatlan.
    expect((await kuld(j1)).statusCode).toBe(204);
    // Ismeretlen portál-felhasználó (még nem lépett be): nincs teendő.
    expect((await kuld(await tagsagJelzes("p-ismeretlen", "x@example.hu", portalCeg, "VIEWER"))).statusCode).toBe(204);
    // Hamis jelzés és a belépési jegy jelzésként: elutasítva.
    expect((await kuld("hamis.jelzes.ertek-xxxxxxxxxxxx")).statusCode).toBe(401);
    expect((await kuld(await belepesiJegy({ sub: "p-jelzes", email: "jelzes@example.hu", cegId: portalCeg }))).statusCode).toBe(401);
    // Eltávolítás: a tagság és a cégre szóló munkamenet megszűnik.
    expect((await kuld(await tagsagJelzes("p-jelzes", "jelzes@example.hu", portalCeg, null))).statusCode).toBe(204);
    expect((await c.get("/api/auth/me")).statusCode).toBe(401);
    const { rows } = await ownerQuery(
      "SELECT action, after FROM audit_log WHERE entity_type = 'membership' AND entity_id = (SELECT id::text FROM users WHERE email = 'jelzes@example.hu') ORDER BY id",
    );
    expect(rows.map((r) => r.action)).toEqual(["member.add", "member.update", "member.remove"]);
  });

  it("új portál-tulajdonos a keretben: új fiók régi belépés nélkül, cég a portál adataival, összerendelés", async () => {
    const ujCeg = randomUUID();
    // Nem tulajdonos: új fiókot nem kérhet.
    const m = new Client(sso.app);
    const rm = (await m.post("/api/auth/sso", { jegy: await belepesiJegy({ sub: "p-munkatars", email: "munkatars@example.hu", cegId: ujCeg, szerep: "munkatars" }) })).json();
    expect(rm).toMatchObject({ kovetkezo: "osszekapcsolas", ujFiokLehet: false });
    expect((await m.post("/api/auth/sso/uj-fiok", { kapcsolas: rm.kapcsolas })).statusCode).toBe(403);
    // Akinek van régi fiókja, annak össze kell kapcsolnia (nem kaphat újat).
    const ra = (await new Client(sso.app).post("/api/auth/sso", { jegy: await belepesiJegy({ sub: "p-masik-admin", email: "admin@example.hu", cegId: ujCeg }) })).json();
    expect(ra).toMatchObject({ kovetkezo: "osszekapcsolas", ujFiokLehet: false });
    expect((await new Client(sso.app).post("/api/auth/sso/uj-fiok", { kapcsolas: ra.kapcsolas })).statusCode).toBe(409);

    // Aki most vásárolt (portál-tulajdonos, régi fiók nélkül): a fiók magától létrejön, összekapcsolás nélkül.
    const t = new Client(sso.app);
    const r = (await t.post("/api/auth/sso", { jegy: await belepesiJegy({ sub: "p-tulaj", sid: "sid-tulaj", email: "Tulaj@Example.hu", name: "Tulaj Tamás", cegId: ujCeg }) })).json();
    expect(r).toEqual({ kovetkezo: "kesz", companyId: null });
    expect((await t.post("/api/auth/sso/uj-fiok", { kapcsolas: "x".repeat(40) })).statusCode).toBe(401);
    const me = (await t.get("/api/auth/me")).json();
    expect(me).toMatchObject({ user: { email: "tulaj@example.hu", name: "Tulaj Tamás" }, companies: [], ssoPortalCompanyId: ujCeg });

    const c = await createCompany(t, { name: "Tulaj Kft.", shortName: "Tulaj Kft." });
    expect((await t.post("/api/auth/sso/ceg", { companyId: c.id })).statusCode).toBe(200);
    const ujra = new Client(sso.app);
    expect((await ujra.post("/api/auth/sso", { jegy: await belepesiJegy({ sub: "p-tulaj", sid: "sid-tulaj-2", email: "tulaj@example.hu", cegId: ujCeg }) })).json()).toEqual({
      kovetkezo: "kesz",
      companyId: c.id,
    });
    expect((await ujra.get("/api/auth/me")).json().companies).toEqual([expect.objectContaining({ id: c.id, portalCompanyId: ujCeg, role: "ADMIN" })]);
  });

  it("párhuzamos első megnyitás (pl. több böngészőlapon): minden kérés belép, és egyetlen fiók jön létre", async () => {
    const ceg = randomUUID();
    const jegyek = await Promise.all(
      Array.from({ length: 6 }, (_, i) => belepesiJegy({ sub: "p-parhuzamos", sid: `sid-parhuzamos-${i}`, email: "parhuzamos@example.hu", name: "Párhuzamos Petra", cegId: ceg })),
    );
    const valaszok = await Promise.all(jegyek.map((jegy) => new Client(sso.app).post("/api/auth/sso", { jegy })));
    expect(valaszok.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200, 200]);
    for (const r of valaszok) expect(r.json()).toEqual({ kovetkezo: "kesz", companyId: null });
    const { rows } = await appQuery("SELECT count(*)::int AS n FROM users WHERE email = 'parhuzamos@example.hu'");
    expect(rows[0].n).toBe(1);
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

// F26a: könyvelőirodánál minden ügyfél külön portál-cég, és így külön Könyvelő-cég. A portál csak annak ad
// jegyet és tagságot egy ügyfélhez, akit hozzá rendeltek (az irodavezető mindegyikhez); a Könyvelő a jegy és a
// jelzés szerint igazodik. Itt azt igazoljuk, hogy a Könyvelő oldalán sem lát senki olyan ügyfelet, akihez nincs
// tagsága: sem a nem hozzárendelt irodai munkatárs, sem az ügyfél saját embere az iroda többi ügyfelét.
describe("F26a: könyvelőiroda – az ügyfelek elkülönítése a Könyvelőben", () => {
  const iroda = { id: randomUUID(), nev: "Szám Iroda Kft." };
  const ugyfel1 = randomUUID();
  const ugyfel2 = randomUUID();
  let c1: string;
  let c2: string;

  it("az irodavezető mindkét ügyfelet megnyitja; ügyfelenként külön Könyvelő-cég", async () => {
    const v = new Client(sso.app);
    const r = (await v.post("/api/auth/sso", { jegy: await belepesiJegy({ sub: "p-vezeto", sid: "sid-vezeto-1", email: "vezeto@iroda.hu", name: "Vezető Vera", cegId: ugyfel1, iroda }) })).json();
    expect(r).toEqual({ kovetkezo: "kesz", companyId: null });
    c1 = (await createCompany(v, { name: "Első Ügyfél Kft.", shortName: "Első Ügyfél" })).id;
    expect((await v.post("/api/auth/sso/ceg", { companyId: c1 })).statusCode).toBe(200);

    const v2 = new Client(sso.app);
    expect((await v2.post("/api/auth/sso", { jegy: await belepesiJegy({ sub: "p-vezeto", sid: "sid-vezeto-2", email: "vezeto@iroda.hu", cegId: ugyfel2, iroda }) })).json()).toEqual({
      kovetkezo: "kesz",
      companyId: null,
    });
    c2 = (await createCompany(v2, { name: "Második Ügyfél Bt.", shortName: "Második Ügyfél" })).id;
    expect((await v2.post("/api/auth/sso/ceg", { companyId: c2 })).statusCode).toBe(200);
    expect(((await v2.get("/api/auth/me")).json().companies as Array<{ id: string }>).map((c) => c.id).sort()).toEqual([c1, c2].sort());
  });

  it("a csak az első ügyfélhez rendelt munkatárs a másodikat nem látja; a hozzárendelés megszűnésével az elsőt sem", async () => {
    const m = new Client(sso.app);
    const jegy = await belepesiJegy({ sub: "p-mt", sid: "sid-munkatars", email: "munkatars@iroda.hu", name: "Munka Márton", cegId: ugyfel1, szerep: "konyvelo", iroda });
    expect((await m.post("/api/auth/sso", { jegy })).json()).toEqual({ kovetkezo: "kesz", companyId: c1 });
    expect((await m.get("/api/auth/me")).json().companies).toEqual([expect.objectContaining({ id: c1, role: "ACCOUNTANT" })]);
    expect((await m.get(`/api/companies/${c1}/accounts`)).statusCode).toBe(200);
    for (const ut of ["accounts", "documents", "members", "audit-log"]) expect([403, 404]).toContain((await m.get(`/api/companies/${c2}/${ut}`)).statusCode);

    // A portálon kivették a hozzárendelésből: a jelzés után a tagság és a munkamenet is megszűnik.
    const j = await tagsagJelzes("p-mt", "munkatars@iroda.hu", ugyfel1, null);
    expect((await sso.app.inject({ method: "POST", url: "/api/auth/sso/tagsag", payload: { jelzes: j } })).statusCode).toBe(204);
    expect((await m.get("/api/auth/me")).statusCode).toBe(401);
    const { rows } = await ownerQuery("SELECT count(*)::int AS n FROM company_memberships m JOIN users u ON u.id = m.user_id WHERE u.email = 'munkatars@iroda.hu'");
    expect(rows[0].n).toBe(0);
  });

  it("az ügyfél saját embere csak a saját cégét látja, az iroda többi ügyfelét nem", async () => {
    const u = new Client(sso.app);
    const jegy = await belepesiJegy({ sub: "p-ugyfel", sid: "sid-ugyfel", email: "penzugy@masodik.hu", name: "Pénz Ügyes", cegId: ugyfel2, szerep: "munkatars", modulSzerep: "VIEWER", iroda });
    expect((await u.post("/api/auth/sso", { jegy })).json()).toEqual({ kovetkezo: "kesz", companyId: c2 });
    expect((await u.get("/api/auth/me")).json().companies).toEqual([expect.objectContaining({ id: c2, role: "VIEWER" })]);
    for (const ut of ["accounts", "documents", "members", "audit-log"]) expect([403, 404]).toContain((await u.get(`/api/companies/${c1}/${ut}`)).statusCode);
  });
});
