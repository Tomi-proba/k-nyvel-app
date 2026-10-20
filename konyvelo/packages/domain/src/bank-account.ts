/**
 * Bankszámlaszám formai ellenőrzése: belföldi (12345678-12345678 vagy
 * 12345678-12345678-12345678) vagy IBAN (ISO 13616, mod-97 ellenőrzéssel).
 */

export type BankAccountResult = { ok: true; normalized: string } | { ok: false; message: string };

export function validateIban(input: string): boolean {
  const s = input.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  if (s.startsWith("HU") && s.length !== 28) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of code) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

export function validateBankAccount(input: string): BankAccountResult {
  const raw = input.trim();
  const compact = raw.replace(/[\s-]/g, "");
  if (/^[A-Za-z]{2}/.test(compact)) {
    if (!validateIban(compact)) return { ok: false, message: "Érvénytelen IBAN (ellenőrizze a számjegyeket)." };
    return { ok: true, normalized: compact.toUpperCase().replace(/(.{4})/g, "$1 ").trim() };
  }
  if (/^\d{16}$/.test(compact) || /^\d{24}$/.test(compact)) {
    return { ok: true, normalized: compact.match(/.{8}/g)!.join("-") };
  }
  return {
    ok: false,
    message: "A bankszámlaszám formája: 12345678-12345678, 12345678-12345678-12345678 vagy IBAN (pl. HU42 1177 3016 1111 1018 0000 0000).",
  };
}
