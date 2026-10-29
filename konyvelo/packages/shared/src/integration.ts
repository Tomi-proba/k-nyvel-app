import { z } from "zod";

/** Integráció a többi modullal (I2, TERV.md F14). */

export const POSTING_MODES = ["DRAFT_ONLY", "AUTO"] as const;
export type PostingMode = (typeof POSTING_MODES)[number];
export const POSTING_MODE_LABELS: Record<PostingMode, string> = {
  DRAFT_ONLY: "Csak piszkozat (bevezető mód)",
  AUTO: "Automatikus könyvelés, ha minden egyértelmű",
};

export const PURCHASE_DATE_RULES = ["ASK", "RECEIVED", "INVOICE"] as const;
export type PurchaseDateRule = (typeof PURCHASE_DATE_RULES)[number];
export const PURCHASE_DATE_RULE_LABELS: Record<PurchaseDateRule, string> = {
  ASK: "Kérdezze meg a jóváhagyót",
  RECEIVED: "A bevételezés dátuma",
  INVOICE: "A szállítói számla dátuma",
};

export const INTEGRATION_ACCOUNT_KEYS = [
  "inventoryAccountId",
  "cogsAccountId",
  "payableAccountId",
  "receivableAccountId",
  "inputVatAccountId",
  "outputVatAccountId",
  "revenueAccountId",
] as const;
export type IntegrationAccountKey = (typeof INTEGRATION_ACCOUNT_KEYS)[number];
export const INTEGRATION_ACCOUNT_LABELS: Record<IntegrationAccountKey, { label: string; number: string }> = {
  inventoryAccountId: { label: "Áruk", number: "261" },
  cogsAccountId: { label: "Eladott áruk beszerzési értéke (ELÁBÉ)", number: "814" },
  payableAccountId: { label: "Szállítók", number: "454" },
  receivableAccountId: { label: "Vevők", number: "311" },
  inputVatAccountId: { label: "Előzetesen felszámított áfa", number: "466" },
  outputVatAccountId: { label: "Fizetendő áfa", number: "467" },
  revenueAccountId: { label: "Árbevétel", number: "911" },
};

const accountId = z.uuid("Érvénytelen számla.").nullable();
export const integrationSettingsSchema = z.object({
  postingMode: z.enum(POSTING_MODES),
  purchaseDateRule: z.enum(PURCHASE_DATE_RULES),
  accounts: z.object(Object.fromEntries(INTEGRATION_ACCOUNT_KEYS.map((k) => [k, accountId])) as Record<IntegrationAccountKey, typeof accountId>),
});
export type IntegrationSettingsInput = z.infer<typeof integrationSettingsSchema>;

export type IntegrationStatusDto = {
  /** A szerveren be van-e állítva a központ (KOZPONT_URL, KOZPONT_TITOK). */
  hubConfigured: boolean;
  linked: boolean;
  linkedAt: string | null;
  postingMode: PostingMode;
  /** A bevezető hónap vége (eddig javasolt a „csak piszkozat” mód). */
  draftOnlyUntil: string | null;
  purchaseDateRule: PurchaseDateRule;
  accounts: Record<IntegrationAccountKey, string | null>;
  /** Az érvényes (még fel nem használt) kapcsolódási kód lejárata. */
  activeCodeExpiresAt: string | null;
  outbox: { waiting: number; oldest: string | null; lastError: string | null };
};

export type IntegrationTodoKind =
  | "PURCHASE_APPROVAL"
  | "COGS_APPROVAL"
  | "REVERSAL_APPROVAL"
  | "MISSING_DATA"
  | "SOURCE_WITHDRAWN"
  | "INVOICE_MISSING"
  | "PARTNER"
  | "INTRO_MONTH"
  | "HUB_UNREACHABLE"
  | "UNSUPPORTED";

export type IntegrationTodoDto = { id: string; kind: IntegrationTodoKind; title: string; detail: string | null; documentId: string | null; createdAt: string };

/** A bizonylat kapcsolata a többi modullal („honnan jött?”, „mi lett belőle?”). */
export type DocumentIntegrationDto = {
  sources: Array<{ module: string; moduleLabel: string; kind: string; label: string | null; url: string | null; at: string }>;
  /** Beszerzésnél: a jóváhagyónak kell választania a könyvelés dátumát (❓2). */
  dateChoice: { receivedDate: string | null; invoiceDate: string | null } | null;
  /** Sztornó javasolt (a forrást visszavonták): a javasolt dátum és az ok. */
  reversal: { date: string; reason: string | null } | null;
  /** A központ szerint mi lett belőle a többi modulban (ha elérhető). */
  targets: Array<{ module: string; moduleLabel: string; label: string | null; url: string | null }> | null;
  stockLines: Array<{ productId: string; productName: string; quantity: number; unit: string | null; netAmount: number; vatRate: number | null; vatAmount: number }>;
  isCogs: boolean;
};

// ---------- Csoportos jóváhagyás (F14.8) ----------

export type ApprovalKind = "PURCHASE" | "COGS" | "REVERSAL";
export const APPROVAL_KIND_LABELS: Record<ApprovalKind, string> = { PURCHASE: "Beszerzés", COGS: "ELÁBÉ", REVERSAL: "Sztornó" };

export type ApprovalItemDto = {
  documentId: string;
  kind: ApprovalKind;
  date: string;
  partnerName: string | null;
  description: string | null;
  externalNumber: string | null;
  total: number;
  lines: Array<{ accountNumber: string | null; side: "D" | "C" | null; amount: number }>;
  /** Hiánytalan: a könyvelési ellenőrzés most elfogadná. Ha nem, az okok. */
  complete: boolean;
  problems: string[];
  /** Beszerzésnél a választható dátumok (ha a jóváhagyónak kell választania). */
  dateChoice: { receivedDate: string | null; invoiceDate: string | null } | null;
};

export type ApprovalGroupDto = { kind: ApprovalKind; date: string; items: ApprovalItemDto[]; total: number; completeCount: number };

export const approvalRequestSchema = z.object({
  /** A kérés azonosítója: kétszer elküldve sem könyvel kétszer. */
  batchId: z.uuid(),
  documentIds: z.array(z.uuid()).min(1, "Jelöljön ki legalább egy tételt.").max(500),
  /** Beszerzésnél, ha a jóváhagyónak kell választania: mindegyiknél ez a dátum. */
  purchaseDate: z.enum(["RECEIVED", "INVOICE"]).optional(),
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export type ApprovalResultDto = {
  batchId: string;
  results: Array<{ documentId: string; ok: boolean; serialNumber: string | null; message: string | null }>;
};

export const MODULE_DISPLAY: Record<string, string> = { konyvelo: "Könyvelő", keszlet: "Készletfigyelő", eafa: "eÁFA" };
