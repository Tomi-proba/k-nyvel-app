// A keretbeli futás (TERV.md F23 KB4–KB5): a stílus szűkítése a Könyvelő dobozára, és a Könyvelő
// gyorsbillentyűi a keret szabályai szerint (tartalék az Alt-os billentyűkhöz, nincs ütközés a keretével).
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { KERET_GYORSBILLENTYUK, tartalekNelkul, utkozesek, feliratok } from "@aweboldal/modulok";
import { KONYVELO_DOBOZ, keretCss, szukitettSelektor } from "../keret-css";
import { KONYVELO_GYORSBILLENTYUK } from "../src/keret/gyorsbillentyuk";

describe("stílus a keretben", () => {
  it("minden szabály a Könyvelő dobozára szűkül; a :root, html, body maga a doboz", () => {
    expect(szukitettSelektor(":root")).toBe(KONYVELO_DOBOZ);
    expect(szukitettSelektor("html")).toBe(KONYVELO_DOBOZ);
    expect(szukitettSelektor("body .x")).toBe(`${KONYVELO_DOBOZ} .x`);
    expect(szukitettSelektor("h1")).toBe(`${KONYVELO_DOBOZ} h1`);
    expect(szukitettSelektor("*::before")).toBe(`${KONYVELO_DOBOZ} *::before`);
    expect(szukitettSelektor(".htmlx")).toBe(`${KONYVELO_DOBOZ} .htmlx`);
  });

  it("a teljes stíluslap: nincs szűkítetlen szabály (a @keyframes lépései kivételével)", async () => {
    const { readFile } = await import("node:fs/promises");
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const out = await postcss([keretCss()]).process(css, { from: undefined });
    const szukitetlen: string[] = [];
    out.root.walkRules((r) => {
      if (r.parent?.type === "atrule" && /keyframes$/i.test((r.parent as { name: string }).name)) return;
      for (const s of r.selectors) if (!s.startsWith(KONYVELO_DOBOZ)) szukitetlen.push(s);
    });
    expect(szukitetlen).toEqual([]);
  });
});

describe("gyorsbillentyűk a keretben", () => {
  it("minden Alt-os billentyűnek van tartaléka, és nincs ütközés a keret billentyűivel", () => {
    expect(tartalekNelkul(KONYVELO_GYORSBILLENTYUK)).toEqual([]);
    expect(utkozesek([...KERET_GYORSBILLENTYUK, ...KONYVELO_GYORSBILLENTYUK])).toEqual([]);
    expect(feliratok(KONYVELO_GYORSBILLENTYUK[0]!)).toBe("Alt+L vagy L");
  });
});
