// A portál kérése (AWEBOLDAL TERV.md F27 K): a programok automatikus összekapcsolása kód másolása nélkül. A portál
// aláírt kérésére a Könyvelő a portál cégéhez rendelt cégére kapcsolódási kódot ad a központhoz, és az eÁFA kódjával
// összekapcsolja a NAV-hozzáférést. Idegen, lejárt, más modulnak szóló vagy ismételt kérés nem jó.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey, type JWK } from "jose";
import { keresCimzett } from "@konyvelo/esemenyek";
import { appQuery, createCompany, createTestApp, resetDatabase, setupAdmin, type TestContext } from "./helpers";
import { FakeGateway } from "./fake-gateway";

const KIADO = "http://portal.teszt";
const gateway = new FakeGateway();
let ctx: TestContext;
let kulcs: CryptoKey;
let jwk: JWK;

async function keres(feladat: string, cegId: string, extra: Record<string, unknown> = {}, opts: { aud?: string; kulcs?: CryptoKey } = {}) {
  return new SignJWT({ esemeny: "kapcsolat", feladat, ceg: { id: cegId, nev: "Minta Kft.", adoszam: "x" }, ...extra })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setIssuer(KIADO)
    .setSubject("portal")
    .setAudience(opts.aud ?? keresCimzett("konyvelo"))
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(opts.kulcs ?? kulcs);
}
const kuld = (j: string) => ctx.app.inject({ method: "POST", url: "/api/auth/sso/keres", payload: { keres: j } });

beforeAll(async () => {
  await resetDatabase();
  await gateway.start();
  const p = await generateKeyPair("ES256", { extractable: true });
  kulcs = p.privateKey;
  jwk = { ...(await exportJWK(p.publicKey)), kid: "k1", alg: "ES256", use: "sig" };
  ctx = await createTestApp({
    sso: { kiado: KIADO, portalUrl: KIADO, jwksUrl: `${KIADO}/.well-known/jwks.json`, keys: createLocalJWKSet({ keys: [jwk] }) },
    hub: { url: "http://127.0.0.1:9", secret: "kozpont-titok-legalabb-32-karakter-hosszu" },
    eafaGateway: { url: gateway.url, secret: gateway.secret },
  });
});
afterAll(async () => {
  await ctx?.close();
  await gateway.stop();
});

describe("a portál kérése: automatikus összekapcsolás (F27 K)", () => {
  const portalCeg = randomUUID();
  let companyId: string;
  let taxNumber: string;

  it("amíg a cég nincs meg a Könyvelőben: 409 NINCS_CEG (a portál később újra próbálja)", async () => {
    const r = await kuld(await keres("kozpont-kod", portalCeg));
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NINCS_CEG");
  });

  it("kapcsolódási kód a központhoz a portál cégéhez rendelt cégre, a cég létrehozója nevében", async () => {
    const admin = await setupAdmin(ctx.app);
    const c = await createCompany(admin);
    companyId = c.id;
    taxNumber = c.taxNumber;
    await appQuery("UPDATE companies SET portal_company_id = $2 WHERE id = $1", [companyId, portalCeg]);
    const r = await kuld(await keres("kozpont-kod", portalCeg));
    expect(r.statusCode).toBe(200);
    expect(r.json().kod).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const { rows } = await appQuery("SELECT count(*)::int AS n FROM integration_link_codes WHERE company_id = $1 AND used_at IS NULL AND revoked_at IS NULL", [companyId]);
    expect(rows[0].n).toBe(1);
  });

  it("NAV-hozzáférés: állapot, majd összekapcsolás az eÁFA kódjával; rossz kód nem kapcsol", async () => {
    expect((await kuld(await keres("nav-kapcsolas", portalCeg))).json()).toEqual({ kapcsolva: false });
    expect((await kuld(await keres("nav-kapcsolas", portalCeg, { kod: "ROSS-ZKOD-ROSS-ZKOD" }))).statusCode).toBe(422);
    gateway.codes.set("ABCDEFGHJKMNPQRS", taxNumber.replace(/-/g, "").slice(0, 8));
    expect((await kuld(await keres("nav-kapcsolas", portalCeg, { kod: "ABCD-EFGH-JKMN-PQRS" }))).json()).toEqual({ kapcsolva: true });
    // Már kapcsolva: újabb kód nélkül is igaz, és nem kapcsol újra.
    expect((await kuld(await keres("nav-kapcsolas", portalCeg))).json()).toEqual({ kapcsolva: true });
  });

  it("más modulnak szóló, idegen kulccsal aláírt vagy ismételt kérés nem jó", async () => {
    expect((await kuld(await keres("kozpont-kod", portalCeg, {}, { aud: keresCimzett("afa") }))).statusCode).toBe(401);
    const masik = await generateKeyPair("ES256");
    expect((await kuld(await keres("kozpont-kod", portalCeg, {}, { kulcs: masik.privateKey }))).statusCode).toBe(401);
    const j = await keres("kozpont-kod", portalCeg);
    expect((await kuld(j)).statusCode).toBe(200);
    expect((await kuld(j)).statusCode).toBe(401);
  });

  it("telepítési beállítás nélkül (nincs NAV-átjáró): 409 NINCS_ATJARO – a portál „vár” állapotban mutatja", async () => {
    const nelkul = await createTestApp({ sso: { kiado: KIADO, portalUrl: KIADO, jwksUrl: `${KIADO}/.well-known/jwks.json`, keys: createLocalJWKSet({ keys: [jwk] }) } });
    try {
      const r = await nelkul.app.inject({ method: "POST", url: "/api/auth/sso/keres", payload: { keres: await keres("nav-kapcsolas", portalCeg) } });
      expect(r.statusCode).toBe(409);
      expect(r.json().code).toBe("NINCS_ATJARO");
    } finally {
      await nelkul.close();
    }
  });
});
