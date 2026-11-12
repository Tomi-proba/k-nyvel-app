// Egységes szavak (AWEBOLDAL TERV.md F27 B4): a Könyvelő magáz (Ön), az áfát a helyesírás szerint írja ("áfa";
// a termék neve, az "eÁFA" marad), az üres állapot pedig egy közös összetevő (UresAllapot → fg-ures).
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const GYOKER = path.resolve(import.meta.dirname, "../src");

function fajlok(mappa: string): string[] {
  return readdirSync(mappa).flatMap((n) => {
    const p = path.join(mappa, n);
    if (statSync(p).isDirectory()) return n === "kozos" ? [] : fajlok(p);
    return /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

const sorok = fajlok(GYOKER).flatMap((f) =>
  readFileSync(f, "utf8")
    .split("\n")
    .map((sor, i) => ({ hol: `${path.relative(GYOKER, f)}:${i + 1}`, sor }))
    .filter(({ sor }) => !/^\s*(\/\/|\*|\/\*)/.test(sor)),
);

// A szóhatár a magyar ékezetes betűknél is (a \b csak az angol betűket ismeri).
const TEGEZO =
  /(?<![\p{L}])(Válassz|válassz|Add meg|add meg|Adj meg|Lépj|lépj|Kérj|kérj|Nézd|nézd|Próbáld|próbáld|Írd|írd|Nyisd|nyisd|kattints|Kattints|fiókod|céged|tudsz|tudod|látod|vagy belépve|telefonod|jogosultságod)(?![\p{L}])/u;

describe("egységes szavak a Könyvelőben", () => {
  it("a felület magáz", () => {
    expect(sorok.filter(({ sor }) => TEGEZO.test(sor)).map(({ hol, sor }) => `${hol}: ${sor.trim()}`)).toEqual([]);
  });

  it('az áfa a helyesírás szerint: "ÁFA" csak az eÁFA nevében', () => {
    expect(sorok.filter(({ sor }) => /ÁFA/.test(sor.replace(/eÁFA/g, ""))).map(({ hol, sor }) => `${hol}: ${sor.trim()}`)).toEqual([]);
  });

  it("az üres állapot a közös összetevő, nem halvány bekezdés", () => {
    const sajat = sorok.filter(({ sor }) => /<p className="muted">\s*(Nincs|Még nincs|Még nem)/.test(sor));
    expect(sajat.map(({ hol, sor }) => `${hol}: ${sor.trim()}`)).toEqual([]);
    expect(readFileSync(path.join(GYOKER, "ui/UresAllapot.tsx"), "utf8")).toMatch(/className="fg-ures" data-ures-allapot/);
  });

  it("a választógomb felirata telefonon is a gomb mellett marad (a sor nem törik a gomb alá)", () => {
    const css = readFileSync(path.join(GYOKER, "styles.css"), "utf8");
    expect(css).toMatch(/fieldset\.stack > label\.row:has\(> input\[type="radio"\]\)[\s\S]*?flex-wrap: nowrap/);
  });
});
