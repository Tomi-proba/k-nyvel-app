/**
 * Drizzle tábladefiníciók a típusos lekérdezésekhez. Az adatbázis tényleges
 * szerkezetét (megkötések, triggerek) a migrations/*.sql fájlok határozzák
 * meg; ennek a fájlnak velük összhangban kell maradnia.
 */
import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, char, date, jsonb, pgTable, primaryKey, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { AccountNature, NormalSide, Subledger } from "@konyvelo/domain";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  lastLoginAt: ts("last_login_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by"),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
});

export const authEvents = pgTable("auth_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id"),
  email: text("email"),
  event: text("event").notNull().$type<"LOGIN_SUCCESS" | "LOGIN_FAILURE" | "LOGIN_BLOCKED" | "LOGOUT" | "PASSWORD_CHANGED">(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  at: ts("at").notNull().defaultNow(),
});

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  taxNumber: text("tax_number").notNull(),
  communityVatNumber: text("community_vat_number"),
  registrationNumber: text("registration_number"),
  addressPostalCode: text("address_postal_code"),
  addressCity: text("address_city"),
  addressLine: text("address_line"),
  representativeName: text("representative_name"),
  bookCurrency: char("book_currency", { length: 3 }).notNull().default("HUF").$type<"HUF">(),
  balanceSheetVariant: char("balance_sheet_variant", { length: 1 }).notNull().default("A").$type<"A">(),
  incomeStatementMethod: text("income_statement_method").notNull().default("TOTAL_COST").$type<"TOTAL_COST">(),
  reportType: text("report_type").notNull().default("SIMPLIFIED_ANNUAL").$type<"SIMPLIFIED_ANNUAL" | "MICRO">(),
  significantErrorThreshold: bigint("significant_error_threshold", { mode: "number" }),
  fxRateSource: text("fx_rate_source").notNull().default("MNB").$type<"MNB" | "ECB" | "BANK" | "VAT_ACT">(),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const companyMemberships = pgTable(
  "company_memberships",
  {
    companyId: uuid("company_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: text("role").notNull().$type<"ADMIN" | "CHIEF_ACCOUNTANT" | "ACCOUNTANT" | "VIEWER">(),
    createdAt: ts("created_at").notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.userId] })],
);

export const fiscalYears = pgTable("fiscal_years", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  status: text("status").notNull().default("OPEN").$type<"OPEN" | "CLOSING" | "CLOSED">(),
  exceptionReason: text("exception_reason"),
  closedAt: ts("closed_at"),
  closedBy: uuid("closed_by"),
  retentionUntil: date("retention_until", { mode: "string" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export const periods = pgTable("periods", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  fiscalYearId: uuid("fiscal_year_id").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  status: text("status").notNull().default("OPEN").$type<"OPEN" | "CLOSED">(),
  closedAt: ts("closed_at"),
  closedBy: uuid("closed_by"),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  companyId: uuid("company_id"),
  userId: uuid("user_id"),
  at: timestamp("at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  ip: text("ip"),
  prevHash: text("prev_hash"),
  hash: text("hash").notNull(),
});

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  number: text("number").notNull(),
  // Generált oszlop az adatbázisban (a számlaszám első jegye) – csak olvasásra.
  accountClass: smallint("account_class").generatedAlwaysAs(sql`substr(number, 1, 1)::smallint`),
  name: text("name").notNull(),
  nature: text("nature").notNull().$type<AccountNature>(),
  normalSide: char("normal_side", { length: 1 }).notNull().$type<NormalSide>(),
  subledger: text("subledger").notNull().default("NONE").$type<Subledger>(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  bsLineDebit: text("bs_line_debit"),
  bsLineCredit: text("bs_line_credit"),
  isLine: text("is_line"),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const partners = pgTable("partners", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  kind: text("kind").notNull().$type<"CUSTOMER" | "SUPPLIER" | "BOTH">(),
  name: text("name").notNull(),
  isPrivatePerson: boolean("is_private_person").notNull().default(false),
  taxNumber: text("tax_number"),
  communityVatNumber: text("community_vat_number"),
  country: char("country", { length: 2 }).notNull().default("HU"),
  postalCode: text("postal_code"),
  city: text("city"),
  addressLine: text("address_line"),
  bankAccount: text("bank_account"),
  email: text("email"),
  phone: text("phone"),
  paymentTermsDays: smallint("payment_terms_days"),
  defaultReceivableAccountId: uuid("default_receivable_account_id"),
  defaultPayableAccountId: uuid("default_payable_account_id"),
  defaultExpenseAccountId: uuid("default_expense_account_id"),
  defaultRevenueAccountId: uuid("default_revenue_account_id"),
  notes: text("notes"),
  status: text("status").notNull().default("ACTIVE").$type<"ACTIVE" | "INACTIVE" | "ANONYMIZED">(),
  anonymizedAt: ts("anonymized_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
