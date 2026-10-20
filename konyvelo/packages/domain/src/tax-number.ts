/**
 * Magyar adószám (xxxxxxxx-y-zz) ellenőrzése.
 *
 * - első 8 jegy: törzsszám; a 8. jegy ellenőrző számjegy: az első 7 jegyet a
 *   9, 7, 3, 1, 9, 7, 3 súlyokkal szorozva és összeadva, az összeg utolsó
 *   jegyét 10-ből kivonva (10 helyett 0) kell kapni;
 * - 9. jegy: áfakód (1–5);
 * - utolsó 2 jegy: területi kód.
 */

const WEIGHTS = [9, 7, 3, 1, 9, 7, 3] as const;

export type TaxNumberResult =
  | { ok: true; normalized: string }
  | { ok: false; message: string };

export function taxNumberCheckDigit(first7: string): number {
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(first7[i]) * WEIGHTS[i]!;
  return (10 - (sum % 10)) % 10;
}

export function validateTaxNumber(input: string): TaxNumberResult {
  const digits = input.replace(/[\s-]/g, "");
  if (!/^\d{11}$/.test(digits)) {
    return { ok: false, message: "Az adószám formája: 12345678-1-12 (11 számjegy)." };
  }
  const core = digits.slice(0, 8);
  const vatCode = digits[8]!;
  const region = digits.slice(9);

  if (Number(core[7]) !== taxNumberCheckDigit(core.slice(0, 7))) {
    return { ok: false, message: "Az adószám ellenőrző számjegye hibás. Kérjük, ellenőrizze a törzsszámot (első 8 jegy)." };
  }
  if (!/^[1-5]$/.test(vatCode)) {
    return { ok: false, message: "Az adószám 9. jegye (áfakód) csak 1–5 lehet." };
  }
  if (region === "00") {
    return { ok: false, message: "Az adószám utolsó két jegye (területi kód) nem lehet 00." };
  }
  return { ok: true, normalized: `${core}-${vatCode}-${region}` };
}
