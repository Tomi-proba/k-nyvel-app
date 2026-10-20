/** Böngészőben tárolt kényelmi beállítások; ha a tároló nem elérhető, csendben kihagyjuk. */
export function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(`konyvelo.${key}`);
  } catch {
    return null;
  }
}

export function writeSetting(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(`konyvelo.${key}`);
    else localStorage.setItem(`konyvelo.${key}`, value);
  } catch {
    // privát mód vagy letiltott tároló
  }
}
