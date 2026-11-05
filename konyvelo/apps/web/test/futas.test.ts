// Futási mód (TERV.md F23 KB2): önállóan minden útvonal és API-cím a régi; a keretben az előtag alá kerül. A
// forrásvizsgálat őrzi, hogy ne maradjon előtag nélküli hivatkozás vagy API-hívás.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { apiCim, keretModBeallitas, keretben, sajatUtvonal, ut } from "../src/keret/futas";

afterEach(() => keretModBeallitas("", "/api"));

describe("futási mód", () => {
  it("önállóan minden a régi", () => {
    expect(keretben()).toBe(false);
    expect(ut("/konyveles/12")).toBe("/konyveles/12");
    expect(ut("/")).toBe("/");
    expect(apiCim("/api/auth/me")).toBe("/api/auth/me");
  });
  it("a keretben az előtag alá", () => {
    keretModBeallitas("/konyvelo", "/api/konyvelo");
    expect(keretben()).toBe(true);
    expect(ut("/konyveles/12?ceg=1")).toBe("/konyvelo/konyveles/12?ceg=1");
    expect(ut("/")).toBe("/konyvelo");
    expect(ut("/?x=1")).toBe("/konyvelo?x=1");
    expect(ut("/konyvelo/zaras")).toBe("/konyvelo/zaras");
    expect(ut("relativ")).toBe("relativ");
    expect(apiCim("/api/companies/1/export")).toBe("/api/konyvelo/companies/1/export");
    expect(sajatUtvonal("/konyvelo/zaras")).toBe("/zaras");
    expect(sajatUtvonal("/konyvelo")).toBe("/");
  });
});

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const fajlok = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const t = path.join(d, n);
    return statSync(t).isDirectory() ? fajlok(t) : /\.(tsx?|ts)$/.test(n) ? [t] : [];
  });

describe("forrásvizsgálat", () => {
  const kod = fajlok(src).filter((f) => !f.includes(`${path.sep}keret${path.sep}`));
  it("a Link, NavLink, Navigate és useNavigate mindenhol az előtagos változat", () => {
    const rossz = kod.filter((f) => /import \{[^}]*\b(Link|NavLink|Navigate|useNavigate)\b[^}]*\} from "react-router"/.test(readFileSync(f, "utf8")));
    expect(rossz.map((f) => path.relative(src, f))).toEqual([]);
  });
  it("nincs előtag nélküli API-hívás (a fetch mindenhol az apiCim-en át)", () => {
    const rossz = kod.filter((f) => /fetch\(\s*[`"']\/api/.test(readFileSync(f, "utf8")));
    expect(rossz.map((f) => path.relative(src, f))).toEqual([]);
  });
  it("nincs nyers, előtag nélküli belső href", () => {
    const rossz = kod.filter((f) => /href=["{`]+\/(?!\/)/.test(readFileSync(f, "utf8")));
    expect(rossz.map((f) => path.relative(src, f))).toEqual([]);
  });
});
