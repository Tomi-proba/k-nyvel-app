// A Könyvelő stílusa a keretben (TERV.md F23 KB5): minden szabály a Könyvelő dobozára szűkül, így a keretet
// (fejléc, menü, a többi modul) nem írja át. A :root, html és body szabályai magára a dobozra vonatkoznak.
import type { AtRule, Plugin, Rule } from "postcss";

export const KONYVELO_DOBOZ = '[data-modul-keretben="konyvelo"]';

export function szukitettSelektor(s: string, doboz = KONYVELO_DOBOZ): string {
  const t = s.trim();
  const m = /^(:root|html|body)(?![\w-])(.*)$/.exec(t);
  if (m) {
    // ":root" → a doboz; ":root.x" → a doboz.x; "body .y" → a doboz .y
    return `${doboz}${m[2]}`;
  }
  return `${doboz} ${t}`;
}

export function keretCss(doboz = KONYVELO_DOBOZ): Plugin {
  return {
    postcssPlugin: "konyvelo-keret-szukites",
    Rule(rule: Rule) {
      const szulo = rule.parent;
      if (szulo && szulo.type === "atrule" && /keyframes$/i.test((szulo as AtRule).name)) return;
      if ((rule as Rule & { _szukitve?: boolean })._szukitve) return;
      rule.selectors = rule.selectors.map((s) => szukitettSelektor(s, doboz));
      (rule as Rule & { _szukitve?: boolean })._szukitve = true;
    },
  };
}
