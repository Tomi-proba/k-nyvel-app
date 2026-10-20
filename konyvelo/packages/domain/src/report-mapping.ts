/**
 * Az alapértelmezett számlatükör számláinak hozzárendelése a mérleg
 * („A” változat) és az összköltséges eredménykimutatás soraihoz
 * (Szt. 1. és 2. számú melléklet).
 *
 * A mérlegsor függhet az egyenleg oldalától: pl. a bankszámla követel
 * egyenlege (folyószámlahitel) rövid lejáratú hitel, az adószámlák tartozik
 * egyenlege követelés. Ezért tartozik és követel egyenleghez külön sor
 * rendelhető. A leghosszabb illeszkedő számlaszám-előtag szabálya érvényes.
 *
 * Az értékcsökkenést és értékvesztést gyűjtő ellenszámlák a csoport római
 * számos sorába kerülnek (pl. 119 → A.I), mert a mintában nem
 * eszközcsoportonként vannak bontva; az egyszerűsített éves beszámoló
 * (Szt. 96. §) ezen a szinten jelenít meg adatot.
 */

export type ReportMapping = {
  /** Mérlegsor tartozik egyenlegnél. */
  bsDebit: string | null;
  /** Mérlegsor követel egyenlegnél. */
  bsCredit: string | null;
  /** Eredménykimutatás-sor (összköltség-eljárás). */
  isLine: string | null;
};

type Rule = [prefix: string, bsDebit: string | null, bsCredit?: string | null, isLine?: string | null];

const both = (line: string): [string, string] => [line, line];

const RULES: Rule[] = [
  // 1. Befektetett eszközök
  ["111", ...both("A.I.1")], ["112", ...both("A.I.2")], ["113", ...both("A.I.3")], ["114", ...both("A.I.4")],
  ["115", ...both("A.I.5")], ["116", ...both("A.I.6")], ["117", ...both("A.I.7")], ["118", ...both("A.I")], ["119", ...both("A.I")],
  ["12", ...both("A.II.1")], ["127", ...both("A.II.7")], ["128", ...both("A.II")], ["129", ...both("A.II")],
  ["13", ...both("A.II.2")], ["137", ...both("A.II.7")], ["138", ...both("A.II")], ["139", ...both("A.II")],
  ["14", ...both("A.II.3")], ["147", ...both("A.II.7")], ["148", ...both("A.II")], ["149", ...both("A.II")],
  ["15", ...both("A.II.4")],
  ["161", ...both("A.II.5")], ["162", ...both("A.II.5")], ["165", ...both("A.II.6")], ["168", ...both("A.II")],
  ["171", ...both("A.III.1")], ["172", ...both("A.III.3")], ["173", ...both("A.III.5")], ["179", ...both("A.III")],
  ["181", ...both("A.III.8")], ["189", ...both("A.III")],
  ["191", ...both("A.III.2")], ["192", ...both("A.III.4")], ["193", ...both("A.III.6")], ["194", ...both("A.III.7")],
  ["195", ...both("A.III.7")], ["199", ...both("A.III")],
  // 2. Készletek
  ["21", ...both("B.I.1")], ["23", ...both("B.I.2")], ["24", ...both("B.I.3")], ["25", ...both("B.I.4")],
  ["26", ...both("B.I.5")], ["28", ...both("B.I.6")],
  // 3. Követelések, pénzügyi eszközök, aktív időbeli elhatárolások
  ["31", "B.II.1", "F.III.9"], ["32", "B.II.2", "F.III.6"], ["331", "B.II.3", "F.III.7"], ["332", "B.II.4", "F.III.8"],
  ["34", ...both("B.II.5")], ["36", "B.II.6", "F.III.9"],
  ["371", ...both("B.III.1")], ["372", ...both("B.III.3")], ["373", ...both("B.III.4")], ["374", ...both("B.III.5")], ["379", ...both("B.III")],
  ["381", ...both("B.IV.1")], ["382", ...both("B.IV.1")], ["383", ...both("B.IV.1")], ["387", ...both("B.IV.1")],
  ["384", "B.IV.2", "F.III.2"], ["385", "B.IV.2", "F.III.2"], ["386", "B.IV.2", "F.III.2"], ["389", ...both("B.IV")],
  ["391", ...both("C.1")], ["392", ...both("C.2")], ["393", ...both("C.3")],
  // 4. Saját tőke, céltartalékok, kötelezettségek, passzív időbeli elhatárolások
  ["411", ...both("D.I")], ["412", ...both("D.III")], ["413", ...both("D.IV")], ["414", ...both("D.V")],
  ["415", ...both("D.II")], ["417", ...both("D.VI")], ["419", ...both("D.VII")],
  ["421", ...both("E.1")], ["422", ...both("E.2")], ["429", ...both("E.3")],
  ["431", ...both("F.I.4")],
  ["441", ...both("F.II.1")], ["442", ...both("F.II.2")], ["443", ...both("F.II.3")], ["444", ...both("F.II.4")],
  ["445", ...both("F.II.5")], ["446", ...both("F.II.6")], ["447", ...both("F.II.8")], ["449", ...both("F.II.9")],
  ["451", "B.II.6", "F.III.1"], ["452", "B.II.6", "F.III.2"], ["453", "B.II.6", "F.III.3"],
  ["454", "B.II.6", "F.III.4"], ["455", "B.II.6", "F.III.4"], ["456", "B.II.6", "F.III.5"],
  ["457", "B.II.2", "F.III.6"], ["458", "B.II.4", "F.III.8"], ["459", "B.II.6", "F.III.9"],
  ["46", "B.II.6", "F.III.9"], ["47", "B.II.6", "F.III.9"],
  ["481", ...both("G.1")], ["482", ...both("G.2")], ["483", ...both("G.3")],
  // 5. Költségnemek (összköltség-eljárás)
  ["51", null, null, "IV.05"], ["52", null, null, "IV.06"], ["53", null, null, "IV.07"],
  ["54", null, null, "V.10"], ["55", null, null, "V.11"], ["56", null, null, "V.12"], ["57", null, null, "VI"],
  ["581", null, null, "II.03"], ["582", null, null, "II.04"],
  // 8. Ráfordítások
  ["814", null, null, "IV.08"], ["815", null, null, "IV.09"],
  ["86", null, null, "VII"], ["866", null, null, "VII.E"],
  ["871", null, null, "IX.18"], ["872", null, null, "IX.19"], ["873", null, null, "IX.20"], ["874", null, null, "IX.21"], ["875", null, null, "IX.22"],
  ["89", null, null, "X"],
  // 9. Árbevétel és bevételek
  ["91", null, null, "I.01"], ["92", null, null, "I.02"],
  ["96", null, null, "III"], ["966", null, null, "III.E"],
  ["971", null, null, "VIII.13"], ["972", null, null, "VIII.14"], ["973", null, null, "VIII.15"], ["974", null, null, "VIII.16"], ["975", null, null, "VIII.17"],
];

/** A mintaszámlatükör szerinti hozzárendelés egy számlaszámhoz (leghosszabb előtag). */
export function defaultReportMapping(number: string): ReportMapping {
  let best: Rule | null = null;
  for (const r of RULES) {
    if (number.startsWith(r[0]) && (best === null || r[0].length > best[0].length)) best = r;
  }
  if (!best) return { bsDebit: null, bsCredit: null, isLine: null };
  return { bsDebit: best[1] ?? null, bsCredit: best[2] ?? null, isLine: best[3] ?? null };
}

/** Melyik kimutatásba kerülhet a számla (Szt. 160. § (2)–(5)). */
export function reportKind(number: string): "BS" | "IS" | "NONE" {
  if (!/^\d/.test(number) || number.startsWith("49")) return "NONE";
  const c = number[0]!;
  if ("1234".includes(c)) return "BS";
  if ("589".includes(c)) return "IS";
  return "NONE";
}

/** Hiányzik-e a kimutatássor egy könyvelhető, aktív számlánál? */
export function missingMapping(a: {
  number: string;
  isActive: boolean;
  hasChildren: boolean;
  bsLineDebit: string | null;
  bsLineCredit: string | null;
  isLine: string | null;
}): boolean {
  if (!a.isActive || a.hasChildren) return false;
  const kind = reportKind(a.number);
  if (kind === "BS") return !a.bsLineDebit || !a.bsLineCredit;
  if (kind === "IS") return !a.isLine && !a.number.startsWith("59");
  return false;
}
