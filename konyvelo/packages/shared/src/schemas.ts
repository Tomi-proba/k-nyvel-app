import { z } from "zod";
import { isValidIsoDate, REVERSAL_METHODS, validateTaxNumber, type ReversalMethod } from "@konyvelo/domain";
import { ROLES } from "./roles";

/**
 * Bemeneti sémák. Ugyanezek ellenőrzik az űrlapokat a felületen (azonnali
 * hibaüzenet) és a kéréseket a szerveren (utolsó ellenőrzés).
 */

export const PASSWORD_MIN_LENGTH = 12;

const trimmed = (label: string, max = 200) =>
  z
    .string({ error: `${label}: kötelező mező.` })
    .trim()
    .min(1, `${label}: kötelező mező.`)
    .max(max, `${label}: legfeljebb ${max} karakter lehet.`);

const optionalTrimmed = (label: string, max = 200) =>
  z
    .string()
    .trim()
    .max(max, `${label}: legfeljebb ${max} karakter lehet.`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const emailSchema = z
  .string({ error: "E-mail-cím: kötelező mező." })
  .trim()
  .toLowerCase()
  .pipe(z.email("Érvénytelen e-mail-cím."));

export const passwordSchema = z
  .string({ error: "Jelszó: kötelező mező." })
  .min(PASSWORD_MIN_LENGTH, `A jelszó legalább ${PASSWORD_MIN_LENGTH} karakter legyen.`)
  .max(200, "A jelszó legfeljebb 200 karakter lehet.");

export const isoDateSchema = (label: string) =>
  z
    .string({ error: `${label}: kötelező mező.` })
    .refine(isValidIsoDate, `${label}: érvénytelen dátum (ÉÉÉÉ.HH.NN.).`);

// ---------- Hitelesítés ----------

export const setupSchema = z.object({
  name: trimmed("Név"),
  email: emailSchema,
  password: passwordSchema,
});
export type SetupInput = z.infer<typeof setupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: "Jelszó: kötelező mező." }).min(1, "Jelszó: kötelező mező."),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string({ error: "Jelenlegi jelszó: kötelező mező." }).min(1, "Jelenlegi jelszó: kötelező mező."),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ["newPassword"],
    message: "Az új jelszó nem egyezhet meg a jelenlegivel.",
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ---------- Cég ----------

export const REPORT_TYPES = ["SIMPLIFIED_ANNUAL", "MICRO"] as const;
export const REPORT_TYPE_LABELS: Record<(typeof REPORT_TYPES)[number], string> = {
  SIMPLIFIED_ANNUAL: "Egyszerűsített éves beszámoló",
  MICRO: "Mikrogazdálkodói egyszerűsített éves beszámoló",
};

export const FX_RATE_SOURCES = ["MNB", "ECB", "BANK", "VAT_ACT"] as const;
export const FX_RATE_SOURCE_LABELS: Record<(typeof FX_RATE_SOURCES)[number], string> = {
  MNB: "MNB hivatalos árfolyam",
  ECB: "Európai Központi Bank árfolyama",
  BANK: "Választott hitelintézet vételi és eladási árfolyamának átlaga",
  VAT_ACT: "Az áfatörvény szerinti árfolyam",
};

export const taxNumberSchema = z
  .string({ error: "Adószám: kötelező mező." })
  .trim()
  .transform((value, ctx) => {
    const r = validateTaxNumber(value);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: r.message });
      return z.NEVER;
    }
    return r.normalized;
  });

const companyFields = {
  name: trimmed("Cégnév", 300),
  shortName: trimmed("Rövid név", 60),
  taxNumber: taxNumberSchema,
  communityVatNumber: optionalTrimmed("Közösségi adószám", 20).refine(
    (v) => v == null || /^HU\d{8}$/.test(v),
    "A közösségi adószám formája: HU12345678.",
  ),
  registrationNumber: optionalTrimmed("Cégjegyzékszám", 20).refine(
    (v) => v == null || /^\d{2}-\d{2}-\d{6}$/.test(v),
    "A cégjegyzékszám formája: 01-09-123456.",
  ),
  addressPostalCode: optionalTrimmed("Irányítószám", 10).refine(
    (v) => v == null || /^\d{4}$/.test(v),
    "Az irányítószám 4 számjegy.",
  ),
  addressCity: optionalTrimmed("Település", 100),
  addressLine: optionalTrimmed("Cím", 200),
  representativeName: optionalTrimmed("Képviselő neve", 200),
  reportType: z.enum(REPORT_TYPES, { error: "Válasszon beszámolóformát." }),
  significantErrorThreshold: z
    .number({ error: "Érvénytelen összeg. Példa: 1 000 000" })
    .int("A jelentős hiba értékhatára egész fillér legyen.")
    .min(0, "A jelentős hiba értékhatára nem lehet negatív.")
    .nullable()
    .optional(),
  fxRateSource: z.enum(FX_RATE_SOURCES, { error: "Válasszon árfolyamforrást." }),
  reversalMethod: z.enum(REVERSAL_METHODS as [ReversalMethod, ...ReversalMethod[]], { error: "Válassza ki a sztornó módját." }),
};

export const companyCreateSchema = z.object({ ...companyFields, reversalMethod: companyFields.reversalMethod.default("SWAP") });
export type CompanyCreateInput = z.infer<typeof companyCreateSchema>;

export const companyUpdateSchema = z.object(companyFields).partial();
export type CompanyUpdateInput = z.infer<typeof companyUpdateSchema>;

// ---------- Tagság ----------

export const memberAddSchema = z.object({
  email: emailSchema,
  name: optionalTrimmed("Név", 200),
  role: z.enum(ROLES, { error: "Válasszon szerepkört." }),
  initialPassword: passwordSchema.optional(),
});
export type MemberAddInput = z.infer<typeof memberAddSchema>;

export const memberUpdateSchema = z.object({
  role: z.enum(ROLES, { error: "Válasszon szerepkört." }),
});
export type MemberUpdateInput = z.infer<typeof memberUpdateSchema>;

// ---------- Üzleti év ----------

export const fiscalYearCreateSchema = z.object({
  startDate: isoDateSchema("Kezdő dátum"),
  endDate: isoDateSchema("Mérlegfordulónap"),
  exceptionReason: optionalTrimmed("Indoklás", 500),
});
export type FiscalYearCreateInput = z.infer<typeof fiscalYearCreateSchema>;

/** Zod-hibák mezőnkénti magyar üzenetekké alakítása (az első hiba mezőnként). */
export function fieldErrorsFromZod(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
