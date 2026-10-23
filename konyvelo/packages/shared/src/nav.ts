import { z } from "zod";
import { isValidIsoDate, type NavDirection, type NavOperation } from "@konyvelo/domain";

/** NAV Online Számla import (7. lépés): bemeneti sémák és API-típusok. */

const isoDate = (label: string) =>
  z.string({ error: `${label}: kötelező mező.` }).refine(isValidIsoDate, `${label}: érvénytelen dátum (ÉÉÉÉ.HH.NN.).`);

const optionalUuid = z
  .union([z.uuid("Érvénytelen azonosító."), z.literal(""), z.null()])
  .transform((v) => (v === "" ? null : v))
  .optional();

export const navLinkSchema = z.object({
  code: z
    .string({ error: "Adja meg a kapcsolódási kódot." })
    .trim()
    .min(1, "Adja meg a kapcsolódási kódot.")
    .max(40, "A kapcsolódási kód legfeljebb 40 karakter."),
});

/** Az import leghosszabb időszaka egy indításra. */
export const NAV_IMPORT_MAX_DAYS = 366;

export const navImportSchema = z
  .object({
    direction: z.enum(["INBOUND", "OUTBOUND"], { error: "Válassza ki az irányt (bejövő vagy kimenő)." }),
    dateFrom: isoDate("Kezdő dátum"),
    dateTo: isoDate("Záró dátum"),
  })
  .superRefine((v, ctx) => {
    if (v.dateTo < v.dateFrom) ctx.addIssue({ code: "custom", path: ["dateTo"], message: "A záró dátum nem lehet a kezdő előtt." });
    const days = (Date.parse(v.dateTo) - Date.parse(v.dateFrom)) / 86_400_000 + 1;
    if (days > NAV_IMPORT_MAX_DAYS) {
      ctx.addIssue({ code: "custom", path: ["dateTo"], message: `Egy importtal legfeljebb ${NAV_IMPORT_MAX_DAYS} nap kérdezhető le.` });
    }
  });

export const navApproveSchema = z.object({
  accountingDate: isoDate("Könyvelés dátuma").optional(),
  partnerId: optionalUuid,
  /** A partnert a NAV-adatokból veszi fel a program (a teljes számlaadat kell hozzá). */
  createPartner: z.boolean().default(false),
  mainAccountId: optionalUuid,
  templateId: optionalUuid,
  /** Igaz: azonnal könyvel; hamis: piszkozat, amelyet a bizonylatok között lehet szerkeszteni. */
  post: z.boolean().default(false),
});
export type NavApproveInput = z.input<typeof navApproveSchema>;

export const navIgnoreSchema = z.object({
  reason: z.string({ error: "Adja meg az okát." }).trim().min(3, "Adja meg az okát (legalább 3 karakter).").max(300, "Legfeljebb 300 karakter."),
});

export type NavRemoteState = "OK" | "NOT_TESTED" | "BROKEN" | "UNREACHABLE" | "NOT_CONFIGURED" | "REVOKED";

export type NavConnectionDto = {
  /** Be van-e állítva ezen a telepítésen az eÁFA NAV-átjárója. */
  available: boolean;
  linked: boolean;
  environment: "TEST" | "PRODUCTION" | null;
  eafaTaxpayerName: string | null;
  eafaTaxNumber: string | null;
  linkedAt: string | null;
  linkedByName: string | null;
  remote: { state: NavRemoteState; title: string; action: string | null; checkedAt: string | null } | null;
  navCallsEnabled: boolean | null;
  productionEnabled: boolean | null;
};

export type NavImportRunDto = {
  id: string;
  direction: NavDirection;
  dateFrom: string;
  dateTo: string;
  status: "RUNNING" | "DONE" | "FAILED";
  windowsTotal: number;
  windowsDone: number;
  foundCount: number;
  newCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
};

/** A NAV-számla állapota a Könyvelőben: új (jóváhagyásra vár), piszkozat, könyvelt vagy figyelmen kívül hagyott. */
export type NavInvoiceState = "NEW" | "DRAFT" | "POSTED" | "IGNORED";

export const NAV_INVOICE_STATE_LABELS: Record<NavInvoiceState, string> = {
  NEW: "Jóváhagyásra vár",
  DRAFT: "Piszkozat",
  POSTED: "Könyvelve",
  IGNORED: "Figyelmen kívül hagyva",
};

export type NavInvoiceListItemDto = {
  id: string;
  direction: NavDirection;
  operation: NavOperation;
  invoiceNumber: string;
  originalInvoiceNumber: string | null;
  partnerName: string | null;
  partnerTaxNumber: string | null;
  issueDate: string;
  netAmountHuf: number | null;
  vatAmountHuf: number | null;
  completenessIndicator: boolean | null;
  state: NavInvoiceState;
  documentId: string | null;
  documentSerialNumber: string | null;
};

export type NavProposalLineDto = { accountId: string | null; accountNumber: string | null; accountName: string | null; side: "D" | "C"; amount: number; role: string };

export type NavInvoiceDetailDto = NavInvoiceListItemDto & {
  invoiceCategory: string | null;
  deliveryDate: string | null;
  paymentDate: string | null;
  paymentMethod: string | null;
  currency: string | null;
  ignoredReason: string | null;
  dataFetchedAt: string | null;
  /** A teljes számlaadatból: tételsorok (ha letöltötték). */
  lines: Array<{ lineNumber: number; description: string | null; quantity: number | null; unitOfMeasure: string | null; netAmountHuf: number | null; vatRate: number | null; vatCase: string | null }> | null;
  partner: { id: string; name: string } | null;
  /** Ha nincs ilyen partner: amit a NAV-adatokból fel lehet venni. */
  newPartner: { kind: "SUPPLIER" | "CUSTOMER"; name: string | null; taxNumberBase: string | null; taxNumberFull: string | null } | null;
  original: { invoiceId: string; documentId: string | null; serialNumber: string | null } | null;
  proposal:
    | {
        action: "DOCUMENT";
        docType: "SZSZ" | "VSZ" | "HELY";
        description: string;
        accountingDate: string;
        lines: NavProposalLineDto[];
        warnings: string[];
        blockers: string[];
      }
    | { action: "REVERSE"; originalSerialNumber: string | null; accountingDate: string; reason: string; warnings: string[]; blockers: string[] };
};
