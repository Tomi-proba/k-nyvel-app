// Kétlépcsős azonosítás (TOTP, RFC 6238), a TOTP-titok titkosítása (AES-256-GCM) és a visszaállító kódok – csak a
// Node beépített kriptográfiájával. Ugyanaz az eljárás, mint a portálon (AWEBOLDAL apps/portal/src/biztonsag.ts).
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// --- Titkosítás (AES-256-GCM) a TOTP-titokhoz ---------------------------------------------------
export function titkosit(nyilt: string, kulcs: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", kulcs, iv);
  const adat = Buffer.concat([c.update(nyilt, "utf8"), c.final()]);
  return `v1.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${adat.toString("base64")}`;
}

export function visszafejt(titkos: string, kulcs: Buffer): string {
  const [v, iv, tag, adat] = titkos.split(".");
  if (v !== "v1" || !iv || !tag || !adat) throw new Error("ismeretlen titkosítási formátum");
  const d = createDecipheriv("aes-256-gcm", kulcs, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(adat, "base64")), d.final()]).toString("utf8");
}

// --- TOTP (RFC 6238: 30 mp, 6 jegy, SHA-1, ±1 lépés tűrés) --------------------------------------
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(adat: Buffer): string {
  let bitek = 0;
  let ertek = 0;
  let ki = "";
  for (const b of adat) {
    ertek = (ertek << 8) | b;
    bitek += 8;
    while (bitek >= 5) {
      ki += BASE32[(ertek >>> (bitek - 5)) & 31];
      bitek -= 5;
    }
  }
  if (bitek > 0) ki += BASE32[(ertek << (5 - bitek)) & 31];
  return ki;
}

export function base32Visszafejt(szoveg: string): Buffer {
  const tiszta = szoveg.replace(/=+$/, "").toUpperCase();
  let bitek = 0;
  let ertek = 0;
  const ki: number[] = [];
  for (const k of tiszta) {
    const i = BASE32.indexOf(k);
    if (i < 0) throw new Error("érvénytelen base32");
    ertek = (ertek << 5) | i;
    bitek += 5;
    if (bitek >= 8) {
      ki.push((ertek >>> (bitek - 8)) & 255);
      bitek -= 8;
    }
  }
  return Buffer.from(ki);
}

export function ujTotpTitok(): string {
  return base32(randomBytes(20));
}

export function totpKod(titok: string, lepes: number): string {
  const szamlalo = Buffer.alloc(8);
  szamlalo.writeBigUInt64BE(BigInt(lepes));
  const h = createHmac("sha1", base32Visszafejt(titok)).update(szamlalo).digest();
  const o = h[h.length - 1]! & 0xf;
  const szam = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(szam % 1_000_000).padStart(6, "0");
}

export const totpLepes = (most: number = Date.now()) => Math.floor(most / 1000 / 30);

/** Az elfogadott lépés (±1 tűréssel), ha a kód jó és újabb, mint a legutóbb elfogadott; különben null. */
export function totpEllenoriz(titok: string, kod: string, utolsoLepes: number | null, most: number = Date.now()): number | null {
  if (!/^\d{6}$/.test(kod)) return null;
  const l = totpLepes(most);
  for (const lepes of [l - 1, l, l + 1]) {
    if (utolsoLepes !== null && lepes <= utolsoLepes) continue;
    const vart = Buffer.from(totpKod(titok, lepes));
    if (timingSafeEqual(vart, Buffer.from(kod))) return lepes;
  }
  return null;
}

export function otpauthUrl(titok: string, email: string): string {
  const kiado = "Könyvelő";
  return `otpauth://totp/${encodeURIComponent(`${kiado}:${email}`)}?secret=${titok}&issuer=${encodeURIComponent(kiado)}&algorithm=SHA1&digits=6&period=30`;
}

// --- Véletlen tokenek és visszaállító kódok -----------------------------------------------------
export const veletlenToken = () => randomBytes(32).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** 10 egyszer használható visszaállító kód, „xxxx-xxxx” alakban (kis betű és szám, összetéveszthető jelek nélkül). */
export function visszaallitoKodok(db = 10): string[] {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: db }, () => {
    const b = randomBytes(8);
    const s = [...b].map((x) => abc[x % abc.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

export const kodNormalizal = (kod: string) => kod.trim().toLowerCase().replace(/\s/g, "");
