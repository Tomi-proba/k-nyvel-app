/**
 * Számlatükör-logika: számlaszámok, számlaosztályok, hierarchia, keresés.
 *
 * A számlák hierarchiája a számlaszám előtagjából adódik: a 3811 számla
 * szülője a leghosszabb olyan meglévő számla, amelynek száma a 3811 előtagja
 * (pl. 381). Könyvelni csak olyan számlára lehet, amelynek nincs alszámlája
 * (gyűjtőszámlára nem).
 */

export type AccountNature = "ASSET" | "EQUITY_LIABILITY" | "EXPENSE" | "REVENUE" | "OFF_BALANCE" | "CLOSING";
export type NormalSide = "D" | "C";
export type Subledger = "NONE" | "CUSTOMER" | "SUPPLIER" | "BANK" | "CASH";

export const ACCOUNT_NATURES: readonly AccountNature[] = ["ASSET", "EQUITY_LIABILITY", "EXPENSE", "REVENUE", "OFF_BALANCE", "CLOSING"];
export const SUBLEDGERS: readonly Subledger[] = ["NONE", "CUSTOMER", "SUPPLIER", "BANK", "CASH"];

export const ACCOUNT_NATURE_LABELS: Record<AccountNature, string> = {
  ASSET: "Eszköz",
  EQUITY_LIABILITY: "Forrás (saját tőke, kötelezettség)",
  EXPENSE: "Költség, ráfordítás",
  REVENUE: "Árbevétel, bevétel",
  OFF_BALANCE: "Nyilvántartási (mérlegen kívüli)",
  CLOSING: "Évnyitó, évzáró (technikai)",
};

export const SUBLEDGER_LABELS: Record<Subledger, string> = {
  NONE: "Nincs",
  CUSTOMER: "Vevőanalitika",
  SUPPLIER: "Szállítóanalitika",
  BANK: "Bankszámla",
  CASH: "Pénztár",
};

export const NORMAL_SIDE_LABELS: Record<NormalSide, string> = { D: "Tartozik", C: "Követel" };

/** Az egységes számlakeret számlaosztályai. */
export const ACCOUNT_CLASSES: Record<number, string> = {
  0: "Nyilvántartási számlák",
  1: "Befektetett eszközök",
  2: "Készletek",
  3: "Követelések, pénzügyi eszközök és aktív időbeli elhatárolások",
  4: "Saját tőke, céltartalékok, kötelezettségek és passzív időbeli elhatárolások",
  5: "Költségnemek",
  6: "Költséghelyek, általános költségek",
  7: "Tevékenységek költségei",
  8: "Értékesítés elszámolt önköltsége és ráfordítások",
  9: "Értékesítés árbevétele és bevételek",
};

export function accountClass(number: string): number {
  return Number(number[0]);
}

/** Számlaosztály szerinti alapértelmezett jelleg és szokásos egyenlegoldal. */
export function defaultsForClass(cls: number): { nature: AccountNature; normalSide: NormalSide } {
  switch (cls) {
    case 0:
      return { nature: "OFF_BALANCE", normalSide: "D" };
    case 1:
    case 2:
    case 3:
      return { nature: "ASSET", normalSide: "D" };
    case 4:
      return { nature: "EQUITY_LIABILITY", normalSide: "C" };
    case 9:
      return { nature: "REVENUE", normalSide: "C" };
    default:
      return { nature: "EXPENSE", normalSide: "D" };
  }
}

export function validateAccountNumber(number: string): string | null {
  if (!/^\d{1,8}$/.test(number)) return "A számlaszám 1–8 számjegyből állhat (pl. 384 vagy 38411).";
  return null;
}

/** A számla szülője: a leghosszabb meglévő számla, amelynek száma előtagja. */
export function findParentNumber(number: string, existing: Iterable<string>): string | null {
  let best: string | null = null;
  for (const n of existing) {
    if (n !== number && number.startsWith(n) && (best === null || n.length > best.length)) best = n;
  }
  return best;
}

export type AccountLike = { number: string };

/** Könyvelhető-e: nincs alszámlája. */
export function childNumbersOf(number: string, all: readonly AccountLike[]): string[] {
  return all.filter((a) => a.number !== number && a.number.startsWith(number)).map((a) => a.number);
}

export type TreeInfo = { level: number; hasChildren: boolean; parentNumber: string | null };

/** Hierarchiaszint és alszámla-információ minden számlához (számlaszám szerint rendezve). */
export function buildAccountTree<T extends AccountLike>(accounts: readonly T[]): Array<T & TreeInfo> {
  const sorted = [...accounts].sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0));
  const numbers = sorted.map((a) => a.number);
  const levelOf = new Map<string, number>();
  return sorted.map((a, i) => {
    const parentNumber = findParentNumber(a.number, numbers);
    const level = parentNumber === null ? 0 : (levelOf.get(parentNumber) ?? 0) + 1;
    levelOf.set(a.number, level);
    const next = sorted[i + 1];
    const hasChildren = next !== undefined && next.number.startsWith(a.number);
    return { ...a, level, hasChildren, parentNumber };
  });
}

/** Kereséshez: kisbetű, ékezetek nélkül (pl. „Szállítók” → „szallitok”). */
export function normalizeForSearch(s: string): string {
  return s
    .toLocaleLowerCase("hu")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Számlakeresés számra és névre. Ha a keresett szöveg számjegyekkel
 * kezdődik, számlaszám-előtagra keres (a „38” a 38-cal kezdődőket adja);
 * egyébként a névben keres (ékezet- és kisbetű-érzéketlenül), a szó elején
 * kezdődő egyezések előre kerülnek.
 */
export function searchAccounts<T extends { number: string; name: string }>(accounts: readonly T[], query: string, limit = 50): T[] {
  const q = query.trim();
  const byNumber = (a: T, b: T) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0);
  if (q === "") return [...accounts].sort(byNumber).slice(0, limit);

  const digits = /^\d+/.exec(q)?.[0];
  if (digits) {
    const rest = normalizeForSearch(q.slice(digits.length).trim());
    return accounts
      .filter((a) => a.number.startsWith(digits) && (rest === "" || normalizeForSearch(a.name).includes(rest)))
      .sort((a, b) => a.number.length - b.number.length || byNumber(a, b))
      .slice(0, limit);
  }

  const nq = normalizeForSearch(q);
  const scored: Array<{ a: T; score: number }> = [];
  for (const a of accounts) {
    const name = normalizeForSearch(a.name);
    const idx = name.indexOf(nq);
    if (idx === -1) continue;
    const wordStart = idx === 0 || /[\s,(–-]/.test(name[idx - 1]!);
    scored.push({ a, score: idx === 0 ? 0 : wordStart ? 1 : 2 });
  }
  return scored
    .sort((x, y) => x.score - y.score || byNumber(x.a, y.a))
    .map((x) => x.a)
    .slice(0, limit);
}
