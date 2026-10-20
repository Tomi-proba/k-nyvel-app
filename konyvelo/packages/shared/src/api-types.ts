import type { Role } from "./roles";
import type { FX_RATE_SOURCES, REPORT_TYPES } from "./schemas";

/** Egységes hibaválasz: { error: { code, message, fields? } } */
export type ApiError = {
  code: string;
  message: string;
  fields?: Record<string, string>;
};

/** Egyedi fejléc minden módosító kéréshez (CSRF-védelem). */
export const CSRF_HEADER = "x-konyvelo-csrf";

export type MeResponse = {
  user: { id: string; email: string; name: string; mustChangePassword: boolean };
  companies: Array<{ id: string; name: string; shortName: string; role: Role }>;
};

export type CompanyDto = {
  id: string;
  name: string;
  shortName: string;
  taxNumber: string;
  communityVatNumber: string | null;
  registrationNumber: string | null;
  addressPostalCode: string | null;
  addressCity: string | null;
  addressLine: string | null;
  representativeName: string | null;
  bookCurrency: "HUF";
  balanceSheetVariant: "A";
  incomeStatementMethod: "TOTAL_COST";
  reportType: (typeof REPORT_TYPES)[number];
  significantErrorThreshold: number | null;
  fxRateSource: (typeof FX_RATE_SOURCES)[number];
  /** A sztornó módja: fordított oldalon vagy negatív előjellel. */
  reversalMethod: "SWAP" | "NEGATIVE";
  /** A pénzkezelési szabályzat szerinti napi pénztár-záróegyenleg maximuma (fillér). */
  cashClosingLimit: number | null;
  createdAt: string;
};

export type MemberDto = {
  userId: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
};

export type PeriodDto = {
  id: string;
  startDate: string;
  endDate: string;
  status: "OPEN" | "CLOSED";
};

export type FiscalYearDto = {
  id: string;
  startDate: string;
  endDate: string;
  status: "OPEN" | "CLOSING" | "CLOSED";
  exceptionReason: string | null;
  retentionUntil: string | null;
  periods: PeriodDto[];
};

export type AuditEntryDto = {
  id: string;
  at: string;
  userName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
};

export type AuditVerifyResponse =
  | { ok: true; count: number }
  | { ok: false; count: number; brokenAtId: string; reason: "HASH_MISMATCH" | "LINK_BROKEN" };
