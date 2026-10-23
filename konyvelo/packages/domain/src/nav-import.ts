import { addDays, compareDates, type IsoDate } from "./dates";
import type { LineSide } from "./documents";
import type { AmountBase, DocumentType } from "./documents";
import type { Filler } from "./money";

/**
 * NAV Online Számla import (PLAN 4.8, 10.): időablakok, összegek és a könyvelési javaslat.
 *
 * Az importált adat **könyvelési javaslat**, nem bizonylat: az adatszolgáltatás általában nem azonos
 * a számlával (REQUIREMENTS 10.7). A felhasználó hagyja jóvá; csak utána lesz belőle bizonylat.
 */

/** A NAV egy lekérdezésben legfeljebb 35 napot enged (REQUIREMENTS 10.4). */
export const NAV_MAX_QUERY_DAYS = 35;

export type NavDirection = "INBOUND" | "OUTBOUND";
export type NavOperation = "CREATE" | "MODIFY" | "STORNO";

export const NAV_DIRECTION_LABELS: Record<NavDirection, string> = {
  INBOUND: "Bejövő (szállítói) számlák",
  OUTBOUND: "Kimenő (vevő-) számlák",
};

export const NAV_OPERATION_LABELS: Record<NavOperation, string> = {
  CREATE: "Számla",
  MODIFY: "Módosító számla",
  STORNO: "Sztornó számla",
};

/** Az időszak felbontása legfeljebb 35 napos, egymást nem fedő ablakokra. */
export function splitIntoWindows(from: IsoDate, to: IsoDate, maxDays = NAV_MAX_QUERY_DAYS): Array<{ from: IsoDate; to: IsoDate }> {
  if (compareDates(to, from) < 0) throw new Error("A záró dátum nem lehet a kezdő előtt.");
  const windows: Array<{ from: IsoDate; to: IsoDate }> = [];
  let start = from;
  while (compareDates(start, to) <= 0) {
    const candidate = addDays(start, maxDays - 1);
    const end = compareDates(candidate, to) > 0 ? to : candidate;
    windows.push({ from: start, to: end });
    start = addDays(end, 1);
  }
  return windows;
}

/** A NAV forintösszege (pl. 12500.5) fillérben, fél fillértől felfelé kerekítve. */
export function navAmountToFiller(value: number | null | undefined): Filler | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.sign(value) * Math.round(Math.abs(value) * 100 + 1e-7);
}

/** Az adószám törzsszáma (első 8 jegy); a NAV a kivonatban ezt adja. */
export function taxNumberBase(taxNumber: string | null | undefined): string | null {
  const digits = (taxNumber ?? "").replace(/[\s-]/g, "");
  return /^\d{8}/.test(digits) ? digits.slice(0, 8) : null;
}

/** Ami a javaslathoz a NAV-számlából kell. */
export type NavInvoiceForProposal = {
  direction: NavDirection;
  operation: NavOperation;
  invoiceNumber: string;
  originalInvoiceNumber: string | null;
  partnerName: string | null;
  issueDate: IsoDate;
  deliveryDate: IsoDate | null;
  paymentDate: IsoDate | null;
  /** Fillérben, előjelesen. */
  netAmountHuf: Filler | null;
  vatAmountHuf: Filler | null;
  completenessIndicator: boolean | null;
  currency: string | null;
};

export type ProposalAccounts = {
  /** Költség (bejövő) vagy árbevétel (kimenő) számla: a felhasználó választása, a sablon, vagy a partner alapértelmezése. */
  main: string | null;
  /** Szállító (bejövő) vagy vevő (kimenő) számla. */
  partnerAccount: string | null;
  /** 466 (bejövő) vagy 467 (kimenő). */
  vat: string | null;
};

/** Az eredeti számla bizonylata a rendszerben (módosító és sztornó számlához). */
export type OriginalDocument = { id: string; status: "DRAFT" | "POSTED"; reversed: boolean; serialNumber: string | null } | null;

export type ProposalLine = { accountId: string | null; side: LineSide; amount: Filler; role: "MAIN" | "VAT" | "PARTNER" | "TEMPLATE" };

export type NavProposal =
  | {
      action: "DOCUMENT";
      docType: Extract<DocumentType, "SZSZ" | "VSZ" | "HELY">;
      correctsDocumentId: string | null;
      description: string;
      externalNumber: string;
      issueDate: IsoDate;
      fulfillmentDate: IsoDate;
      accountingDate: IsoDate;
      dueDate: IsoDate | null;
      lines: ProposalLine[];
      warnings: string[];
      blockers: string[];
    }
  | { action: "REVERSE"; originalDocumentId: string | null; accountingDate: IsoDate; reason: string; warnings: string[]; blockers: string[] };

/**
 * A könyvelési javaslat egy NAV-számlához.
 *
 * - Számla (`CREATE`): bejövőnél szállítói számla (T költség nettó, T 466 áfa / K szállító bruttó),
 *   kimenőnél vevőszámla (T vevő bruttó / K árbevétel nettó, K 467 áfa).
 * - Módosító számla (`MODIFY`): helyesbítő bizonylat az eredetire hivatkozva, csak a különbözettel
 *   (REQUIREMENTS 10.8); negatív különbözetnél az oldalak felcserélődnek.
 * - Sztornó számla (`STORNO`): az eredeti bizonylat sztornója.
 *
 * Sablonnal a sablon sorai adják a kontírozást (nettó, áfa, bruttó alapon).
 */
export function proposeNavPosting(
  invoice: NavInvoiceForProposal,
  accounts: ProposalAccounts,
  original: OriginalDocument,
  template: ReadonlyArray<{ accountId: string; side: LineSide; base: AmountBase }> | null = null,
): NavProposal {
  const warnings: string[] = [];
  const blockers: string[] = [];
  const inbound = invoice.direction === "INBOUND";
  const accountingDate = invoice.deliveryDate ?? invoice.issueDate;
  if (invoice.completenessIndicator === false) {
    warnings.push(
      "A NAV-adat nem teljes számla (az adatszolgáltatás nem azonos a számlával): a bizonylat az eredeti számla; vesse össze vele.",
    );
  }
  if (invoice.currency && invoice.currency !== "HUF") {
    warnings.push(`Devizás számla (${invoice.currency}): a javaslat a NAV-ban szereplő forintösszeget használja.`);
  }

  if (invoice.operation === "STORNO") {
    const ref = invoice.originalInvoiceNumber ?? "?";
    if (!original) blockers.push(`Az eredeti számla (${ref}) bizonylata nincs a rendszerben; előbb azt kell importálni és könyvelni.`);
    else if (original.status !== "POSTED") blockers.push(`Az eredeti számla (${ref}) bizonylata még piszkozat; előbb könyvelje, vagy törölje a piszkozatot.`);
    else if (original.reversed) blockers.push(`Az eredeti bizonylatot (${original.serialNumber}) már sztornózták.`);
    return {
      action: "REVERSE",
      originalDocumentId: original?.id ?? null,
      accountingDate,
      reason: `NAV sztornó számla: ${invoice.invoiceNumber}`,
      warnings,
      blockers,
    };
  }

  const net = invoice.netAmountHuf ?? 0;
  const vat = invoice.vatAmountHuf ?? 0;
  const gross = net + vat;
  if (invoice.netAmountHuf === null) blockers.push("A NAV-adatban nincs forintösszeg; töltse le a teljes számlaadatot, vagy rögzítse kézzel.");

  let docType: "SZSZ" | "VSZ" | "HELY" = inbound ? "SZSZ" : "VSZ";
  let correctsDocumentId: string | null = null;
  if (invoice.operation === "MODIFY") {
    docType = "HELY";
    const ref = invoice.originalInvoiceNumber ?? "?";
    if (!original) blockers.push(`Az eredeti számla (${ref}) bizonylata nincs a rendszerben; előbb azt kell importálni és könyvelni.`);
    else if (original.status !== "POSTED") blockers.push(`Az eredeti számla (${ref}) bizonylata még piszkozat; előbb könyvelje.`);
    else correctsDocumentId = original.id;
    if (gross === 0 && net === 0) warnings.push("A módosító számla nem változtat az összegen; elég lehet figyelmen kívül hagyni.");
  }

  const debitIfPositive = (amount: Filler, normal: LineSide): { side: LineSide; amount: Filler } => {
    const flip: LineSide = normal === "D" ? "C" : "D";
    return amount >= 0 ? { side: normal, amount } : { side: flip, amount: -amount };
  };
  const raw: ProposalLine[] = [];
  if (template && template.length) {
    for (const t of template) {
      const base = t.base === "NET" ? net : t.base === "VAT" ? vat : t.base === "GROSS" ? gross : 0;
      raw.push({ accountId: t.accountId, ...debitIfPositive(base, t.side), role: "TEMPLATE" });
    }
  } else if (inbound) {
    raw.push({ accountId: accounts.main, ...debitIfPositive(net, "D"), role: "MAIN" });
    raw.push({ accountId: accounts.vat, ...debitIfPositive(vat, "D"), role: "VAT" });
    raw.push({ accountId: accounts.partnerAccount, ...debitIfPositive(gross, "C"), role: "PARTNER" });
  } else {
    raw.push({ accountId: accounts.partnerAccount, ...debitIfPositive(gross, "D"), role: "PARTNER" });
    raw.push({ accountId: accounts.main, ...debitIfPositive(net, "C"), role: "MAIN" });
    raw.push({ accountId: accounts.vat, ...debitIfPositive(vat, "C"), role: "VAT" });
  }
  const lines = raw.filter((l) => l.amount !== 0);
  if (!template && !accounts.main && net !== 0) {
    warnings.push(
      inbound
        ? "A partnernél nincs alapértelmezett költségszámla: válassza ki (vagy sablont), mielőtt könyvel."
        : "A partnernél nincs alapértelmezett árbevétel-számla: válassza ki (vagy sablont), mielőtt könyvel.",
    );
  }

  const label = invoice.operation === "MODIFY" ? `Módosító számla (${invoice.originalInvoiceNumber ?? "?"})` : inbound ? "Szállítói számla" : "Vevőszámla";
  return {
    action: "DOCUMENT",
    docType,
    correctsDocumentId,
    description: `${label}${invoice.partnerName ? ` – ${invoice.partnerName}` : ""} (NAV-import)`,
    externalNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate,
    fulfillmentDate: invoice.deliveryDate ?? invoice.issueDate,
    accountingDate,
    dueDate: invoice.paymentDate,
    lines,
    warnings,
    blockers,
  };
}
