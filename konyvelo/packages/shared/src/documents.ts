import { z } from "zod";
import {
  AMOUNT_BASE_LABELS,
  DOCUMENT_TYPES,
  isValidIsoDate,
  type AmountBase,
  type DeadlineKind,
  type DeadlineStatus,
  type DocumentType,
  type LineSide,
} from "@konyvelo/domain";
import { FX_RATE_SOURCES } from "./schemas";

/** Bizonylatok, tételek és kontírozási sablonok: bemeneti sémák és API-típusok. */

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label}: legfeljebb ${max} karakter lehet.`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const optionalDate = (label: string) =>
  z
    .union([z.string(), z.null()])
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || isValidIsoDate(v), `${label}: érvénytelen dátum (ÉÉÉÉ.HH.NN.).`)
    .optional();

const optionalUuid = (message: string) =>
  z
    .union([z.uuid(message), z.literal(""), z.null()])
    .transform((v) => (v === "" ? null : v))
    .optional();

/** A felhasználó által rögzíthető típusok; a sztornót a rendszer hozza létre. */
export const ENTERABLE_DOCUMENT_TYPES = (Object.keys(DOCUMENT_TYPES) as DocumentType[]).filter((t) => t !== "SZT") as [
  DocumentType,
  ...DocumentType[],
];

export const DOCUMENT_STATUSES = ["DRAFT", "POSTED"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus | "REVERSED", string> = {
  DRAFT: "Piszkozat",
  POSTED: "Könyvelt",
  REVERSED: "Sztornózva",
};

const lineSchema = z.object({
  accountId: optionalUuid("Érvénytelen számla."),
  side: z.enum(["D", "C"]).nullable().optional(),
  amount: z
    .number({ error: "Érvénytelen összeg." })
    .int("Az összeg egész fillér legyen.")
    .min(0, "Az összeg nem lehet negatív.")
    .max(Number.MAX_SAFE_INTEGER, "Az összeg túl nagy.")
    .nullable()
    .optional(),
  description: optionalText("Tételszöveg", 300),
});
export type DocumentLineInput = z.infer<typeof lineSchema>;

/**
 * Bizonylat mentése. Piszkozatként félkészen is menthető (csak a típus és a
 * könyvelés dátuma kötelező); `post: true` esetén ugyanabban a lépésben
 * könyvelés is történik, ekkor a teljes ellenőrzés lefut.
 */
export const documentInputSchema = z.object({
  docType: z.enum(ENTERABLE_DOCUMENT_TYPES, { error: "Válassza ki a bizonylat típusát." }),
  description: optionalText("Leírás", 500),
  partnerId: optionalUuid("Érvénytelen partner."),
  externalNumber: optionalText("Külső bizonylatszám", 100),
  issueDate: optionalDate("Kelt"),
  fulfillmentDate: optionalDate("Teljesítés dátuma"),
  accountingDate: z
    .string({ error: "Könyvelés dátuma: kötelező mező." })
    .refine(isValidIsoDate, "Könyvelés dátuma: érvénytelen dátum (ÉÉÉÉ.HH.NN.)."),
  dueDate: optionalDate("Fizetési határidő"),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "A devizanem háromjegyű kód (pl. EUR).")
    .default("HUF"),
  /** Devizaösszeg a deviza váltópénzében (pl. eurócent). */
  fxAmount: z.number().int("Érvénytelen devizaösszeg.").positive("A devizaösszeg legyen pozitív.").nullable().optional(),
  fxRate: z.number().positive("Az árfolyam legyen pozitív.").max(1_000_000, "Érvénytelen árfolyam.").nullable().optional(),
  fxRateSource: z.enum(FX_RATE_SOURCES).nullable().optional(),
  fxRateDate: optionalDate("Árfolyam dátuma"),
  authorizedBy: optionalText("Utalványozó", 200),
  checkedBy: optionalText("Ellenőrző", 200),
  correctsDocumentId: optionalUuid("Érvénytelen bizonylat."),
  templateId: optionalUuid("Érvénytelen sablon."),
  lines: z.array(lineSchema).max(500, "Egy bizonylaton legfeljebb 500 tételsor lehet.").default([]),
  post: z.boolean().default(false),
});
export type DocumentInput = z.input<typeof documentInputSchema>;
export type DocumentParsedInput = z.output<typeof documentInputSchema>;

export const reverseSchema = z.object({
  accountingDate: z
    .string({ error: "Könyvelés dátuma: kötelező mező." })
    .refine(isValidIsoDate, "Könyvelés dátuma: érvénytelen dátum (ÉÉÉÉ.HH.NN.)."),
  reason: z
    .string({ error: "A sztornó oka: kötelező mező." })
    .trim()
    .min(3, "Írja le röviden a sztornó okát.")
    .max(300, "A sztornó oka legfeljebb 300 karakter lehet."),
});
export type ReverseInput = z.infer<typeof reverseSchema>;

export type DeadlineDto = { kind: DeadlineKind; deadline: string; rule: string; status: DeadlineStatus };

export type DocumentLineDto = {
  id: string;
  lineNo: number;
  accountId: string | null;
  accountNumber: string | null;
  accountName: string | null;
  side: LineSide | null;
  amount: number;
  partnerId: string | null;
  description: string | null;
};

export type DocumentRef = { id: string; serialNumber: string | null; status: DocumentStatus };

export type DocumentDto = {
  id: string;
  docType: DocumentType;
  status: DocumentStatus;
  serialNumber: string | null;
  fiscalYearId: string;
  partnerId: string | null;
  partnerName: string | null;
  externalNumber: string | null;
  description: string | null;
  issueDate: string | null;
  fulfillmentDate: string | null;
  accountingDate: string;
  dueDate: string | null;
  currency: string;
  fxAmount: number | null;
  fxRate: number | null;
  fxRateSource: (typeof FX_RATE_SOURCES)[number] | null;
  fxRateDate: string | null;
  authorizedBy: string | null;
  checkedBy: string | null;
  source: string;
  templateId: string | null;
  /** Melyik bizonylatot sztornózza / helyesbíti ez a bizonylat. */
  reverses: DocumentRef | null;
  corrects: DocumentRef | null;
  /** Ezt a bizonylatot sztornózó, illetve helyesbítő bizonylatok. */
  reversedBy: DocumentRef | null;
  correctedBy: DocumentRef[];
  /** Előző üzleti évet érintő hiba esetén az érintett év (Szt. 3. § (3), K 5.4). */
  affectsFiscalYearId: string | null;
  totalDebit: number;
  totalCredit: number;
  createdAt: string;
  createdByName: string | null;
  updatedAt: string;
  postedAt: string | null;
  postedByName: string | null;
  contentHash: string | null;
  deadline: DeadlineDto;
  lines: DocumentLineDto[];
};

export type DocumentListItemDto = {
  id: string;
  docType: DocumentType;
  status: DocumentStatus;
  serialNumber: string | null;
  accountingDate: string;
  partnerName: string | null;
  externalNumber: string | null;
  description: string | null;
  total: number;
  reversed: boolean;
  deadline: DeadlineDto;
};

export type DocumentListResponse = { items: DocumentListItemDto[]; total: number };

/** A Kezdőlap teendői. */
export type TodosDto = {
  drafts: Array<{
    id: string;
    docType: DocumentType;
    description: string | null;
    accountingDate: string;
    total: number;
    updatedAt: string;
    deadline: DeadlineDto;
  }>;
  /** Az elmúlt 30 napban határidőn túl könyvelt bizonylatok száma. */
  latePostedLast30Days: number;
  /** Könyvelhető, aktív számlák kimutatássor nélkül. */
  unmappedAccounts: number;
};

// ---------- Kontírozási sablonok ----------

export const AMOUNT_BASES = Object.keys(AMOUNT_BASE_LABELS) as [AmountBase, ...AmountBase[]];

const templateLineSchema = z.object({
  accountId: z.uuid("Válasszon számlát."),
  side: z.enum(["D", "C"], { error: "Adja meg, hogy tartozik vagy követel." }),
  base: z.enum(AMOUNT_BASES, { error: "Válassza ki, milyen összeg kerüljön a sorba." }),
});

const templateFields = {
  name: z
    .string({ error: "Név: kötelező mező." })
    .trim()
    .min(1, "Név: kötelező mező.")
    .max(100, "Név: legfeljebb 100 karakter lehet."),
  shortcut: optionalText("Rövid kód", 12),
  docType: z.enum(ENTERABLE_DOCUMENT_TYPES).nullable().optional(),
  description: optionalText("Alapértelmezett leírás", 500),
  vatRate: z
    .number({ error: "Az áfakulcs 0 és 100 közötti egész szám." })
    .int("Az áfakulcs 0 és 100 közötti egész szám.")
    .min(0, "Az áfakulcs 0 és 100 közötti egész szám.")
    .max(100, "Az áfakulcs 0 és 100 közötti egész szám.")
    .nullable()
    .optional(),
  partnerId: optionalUuid("Érvénytelen partner."),
  lines: z.array(templateLineSchema).min(2, "A sablonnak legalább két sora legyen.").max(30, "Legfeljebb 30 sor lehet."),
  isActive: z.boolean(),
};

export const templateCreateSchema = z.object({ ...templateFields, isActive: templateFields.isActive.default(true) });
export type TemplateCreateInput = z.infer<typeof templateCreateSchema>;
export const templateUpdateSchema = z.object(templateFields).partial();
export type TemplateUpdateInput = z.infer<typeof templateUpdateSchema>;

export type TemplateDto = {
  id: string;
  name: string;
  shortcut: string | null;
  docType: DocumentType | null;
  description: string | null;
  vatRate: number | null;
  partnerId: string | null;
  lines: Array<{ accountId: string; side: LineSide; base: AmountBase }>;
  isActive: boolean;
};
