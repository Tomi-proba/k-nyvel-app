/**
 * A beszámoló kimutatásainak sorai, a 2000. évi C. törvény (Szt.) szerint
 * (hatályos szöveg: 2026.02.28-tól, njt.hu, lekérdezve 2026.10.20.):
 *
 * - mérleg: 1. számú melléklet, „A” változat;
 * - eredménykimutatás: 2. számú melléklet (összköltség-eljárás).
 *
 * Az egyszerűsített éves beszámoló a nagybetűvel és római számmal jelölt
 * tételeket tartalmazza (Szt. 96. § (2)–(3)) – ezeket a `simplified` jelöli.
 *
 * A sorok fába rendezettek: a szülő értéke a gyerekek összege. Az
 * „Ebből:” sorok (`ofWhich`) a szülőbe beleszámítanak, de külön is látszanak.
 * A számított sorok (`formula`) más sorokból adódnak.
 */

export type ReportLine = {
  code: string;
  label: string;
  parent: string | null;
  simplified: boolean;
  ofWhich?: boolean;
  /** Számított sor: előjeles összeg más sorokból. */
  formula?: Array<{ code: string; sign: 1 | -1 }>;
  /** Mérlegben: eszköz vagy forrás oldal. */
  side?: "ASSET" | "SOURCE";
};

type L = [code: string, label: string, opts?: { ofWhich?: boolean; formula?: string }];

function parentOf(code: string): string | null {
  const i = code.lastIndexOf(".");
  return i === -1 ? null : code.slice(0, i);
}

/** Római szám vagy nagybetű a kód utolsó tagja? (pl. „A.II” igen, „A.II.3” nem) */
function isSimplifiedLevel(code: string): boolean {
  const last = code.split(".").at(-1)!;
  return /^[A-G]$/.test(last) || /^[IVX]+$/.test(last) || /^X\/1$/.test(last);
}

function parseFormula(f: string | undefined): ReportLine["formula"] {
  if (!f) return undefined;
  return f
    .split(/(?=[+-])/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ sign: t.startsWith("-") ? -1 : 1, code: t.replace(/^[+-]/, "") }) as const);
}

// ---------- Mérleg, „A” változat (Szt. 1. számú melléklet) ----------

const BS: L[] = [
  ["A", "Befektetett eszközök"],
  ["A.I", "Immateriális javak"],
  ["A.I.1", "Alapítás-átszervezés aktivált értéke"],
  ["A.I.2", "Kísérleti fejlesztés aktivált értéke"],
  ["A.I.3", "Vagyoni értékű jogok"],
  ["A.I.4", "Szellemi termékek"],
  ["A.I.5", "Üzleti vagy cégérték"],
  ["A.I.6", "Immateriális javakra adott előlegek"],
  ["A.I.7", "Immateriális javak értékhelyesbítése"],
  ["A.II", "Tárgyi eszközök"],
  ["A.II.1", "Ingatlanok és a kapcsolódó vagyoni értékű jogok"],
  ["A.II.2", "Műszaki berendezések, gépek, járművek"],
  ["A.II.3", "Egyéb berendezések, felszerelések, járművek"],
  ["A.II.4", "Tenyészállatok"],
  ["A.II.5", "Beruházások, felújítások"],
  ["A.II.6", "Beruházásokra adott előlegek"],
  ["A.II.7", "Tárgyi eszközök értékhelyesbítése"],
  ["A.III", "Befektetett pénzügyi eszközök"],
  ["A.III.1", "Tartós részesedés kapcsolt vállalkozásban"],
  ["A.III.2", "Tartósan adott kölcsön kapcsolt vállalkozásban"],
  ["A.III.3", "Tartós jelentős tulajdoni részesedés"],
  ["A.III.4", "Tartósan adott kölcsön jelentős tulajdoni részesedési viszonyban álló vállalkozásban"],
  ["A.III.5", "Egyéb tartós részesedés"],
  ["A.III.6", "Tartósan adott kölcsön egyéb részesedési viszonyban álló vállalkozásban"],
  ["A.III.7", "Egyéb tartósan adott kölcsön"],
  ["A.III.8", "Tartós hitelviszonyt megtestesítő értékpapír"],
  ["A.III.9", "Befektetett pénzügyi eszközök értékhelyesbítése"],
  ["A.III.10", "Befektetett pénzügyi eszközök értékelési különbözete"],
  ["A.IV", "Halasztott adókövetelés"],
  ["B", "Forgóeszközök"],
  ["B.I", "Készletek"],
  ["B.I.1", "Anyagok"],
  ["B.I.2", "Befejezetlen termelés és félkész termékek"],
  ["B.I.3", "Növendék-, hízó- és egyéb állatok"],
  ["B.I.4", "Késztermékek"],
  ["B.I.5", "Áruk"],
  ["B.I.6", "Készletekre adott előlegek"],
  ["B.II", "Követelések"],
  ["B.II.1", "Követelések áruszállításból és szolgáltatásból (vevők)"],
  ["B.II.2", "Követelések kapcsolt vállalkozással szemben"],
  ["B.II.3", "Követelések jelentős tulajdoni részesedési viszonyban lévő vállalkozással szemben"],
  ["B.II.4", "Követelések egyéb részesedési viszonyban lévő vállalkozással szemben"],
  ["B.II.5", "Váltókövetelések"],
  ["B.II.6", "Egyéb követelések"],
  ["B.II.7", "Követelések értékelési különbözete"],
  ["B.II.8", "Származékos ügyletek pozitív értékelési különbözete"],
  ["B.III", "Értékpapírok"],
  ["B.III.1", "Részesedés kapcsolt vállalkozásban"],
  ["B.III.2", "Jelentős tulajdoni részesedés"],
  ["B.III.3", "Egyéb részesedés"],
  ["B.III.4", "Saját részvények, saját üzletrészek"],
  ["B.III.5", "Forgatási célú hitelviszonyt megtestesítő értékpapírok"],
  ["B.III.6", "Értékpapírok értékelési különbözete"],
  ["B.IV", "Pénzeszközök"],
  ["B.IV.1", "Pénztár, csekkek"],
  ["B.IV.2", "Bankbetétek"],
  ["C", "Aktív időbeli elhatárolások"],
  ["C.1", "Bevételek aktív időbeli elhatárolása"],
  ["C.2", "Költségek, ráfordítások aktív időbeli elhatárolása"],
  ["C.3", "Halasztott ráfordítások"],
  ["D", "Saját tőke"],
  ["D.I", "Jegyzett tőke"],
  ["D.I.E", "Ebből: visszavásárolt tulajdoni részesedés névértéken", { ofWhich: true }],
  ["D.II", "Jegyzett, de még be nem fizetett tőke (-)"],
  ["D.III", "Tőketartalék"],
  ["D.IV", "Eredménytartalék"],
  ["D.V", "Lekötött tartalék"],
  ["D.VI", "Értékelési tartalék"],
  ["D.VI.1", "Értékhelyesbítés értékelési tartaléka"],
  ["D.VI.2", "Valós értékelés értékelési tartaléka"],
  ["D.VII", "Adózott eredmény"],
  ["E", "Céltartalékok"],
  ["E.1", "Céltartalék a várható kötelezettségekre"],
  ["E.2", "Céltartalék a jövőbeni költségekre"],
  ["E.3", "Egyéb céltartalék"],
  ["F", "Kötelezettségek"],
  ["F.I", "Hátrasorolt kötelezettségek"],
  ["F.I.1", "Hátrasorolt kötelezettségek kapcsolt vállalkozással szemben"],
  ["F.I.2", "Hátrasorolt kötelezettségek jelentős tulajdoni részesedési viszonyban lévő vállalkozással szemben"],
  ["F.I.3", "Hátrasorolt kötelezettségek egyéb részesedési viszonyban lévő vállalkozással szemben"],
  ["F.I.4", "Hátrasorolt kötelezettségek egyéb gazdálkodóval szemben"],
  ["F.II", "Hosszú lejáratú kötelezettségek"],
  ["F.II.1", "Hosszú lejáratra kapott kölcsönök"],
  ["F.II.2", "Átváltoztatható és átváltozó kötvények"],
  ["F.II.3", "Tartozások kötvénykibocsátásból"],
  ["F.II.4", "Beruházási és fejlesztési hitelek"],
  ["F.II.5", "Egyéb hosszú lejáratú hitelek"],
  ["F.II.6", "Tartós kötelezettségek kapcsolt vállalkozással szemben"],
  ["F.II.7", "Tartós kötelezettségek jelentős tulajdoni részesedési viszonyban lévő vállalkozásokkal szemben"],
  ["F.II.8", "Tartós kötelezettségek egyéb részesedési viszonyban lévő vállalkozással szemben"],
  ["F.II.9", "Egyéb hosszú lejáratú kötelezettségek"],
  ["F.II.10", "Halasztott adókötelezettség"],
  ["F.III", "Rövid lejáratú kötelezettségek"],
  ["F.III.1", "Rövid lejáratú kölcsönök"],
  ["F.III.1.E", "Ebből: az átváltoztatható és átváltozó kötvények", { ofWhich: true }],
  ["F.III.2", "Rövid lejáratú hitelek"],
  ["F.III.3", "Vevőktől kapott előlegek"],
  ["F.III.4", "Kötelezettségek áruszállításból és szolgáltatásból (szállítók)"],
  ["F.III.5", "Váltótartozások"],
  ["F.III.6", "Rövid lejáratú kötelezettségek kapcsolt vállalkozással szemben"],
  ["F.III.7", "Rövid lejáratú kötelezettségek jelentős tulajdoni részesedési viszonyban lévő vállalkozásokkal szemben"],
  ["F.III.8", "Rövid lejáratú kötelezettségek egyéb részesedési viszonyban lévő vállalkozással szemben"],
  ["F.III.9", "Egyéb rövid lejáratú kötelezettségek"],
  ["F.III.10", "Kötelezettségek értékelési különbözete"],
  ["F.III.11", "Származékos ügyletek negatív értékelési különbözete"],
  ["G", "Passzív időbeli elhatárolások"],
  ["G.1", "Bevételek passzív időbeli elhatárolása"],
  ["G.2", "Költségek, ráfordítások passzív időbeli elhatárolása"],
  ["G.3", "Halasztott bevételek"],
];

export const BALANCE_SHEET_TOTALS = {
  ASSETS: { code: "ESZK", label: "Eszközök összesen", formula: [{ code: "A", sign: 1 }, { code: "B", sign: 1 }, { code: "C", sign: 1 }] },
  SOURCES: { code: "FORR", label: "Források összesen", formula: ["D", "E", "F", "G"].map((code) => ({ code, sign: 1 as const })) },
} as const;

export const BALANCE_SHEET_LINES: readonly ReportLine[] = BS.map(([code, label, opts]) => ({
  code,
  label,
  parent: parentOf(code),
  simplified: !opts?.ofWhich && isSimplifiedLevel(code),
  ...(opts?.ofWhich ? { ofWhich: true } : {}),
  side: "ABC".includes(code[0]!) ? "ASSET" : "SOURCE",
}));

// ---------- Eredménykimutatás, összköltség-eljárás (Szt. 2. számú melléklet) ----------

const IS: L[] = [
  ["I", "Értékesítés nettó árbevétele"],
  ["I.01", "Belföldi értékesítés nettó árbevétele"],
  ["I.02", "Exportértékesítés nettó árbevétele"],
  ["II", "Aktivált saját teljesítmények értéke"],
  ["II.03", "Saját termelésű készletek állományváltozása"],
  ["II.04", "Saját előállítású eszközök aktivált értéke"],
  ["III", "Egyéb bevételek"],
  ["III.E", "Ebből: visszaírt értékvesztés", { ofWhich: true }],
  ["IV", "Anyagjellegű ráfordítások"],
  ["IV.05", "Anyagköltség"],
  ["IV.06", "Igénybe vett szolgáltatások értéke"],
  ["IV.07", "Egyéb szolgáltatások értéke"],
  ["IV.08", "Eladott áruk beszerzési értéke"],
  ["IV.09", "Eladott (közvetített) szolgáltatások értéke"],
  ["V", "Személyi jellegű ráfordítások"],
  ["V.10", "Bérköltség"],
  ["V.11", "Személyi jellegű egyéb kifizetések"],
  ["V.12", "Bérjárulékok"],
  ["VI", "Értékcsökkenési leírás"],
  ["VII", "Egyéb ráfordítások"],
  ["VII.E", "Ebből: értékvesztés", { ofWhich: true }],
  ["A", "Üzemi (üzleti) tevékenység eredménye", { formula: "+I+II+III-IV-V-VI-VII" }],
  ["VIII", "Pénzügyi műveletek bevételei"],
  ["VIII.13", "Kapott (járó) osztalék és részesedés"],
  ["VIII.13.E", "Ebből: kapcsolt vállalkozástól kapott", { ofWhich: true }],
  ["VIII.14", "Részesedésekből származó bevételek, árfolyamnyereségek"],
  ["VIII.14.E", "Ebből: kapcsolt vállalkozástól kapott", { ofWhich: true }],
  ["VIII.15", "Befektetett pénzügyi eszközökből (értékpapírokból, kölcsönökből) származó bevételek, árfolyamnyereségek"],
  ["VIII.15.E", "Ebből: kapcsolt vállalkozástól kapott", { ofWhich: true }],
  ["VIII.16", "Egyéb kapott (járó) kamatok és kamatjellegű bevételek"],
  ["VIII.16.E", "Ebből: kapcsolt vállalkozástól kapott", { ofWhich: true }],
  ["VIII.17", "Pénzügyi műveletek egyéb bevételei"],
  ["VIII.17.E", "Ebből: értékelési különbözet", { ofWhich: true }],
  ["IX", "Pénzügyi műveletek ráfordításai"],
  ["IX.18", "Részesedésekből származó ráfordítások, árfolyamveszteségek"],
  ["IX.18.E", "Ebből: kapcsolt vállalkozásnak adott", { ofWhich: true }],
  ["IX.19", "Befektetett pénzügyi eszközökből (értékpapírokból, kölcsönökből) származó ráfordítások, árfolyamveszteségek"],
  ["IX.19.E", "Ebből: kapcsolt vállalkozásnak adott", { ofWhich: true }],
  ["IX.20", "Fizetendő (fizetett) kamatok és kamatjellegű ráfordítások"],
  ["IX.20.E", "Ebből: kapcsolt vállalkozásnak adott", { ofWhich: true }],
  ["IX.21", "Részesedések, értékpapírok, tartósan adott kölcsönök, bankbetétek értékvesztése"],
  ["IX.22", "Pénzügyi műveletek egyéb ráfordításai"],
  ["IX.22.E", "Ebből: értékelési különbözet", { ofWhich: true }],
  ["B", "Pénzügyi műveletek eredménye", { formula: "+VIII-IX" }],
  ["C", "Adózás előtti eredmény", { formula: "+A+B" }],
  ["X", "Adófizetési kötelezettség"],
  ["X/1", "Halasztott adókülönbözet (±)"],
  ["D", "Adózott eredmény", { formula: "+C-X+X/1" }],
];

/**
 * Az eredménykimutatás sorainak előjele: a bevétel jellegű sorok értéke
 * követel − tartozik forgalom, a ráfordítás jellegűeké tartozik − követel.
 */
export const INCOME_STATEMENT_REVENUE_LINES = new Set(["I", "II", "III", "VIII", "X/1"]);

export const INCOME_STATEMENT_LINES: readonly ReportLine[] = IS.map(([code, label, opts]) => {
  const top = code.split(".")[0]!;
  return {
    code,
    label,
    parent: code.includes(".") ? parentOf(code) : null,
    simplified: !opts?.ofWhich && (code === top),
    ...(opts?.ofWhich ? { ofWhich: true } : {}),
    ...(opts?.formula ? { formula: parseFormula(opts.formula) } : {}),
  };
});

const BS_CODES = new Set(BALANCE_SHEET_LINES.map((l) => l.code));
const IS_CODES = new Set(INCOME_STATEMENT_LINES.filter((l) => !l.formula).map((l) => l.code));

/** Hozzárendelhető mérlegsor? (számított összesítő sor nem) */
export function isBalanceSheetLine(code: string): boolean {
  return BS_CODES.has(code);
}

/** Hozzárendelhető eredménykimutatás-sor? (az A–D számított sorok nem) */
export function isIncomeStatementLine(code: string): boolean {
  return IS_CODES.has(code);
}

export function balanceSheetLineLabel(code: string | null | undefined): string {
  if (!code) return "";
  const line = BALANCE_SHEET_LINES.find((l) => l.code === code);
  return line ? `${code} ${line.label}` : code;
}

export function incomeStatementLineLabel(code: string | null | undefined): string {
  if (!code) return "";
  const line = INCOME_STATEMENT_LINES.find((l) => l.code === code);
  return line ? `${code} ${line.label}` : code;
}

/** Az egyszerűsített éves beszámolóban megjelenő sor, amelybe a részletes sor összesítődik. */
export function simplifiedAncestor(code: string, lines: readonly ReportLine[]): string | null {
  let current: string | null = code;
  while (current) {
    const line = lines.find((l) => l.code === current);
    if (!line) return null;
    if (line.simplified) return line.code;
    current = line.parent;
  }
  return null;
}
