import { addDays, endOfMonth, isValidIsoDate, type IsoDate } from "./dates";
import { formatHuf, type Filler } from "./money";
import type { NormalSide, Subledger } from "./accounts";

/**
 * Bizonylatok és könyvelési tételek (PLAN 4.5).
 *
 * Bizonylat nélkül nem lehet könyvelni (Szt. 165. § (1)–(2)). A bizonylat
 * piszkozatként szabadon szerkeszthető; könyveléskor kap végleges, hézagmentes
 * sorszámot, és onnan nem módosítható – javítani sztornóval vagy helyesbítő
 * bizonylattal lehet (Szt. 165. § (2), 167. § (7)).
 */

export type DocumentType = "SZSZ" | "VSZ" | "BANK" | "PB" | "PK" | "VEGY" | "SZT" | "HELY";

export type DocumentTypeInfo = {
  code: DocumentType;
  label: string;
  /** Sorszám-előtag: SZSZ-2026-00001 */
  prefix: string;
  /** Kötelező-e a partner. */
  requiresPartner: boolean;
  /** Kötelező-e a külső (a partner által adott) bizonylatszám. */
  requiresExternalNumber: boolean;
  /** A külső szám felirata a felületen. */
  externalNumberLabel: string;
  /** Kötelező-e a teljesítés dátuma (Szt. 167. § (1) d)). */
  requiresFulfillmentDate: boolean;
  /** Milyen partner választható. */
  partnerKind: "CUSTOMER" | "SUPPLIER" | "ANY";
  /** A felhasználó közvetlenül választhatja-e (a sztornót és a helyesbítőt a rendszer hozza létre egy eredetiből). */
  selectable: boolean;
};

const T = (code: DocumentType, label: string, o: Partial<DocumentTypeInfo> = {}): DocumentTypeInfo => ({
  code,
  label,
  prefix: code,
  requiresPartner: false,
  requiresExternalNumber: false,
  externalNumberLabel: "Külső bizonylatszám",
  requiresFulfillmentDate: false,
  partnerKind: "ANY",
  selectable: true,
  ...o,
});

export const DOCUMENT_TYPES: Record<DocumentType, DocumentTypeInfo> = {
  SZSZ: T("SZSZ", "Szállítói számla (bejövő)", {
    requiresPartner: true,
    requiresExternalNumber: true,
    externalNumberLabel: "A szállító számlaszáma",
    requiresFulfillmentDate: true,
    partnerKind: "SUPPLIER",
  }),
  VSZ: T("VSZ", "Vevőszámla (kimenő)", {
    requiresPartner: true,
    requiresExternalNumber: true,
    externalNumberLabel: "Számlaszám",
    requiresFulfillmentDate: true,
    partnerKind: "CUSTOMER",
  }),
  BANK: T("BANK", "Banki bizonylat (kivonat)", { externalNumberLabel: "Kivonat száma" }),
  PB: T("PB", "Pénztárbevételi bizonylat"),
  PK: T("PK", "Pénztárkiadási bizonylat"),
  VEGY: T("VEGY", "Vegyes (belső) bizonylat"),
  SZT: T("SZT", "Sztornó bizonylat", { selectable: false }),
  HELY: T("HELY", "Helyesbítő bizonylat", { selectable: false }),
};

export const DOCUMENT_TYPE_CODES = Object.keys(DOCUMENT_TYPES) as DocumentType[];

export function isDocumentType(v: unknown): v is DocumentType {
  return typeof v === "string" && v in DOCUMENT_TYPES;
}

/** Bizonylat-sorszám: SZSZ-2026-00001 (az üzleti év kezdő évével). */
export function formatSerialNumber(type: DocumentType, fiscalYearStart: IsoDate, seq: number): string {
  return `${DOCUMENT_TYPES[type].prefix}-${fiscalYearStart.slice(0, 4)}-${String(seq).padStart(5, "0")}`;
}

// ---------- Egyensúly ----------

export type LineSide = NormalSide;
export type BalanceLine = { side: LineSide | null; amount: Filler | null };
export type Balance = { debit: Filler; credit: Filler; difference: Filler };

/** Tartozik és követel összeg; difference = tartozik − követel. */
export function documentBalance(lines: readonly BalanceLine[]): Balance {
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    if (!l.amount || l.amount <= 0) continue;
    if (l.side === "D") debit += l.amount;
    else if (l.side === "C") credit += l.amount;
  }
  return { debit, credit, difference: debit - credit };
}

export function balanceErrorMessage(b: Balance): string | null {
  if (b.difference === 0) return null;
  return `A tartozik és követel oldal nem egyezik, eltérés: ${formatHuf(Math.abs(b.difference))}`;
}

/** Az „=” billentyűhöz: mennyit kell a megadott oldalra írni, hogy a bizonylat egyensúlyban legyen (0, ha azon az oldalon nem hiányzik semmi). */
export function missingAmountFor(side: LineSide, b: Balance): Filler {
  if (side === "D") return b.difference < 0 ? -b.difference : 0;
  return b.difference > 0 ? b.difference : 0;
}

// ---------- Könyvelhetőség ellenőrzése ----------

export type PostingCheckLine = {
  accountId: string | null;
  side: LineSide | null;
  amount: Filler | null;
};

export type PostingCheckInput = {
  docType: string | null;
  description: string | null;
  issueDate: string | null;
  fulfillmentDate: string | null;
  accountingDate: string | null;
  dueDate: string | null;
  externalNumber: string | null;
  partnerId: string | null;
  currency: string | null;
  fxAmount: number | null;
  fxRate: number | null;
  correctsDocumentId?: string | null;
  lines: readonly PostingCheckLine[];
};

export type AccountInfo = { subledger: Subledger; number: string };

const SUBLEDGER_PARTNER_NEEDED: Subledger[] = ["CUSTOMER", "SUPPLIER"];

/**
 * A könyvelés előtti ellenőrzés: a felület (azonnali hibaüzenet) és a szerver
 * (utolsó ellenőrzés) ugyanezt futtatja. Mezőnkénti magyar hibaüzeneteket ad;
 * a tételsorok hibái „lines.3.amount” formájú kulccsal.
 */
export function validateForPosting(
  doc: PostingCheckInput,
  accountOf: (accountId: string) => AccountInfo | undefined = () => undefined,
): Record<string, string> {
  const e: Record<string, string> = {};
  const type = isDocumentType(doc.docType) ? DOCUMENT_TYPES[doc.docType] : null;
  if (!type) e.docType = "Válassza ki a bizonylat típusát.";
  if (!doc.description?.trim()) e.description = "Írja le röviden a gazdasági műveletet (Szt. 167. § (1) e)).";

  const dateField = (key: "issueDate" | "fulfillmentDate" | "accountingDate" | "dueDate", label: string, required: boolean) => {
    const v = doc[key];
    if (!v) {
      if (required) e[key] = `${label}: kötelező mező.`;
    } else if (!isValidIsoDate(v)) e[key] = `${label}: érvénytelen dátum (ÉÉÉÉ.HH.NN.).`;
  };
  dateField("issueDate", "Kelt", true);
  dateField("fulfillmentDate", "Teljesítés dátuma", type?.requiresFulfillmentDate ?? false);
  dateField("accountingDate", "Könyvelés dátuma", true);
  dateField("dueDate", "Fizetési határidő", false);
  if (doc.dueDate && doc.issueDate && !e.dueDate && !e.issueDate && doc.dueDate < doc.issueDate) {
    e.dueDate = "A fizetési határidő nem lehet korábbi a keltnél.";
  }

  if (type?.requiresExternalNumber && !doc.externalNumber?.trim()) e.externalNumber = `${type.externalNumberLabel}: kötelező mező.`;
  if (type?.code === "HELY" && !doc.correctsDocumentId) e.docType = "A helyesbítő bizonylatnak hivatkoznia kell az eredeti bizonylatra.";

  if (doc.currency && doc.currency !== "HUF") {
    if (!doc.fxAmount || doc.fxAmount <= 0) e.fxAmount = "Devizás bizonylatnál adja meg a devizaösszeget.";
    if (!doc.fxRate || doc.fxRate <= 0) e.fxRate = "Devizás bizonylatnál adja meg az alkalmazott árfolyamot.";
  }

  let needsPartner = type?.requiresPartner ?? false;
  const complete = doc.lines.filter((l) => l.accountId || l.amount);
  complete.forEach((l) => {
    const i = doc.lines.indexOf(l);
    if (!l.accountId) e[`lines.${i}.accountId`] = "Válasszon számlát.";
    if (!l.amount || l.amount <= 0) e[`lines.${i}.amount`] = "Adjon meg pozitív összeget a tartozik vagy a követel oldalon.";
    else if (!l.side) e[`lines.${i}.amount`] = "Adja meg, hogy tartozik vagy követel.";
    const acc = l.accountId ? accountOf(l.accountId) : undefined;
    if (acc && SUBLEDGER_PARTNER_NEEDED.includes(acc.subledger)) needsPartner = true;
  });
  if (complete.length < 2) e.lines = "Legalább két tételsor kell (egy tartozik és egy követel).";
  else {
    const b = documentBalance(complete);
    if (b.debit === 0 || b.credit === 0) e.lines = "Kell tartozik és követel oldali tétel is.";
    const msg = balanceErrorMessage(b);
    if (msg) e.balance = msg;
  }
  if (needsPartner && !doc.partnerId) {
    e.partnerId = type?.requiresPartner
      ? "Válasszon partnert."
      : "Vevő- vagy szállítószámlára (pl. 311, 454) csak partnerrel lehet könyvelni.";
  }
  return e;
}

/** Sztornó: ugyanazok a tételek fordított oldalon (a forgalom így is kiegyenlítődik). */
export function reverseLines<L extends { side: LineSide }>(lines: readonly L[]): L[] {
  return lines.map((l) => ({ ...l, side: l.side === "D" ? "C" : "D" }));
}

// ---------- Rögzítési határidő (Szt. 165. § (3)) ----------

export type DeadlineKind = "CASH" | "BANK" | "OTHER";
export type DeadlineStatus = "OK" | "DUE_SOON" | "OVERDUE" | "LATE";

export const DEADLINE_RULES: Record<DeadlineKind, string> = {
  CASH: "Készpénzforgalom: a pénzmozgással egyidejűleg kell könyvelni (Szt. 165. § (3) a)).",
  BANK: "Bankszámlaforgalom: a hitelintézeti értesítés (kivonat) megérkezésekor, késedelem nélkül kell könyvelni; a rendszer legkésőbb a tárgyhót követő hó 15-ét figyeli (Szt. 165. § (3) a)).",
  OTHER: "Egyéb bizonylat: legkésőbb a tárgynegyedévet követő hó végéig kell könyvelni; a számviteli politika ennél korábbi időpontot is előírhat (Szt. 165. § (3) b)).",
};

/** Hány nappal a határidő előtt jelezzen a rendszer. */
export const DEADLINE_WARN_DAYS = 7;

export type RecordingDeadline = { kind: DeadlineKind; eventDate: IsoDate; deadline: IsoDate; rule: string };

/**
 * A rögzítési határidő. A gazdasági esemény napja a teljesítés, ennek
 * hiányában a kelt. Pénztárt érintő bizonylatnál a pénzmozgás napja, bankot
 * érintőnél a tárgyhót követő hó 15-e, egyébként a tárgynegyedévet követő hó
 * utolsó napja.
 */
export function recordingDeadline(input: { eventDate: IsoDate; touchesCash: boolean; touchesBank: boolean }): RecordingDeadline {
  const { eventDate } = input;
  const kind: DeadlineKind = input.touchesCash ? "CASH" : input.touchesBank ? "BANK" : "OTHER";
  let deadline: IsoDate;
  if (kind === "CASH") deadline = eventDate;
  else if (kind === "BANK") deadline = addDays(endOfMonth(eventDate), 15);
  else {
    const month = Number(eventDate.slice(5, 7));
    const quarterEndMonth = Math.ceil(month / 3) * 3;
    const firstOfNext = quarterEndMonth === 12 ? `${Number(eventDate.slice(0, 4)) + 1}-01-01` : `${eventDate.slice(0, 4)}-${String(quarterEndMonth + 1).padStart(2, "0")}-01`;
    deadline = endOfMonth(firstOfNext);
  }
  return { kind, eventDate, deadline, rule: DEADLINE_RULES[kind] };
}

/**
 * Piszkozatnál: lejárt (OVERDUE) vagy hamarosan lejár (DUE_SOON) a mai naphoz
 * képest. Könyvelt bizonylatnál: határidőn túl könyvelték-e (LATE).
 */
export function deadlineStatus(deadline: IsoDate, opts: { postedOn: IsoDate | null; today: IsoDate }): DeadlineStatus {
  if (opts.postedOn) return opts.postedOn > deadline ? "LATE" : "OK";
  if (opts.today > deadline) return "OVERDUE";
  if (addDays(opts.today, DEADLINE_WARN_DAYS) >= deadline) return "DUE_SOON";
  return "OK";
}

export function deadlineEventDate(doc: { fulfillmentDate: string | null; issueDate: string | null; accountingDate: string }): IsoDate {
  return doc.fulfillmentDate || doc.issueDate || doc.accountingDate;
}

// ---------- Kontírozási sablonok ----------

export type AmountBase = "GROSS" | "NET" | "VAT" | "NONE";
export const AMOUNT_BASE_LABELS: Record<AmountBase, string> = {
  GROSS: "Bruttó",
  NET: "Nettó",
  VAT: "Áfa",
  NONE: "Kézzel",
};

export type VatSplit = { net: Filler; vat: Filler; gross: Filler };

/**
 * Bruttó vagy nettó összeg felbontása az áfakulcs szerint. Egész forintos
 * összegnél az áfa egész forintra kerekül (0,50 Ft felfelé), egyébként
 * fillérre. Ez csak kontírozási segítség; áfa-analitika nincs.
 */
export function splitByVat(amount: Filler, kind: "GROSS" | "NET", vatRatePercent: number): VatSplit {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error(`Érvénytelen összeg: ${amount}`);
  if (!(vatRatePercent >= 0 && vatRatePercent <= 100)) throw new Error(`Érvénytelen áfakulcs: ${vatRatePercent}`);
  const wholeForint = amount % 100 === 0;
  const round = (exactFiller: number) => (wholeForint ? Math.round(exactFiller / 100) * 100 : Math.round(exactFiller));
  if (kind === "GROSS") {
    const vat = round((amount * vatRatePercent) / (100 + vatRatePercent));
    return { gross: amount, vat, net: amount - vat };
  }
  const vat = round((amount * vatRatePercent) / 100);
  return { net: amount, vat, gross: amount + vat };
}

export type TemplateLine = { accountId: string; side: LineSide; base: AmountBase };

/** Sablon kitöltése: a sorok összegét a bázis (bruttó, nettó, áfa) adja; a 0 Ft-os áfasor elmarad. */
export function applyTemplate(lines: readonly TemplateLine[], split: VatSplit | null): Array<{ accountId: string; side: LineSide; amount: Filler | null }> {
  const out: Array<{ accountId: string; side: LineSide; amount: Filler | null }> = [];
  for (const l of lines) {
    const amount = !split || l.base === "NONE" ? null : l.base === "GROSS" ? split.gross : l.base === "NET" ? split.net : split.vat;
    if (l.base === "VAT" && amount === 0) continue;
    out.push({ accountId: l.accountId, side: l.side, amount });
  }
  return out;
}
