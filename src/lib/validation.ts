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
