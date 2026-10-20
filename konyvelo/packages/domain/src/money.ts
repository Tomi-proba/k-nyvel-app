/**
 * Pénzösszegek. Minden összeg egész számú FILLÉR (1 Ft = 100 fillér), így a
 * számításokban nincs kerekítési hiba. Lebegőpontos Ft-összeget sehol nem
 * tárolunk. A JavaScript egész számai 9 007 199 254 740 991-ig pontosak, ez
 * több mint 90 000 milliárd Ft – bőven elég.
 */

export type Filler = number;

/** Nem törő szóköz: a „12 500 Ft” nem tördelődik szét. */
export const NBSP = " ";

export function assertFiller(value: number): asserts value is Filler {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Érvénytelen összeg (nem egész fillér): ${value}`);
  }
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

export type FormatHufOptions = {
  /** "auto": fillér csak akkor jelenik meg, ha nem nulla. */
  decimals?: "auto" | "always" | "never";
  withUnit?: boolean;
};

/** 1250000 fillér → "12 500 Ft"; 1250050 → "12 500,50 Ft". */
export function formatHuf(filler: Filler, options: FormatHufOptions = {}): string {
  assertFiller(filler);
  const { decimals = "auto", withUnit = true } = options;
  const negative = filler < 0;
  const abs = Math.abs(filler);
  let whole = Math.floor(abs / 100);
  let fraction = abs % 100;

  if (decimals === "never" && fraction !== 0) {
    // Kerekítés egész forintra (0,50 Ft felfelé).
    if (fraction >= 50) whole += 1;
    fraction = 0;
  }

  let text = groupThousands(String(whole));
  if (decimals === "always" || (decimals === "auto" && fraction !== 0)) {
    text += "," + String(fraction).padStart(2, "0");
  }
  if (negative && (whole !== 0 || fraction !== 0)) text = "-" + text;
  return withUnit ? `${text}${NBSP}Ft` : text;
}

export type ParseResult = { ok: true; value: Filler } | { ok: false; message: string };

/**
 * Összeg bevitele. Elfogadott: "12500", "12 500", "12.500", "12 500,50",
 * "12500.5", "-1 000". Ezres tagolás szóközzel vagy ponttal (pontosan 3
 * számjegyes csoportok), tizedes jel vessző, vagy pont legfeljebb 2 jeggyel.
 */
export function parseHufInput(input: string): ParseResult {
  let s = input.trim().replace(/[\s  ]/g, "").replace(/Ft$/i, "");
  if (s === "") return { ok: false, message: "Adjon meg egy összeget." };

  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }

  let integerPart: string;
  let fractionPart = "";

  if (s.includes(",")) {
    const parts = s.split(",");
    if (parts.length !== 2) return { ok: false, message: "Az összegben legfeljebb egy tizedesvessző lehet." };
    integerPart = parts[0]!.replace(/\./g, "");
    fractionPart = parts[1]!;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    integerPart = s.replace(/\./g, "");
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    const [a, b] = s.split(".");
    integerPart = a!;
    fractionPart = b!;
  } else {
    integerPart = s;
  }

  if (!/^\d+$/.test(integerPart) || !/^\d{0,2}$/.test(fractionPart)) {
    return { ok: false, message: "Az összeg csak számjegyeket tartalmazhat (pl. 12 500 vagy 12 500,50)." };
  }

  const value = Number(integerPart) * 100 + Number(fractionPart.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(value)) return { ok: false, message: "Az összeg túl nagy." };
  return { ok: true, value: negative ? -value : value };
}
