/**
 * Dátumkezelés. A rendszerben a naptári dátumok mindenhol ISO formájú
 * szövegek ("2026-10-20"): nincs bennük időzóna, így nem csúszhatnak el egy
 * napot. A felületen magyar formában jelennek meg: "2026.10.20."
 */

export type IsoDate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtc(iso: IsoDate): Date {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`Érvénytelen dátum: ${iso}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function fromUtc(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function isValidIsoDate(value: string): boolean {
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900 || year > 2999 || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** Hónapok hozzáadása; ha a céldátum nem létezik (pl. 02.30.), a hónap utolsó napja lesz. */
export function addMonths(iso: IsoDate, months: number): IsoDate {
  const d = toUtc(iso);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const maxDay = daysInMonth(target.getUTCFullYear(), target.getUTCMonth() + 1);
  target.setUTCDate(Math.min(day, maxDay));
  return fromUtc(target);
}

export function endOfMonth(iso: IsoDate): IsoDate {
  const d = toUtc(iso);
  return fromUtc(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/** Összehasonlítás: negatív, ha a < b. ISO formában a szöveges összehasonlítás is helyes. */
export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function todayIso(now: Date = new Date()): IsoDate {
  // Helyi (magyar) idő szerinti mai nap.
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "2026-10-20" → "2026.10.20." */
export function formatDateHu(iso: IsoDate | null | undefined): string {
  if (!iso) return "";
  const m = ISO_RE.exec(iso);
  if (!m) return iso;
  return `${m[1]}.${m[2]}.${m[3]}.`;
}

/**
 * Rugalmas dátumbevitel, könyvelői gyorsrögzítéshez. Elfogadott formák:
 * "2026.10.20.", "2026.10.20", "2026. 10. 20.", "2026-10-20", "20261020",
 * valamint év nélkül "10.20." vagy "10.20" (ekkor a megadott évvel).
 * Érvénytelen bevitelre null-t ad.
 */
export function parseDateHu(input: string, defaultYear?: number): IsoDate | null {
  const s = input.trim().replace(/\s+/g, "");
  if (s === "") return null;

  let year: number;
  let month: number;
  let day: number;

  let m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\.?$/.exec(s);
  if (m) {
    year = Number(m[1]);
    month = Number(m[2]);
    day = Number(m[3]);
  } else if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) {
    year = Number(m[1]);
    month = Number(m[2]);
    day = Number(m[3]);
  } else if ((m = /^(\d{1,2})[.\-/](\d{1,2})\.?$/.exec(s)) && defaultYear !== undefined) {
    year = defaultYear;
    month = Number(m[1]);
    day = Number(m[2]);
  } else {
    return null;
  }

  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isValidIsoDate(iso) ? iso : null;
}
