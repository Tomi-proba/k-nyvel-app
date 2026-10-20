import { z } from "zod";
import { ACCOUNT_NATURES, SUBLEDGERS, validateAccountNumber, validateBankAccount, validateTaxNumber, type AccountNature, type NormalSide, type Subledger } from "@konyvelo/domain";

/** Számlatükör és partnerek: bemeneti sémák és API-típusok. */

const text = (label: string, max: number) =>
  z
    .string({ error: `${label}: kötelező mező.` })
    .trim()
    .min(1, `${label}: kötelező mező.`)
    .max(max, `${label}: legfeljebb ${max} karakter lehet.`);

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label}: legfeljebb ${max} karakter lehet.`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

// ---------- Számlatükör ----------

export const accountCreateSchema = z.object({
  number: z
    .string({ error: "Számlaszám: kötelező mező." })
    .trim()
    .superRefine((v, ctx) => {
      const msg = validateAccountNumber(v);
      if (msg) ctx.addIssue({ code: "custom", message: msg });
    }),
  name: text("Megnevezés", 200),
  nature: z.enum(ACCOUNT_NATURES as [AccountNature, ...AccountNature[]], { error: "Válassza ki a számla jellegét." }).optional(),
  normalSide: z.enum(["D", "C"], { error: "Válassza ki a szokásos egyenleg oldalát." }).optional(),
  subledger: z.enum(SUBLEDGERS as [Subledger, ...Subledger[]], { error: "Válasszon analitikát." }).optional(),
  description: optionalText("Leírás", 1000),
});
export type AccountCreateInput = z.infer<typeof accountCreateSchema>;

/** A számlaszám utólag nem módosítható (a hierarchia és a könyvelések miatt). */
export const accountUpdateSchema = z.object({
  name: text("Megnevezés", 200).optional(),
  nature: z.enum(ACCOUNT_NATURES as [AccountNature, ...AccountNature[]]).optional(),
  normalSide: z.enum(["D", "C"]).optional(),
  subledger: z.enum(SUBLEDGERS as [Subledger, ...Subledger[]]).optional(),
  description: optionalText("Leírás", 1000),
  isActive: z.boolean().optional(),
});
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;

export type AccountDto = {
  id: string;
  number: string;
  name: string;
  accountClass: number;
  nature: AccountNature;
  normalSide: NormalSide;
  subledger: Subledger;
  description: string | null;
  isActive: boolean;
  /** Hierarchiaszint (0 = számlaosztály). */
  level: number;
  /** Van-e alszámlája – gyűjtőszámlára nem lehet könyvelni. */
  hasChildren: boolean;
  parentNumber: string | null;
};

// ---------- Partnerek ----------

export const PARTNER_KINDS = ["CUSTOMER", "SUPPLIER", "BOTH"] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];
export const PARTNER_KIND_LABELS: Record<PartnerKind, string> = {
  CUSTOMER: "Vevő",
  SUPPLIER: "Szállító",
  BOTH: "Vevő és szállító",
};

export const PARTNER_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number] | "ANONYMIZED";
export const PARTNER_STATUS_LABELS: Record<PartnerStatus, string> = {
  ACTIVE: "Aktív",
  INACTIVE: "Inaktív",
  ANONYMIZED: "Anonimizált",
};

const uuidOrNull = z
  .union([z.uuid("Érvénytelen számla."), z.literal(""), z.null()])
  .transform((v) => (v === "" ? null : v))
  .optional();

const partnerFields = {
  kind: z.enum(PARTNER_KINDS, { error: "Válassza ki, hogy vevő vagy szállító." }),
  name: text("Név", 300),
  isPrivatePerson: z.boolean(),
  taxNumber: optionalText("Adószám", 20).transform((v, ctx) => {
    if (v == null) return v;
    const r = validateTaxNumber(v);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: r.message });
      return z.NEVER;
    }
    return r.normalized;
  }),
  communityVatNumber: optionalText("Közösségi adószám", 20).refine(
    (v) => v == null || /^[A-Z]{2}[0-9A-Z+*.]{2,13}$/.test(v),
    "A közösségi adószám formája: országkód + szám, pl. HU12345678 vagy DE123456789.",
  ),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Az ország kétbetűs kódja kell (pl. HU, DE, AT)."),
  postalCode: optionalText("Irányítószám", 12),
  city: optionalText("Település", 100),
  addressLine: optionalText("Cím", 200),
  bankAccount: optionalText("Bankszámlaszám", 50).transform((v, ctx) => {
    if (v == null) return v;
    const r = validateBankAccount(v);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: r.message });
      return z.NEVER;
    }
    return r.normalized;
  }),
  email: optionalText("E-mail-cím", 200).refine((v) => v == null || z.email().safeParse(v).success, "Érvénytelen e-mail-cím."),
  phone: optionalText("Telefonszám", 50),
  paymentTermsDays: z
    .number({ error: "A fizetési határidő napokban megadott egész szám." })
    .int("A fizetési határidő napokban megadott egész szám.")
    .min(0, "A fizetési határidő nem lehet negatív.")
    .max(365, "A fizetési határidő legfeljebb 365 nap.")
    .nullable()
    .optional(),
  defaultReceivableAccountId: uuidOrNull,
  defaultPayableAccountId: uuidOrNull,
  defaultExpenseAccountId: uuidOrNull,
  defaultRevenueAccountId: uuidOrNull,
  notes: optionalText("Megjegyzés", 2000),
};

function partnerRules<T extends { country?: string; isPrivatePerson?: boolean; taxNumber?: string | null }>(v: T, ctx: z.RefinementCtx) {
  if (v.taxNumber && v.country && v.country !== "HU") {
    ctx.addIssue({ code: "custom", path: ["taxNumber"], message: "Magyar adószám csak magyarországi partnernél adható meg; külföldinél a közösségi adószámot használja." });
  }
  if (v.taxNumber && v.isPrivatePerson) {
    ctx.addIssue({ code: "custom", path: ["taxNumber"], message: "Magánszemélynél ne adjon meg adószámot (adattakarékosság)." });
  }
}

/** Létrehozáskor alapértékekkel; módosításkor (lent) alapérték nélkül, hogy a nem küldött mező ne íródjon felül. */
export const partnerCreateSchema = z
  .object({ ...partnerFields, isPrivatePerson: partnerFields.isPrivatePerson.default(false), country: partnerFields.country.default("HU") })
  .superRefine(partnerRules);
export type PartnerCreateInput = z.infer<typeof partnerCreateSchema>;

export const partnerUpdateSchema = z
  .object({ ...partnerFields, status: z.enum(PARTNER_STATUSES).optional() })
  .partial()
  .superRefine(partnerRules);
export type PartnerUpdateInput = z.infer<typeof partnerUpdateSchema>;

export type PartnerDto = {
  id: string;
  kind: PartnerKind;
  name: string;
  isPrivatePerson: boolean;
  taxNumber: string | null;
  communityVatNumber: string | null;
  country: string;
  postalCode: string | null;
  city: string | null;
  addressLine: string | null;
  bankAccount: string | null;
  email: string | null;
  phone: string | null;
  paymentTermsDays: number | null;
  defaultReceivableAccountId: string | null;
  defaultPayableAccountId: string | null;
  defaultExpenseAccountId: string | null;
  defaultRevenueAccountId: string | null;
  notes: string | null;
  status: PartnerStatus;
  createdAt: string;
};
