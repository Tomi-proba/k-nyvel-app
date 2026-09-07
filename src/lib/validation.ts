import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Add meg a neved."),
  email: z.string().trim().toLowerCase().email("Érvénytelen email cím."),
  password: z.string().min(8, "A jelszó legalább 8 karakter legyen."),
  companyName: z.string().trim().min(1, "Add meg a céged nevét."),
  companyTaxNumber: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Érvénytelen email cím."),
  password: z.string().min(1, "Add meg a jelszavad."),
});

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const optionalDecimal = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || !Number.isNaN(Number(v.replace(",", "."))), {
    message: "Érvénytelen szám.",
  });

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || !Number.isNaN(Date.parse(v)), {
    message: "Érvénytelen dátum.",
  });

export const invoiceUpdateSchema = z.object({
  direction: z.enum(["INCOME", "EXPENSE"]),
  partnerNameRaw: optionalString,
  partnerTaxNumber: optionalString,
  issueDate: optionalDate,
  dueDate: optionalDate,
  netAmount: optionalDecimal,
  vatAmount: optionalDecimal,
  grossAmount: optionalDecimal,
  vatRate: optionalDecimal,
  categoryId: optionalString,
  notes: optionalString,
});

export const newCompanySchema = z.object({
  name: z.string().trim().min(1, "Add meg a cég nevét."),
  taxNumber: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  address: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
});
