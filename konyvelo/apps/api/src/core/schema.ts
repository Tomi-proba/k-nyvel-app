/**
 * Drizzle tábladefiníciók a típusos lekérdezésekhez. Az adatbázis tényleges
 * szerkezetét (megkötések, triggerek) a migrations/*.sql fájlok határozzák
 * meg; ennek a fájlnak velük összhangban kell maradnia.
 */
import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, char, date, integer, jsonb, numeric, pgTable, primaryKey, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { AccountNature, AmountBase, DocumentType, LineSide, NormalSide, Subledger } from "@konyvelo/domain";

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
  reversalMethod: text("reversal_method").notNull().default("SWAP").$type<"SWAP" | "NEGATIVE">(),
  cashClosingLimit: bigint("cash_closing_limit", { mode: "number" }),
  audited: boolean("audited").notNull().default(false),
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

const d = (name: string) => date(name, { mode: "string" });

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  fiscalYearId: uuid("fiscal_year_id").notNull(),
  docType: text("doc_type").notNull().$type<DocumentType>(),
  status: text("status").notNull().default("DRAFT").$type<"DRAFT" | "POSTED">(),
  seqNo: integer("seq_no"),
  serialNumber: text("serial_number"),
  externalNumber: text("external_number"),
  partnerId: uuid("partner_id"),
  description: text("description"),
  issueDate: d("issue_date"),
  fulfillmentDate: d("fulfillment_date"),
  accountingDate: d("accounting_date").notNull(),
  dueDate: d("due_date"),
  currency: char("currency", { length: 3 }).notNull().default("HUF"),
  fxAmount: bigint("fx_amount", { mode: "number" }),
  fxRate: numeric("fx_rate", { precision: 18, scale: 6, mode: "number" }),
  fxRateSource: text("fx_rate_source").$type<"MNB" | "ECB" | "BANK" | "VAT_ACT">(),
  fxRateDate: d("fx_rate_date"),
  authorizedBy: text("authorized_by"),
  checkedBy: text("checked_by"),
  reversesDocumentId: uuid("reverses_document_id"),
  correctsDocumentId: uuid("corrects_document_id"),
  affectsFiscalYearId: uuid("affects_fiscal_year_id"),
  source: text("source").notNull().default("MANUAL"),
  templateId: uuid("template_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  postedAt: ts("posted_at"),
  postedBy: uuid("posted_by"),
  contentHash: text("content_hash"),
  prevHash: text("prev_hash"),
  retentionUntil: d("retention_until"),
  archiveStatus: text("archive_status").notNull().default("NONE"),
  authenticityMethod: text("authenticity_method").notNull().default("NONE"),
  authenticityRef: text("authenticity_ref"),
  settlementPlan: jsonb("settlement_plan").notNull().default([]).$type<Array<{ itemLineId: string; amount: number }>>(),
});

export const settlements = pgTable("settlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  itemLineId: uuid("item_line_id").notNull(),
  settlingLineId: uuid("settling_line_id").notNull(),
  amount: bigint("amount", { mode: "number" }).notNull(),
  source: text("source").notNull().$type<"ENTRY" | "MANUAL" | "REVERSAL">(),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export const journalLines = pgTable("journal_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  documentId: uuid("document_id").notNull(),
  lineNo: smallint("line_no").notNull(),
  accountId: uuid("account_id"),
  side: char("side", { length: 1 }).$type<LineSide>(),
  amount: bigint("amount", { mode: "number" }).notNull().default(0),
  partnerId: uuid("partner_id"),
  description: text("description"),
});

export const documentSequences = pgTable(
  "document_sequences",
  {
    companyId: uuid("company_id").notNull(),
    fiscalYearId: uuid("fiscal_year_id").notNull(),
    docType: text("doc_type").notNull(),
    lastNumber: integer("last_number").notNull(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.fiscalYearId, t.docType] })],
);

export const postingTemplates = pgTable("posting_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  shortcut: text("shortcut"),
  docType: text("doc_type").$type<DocumentType>(),
  description: text("description"),
  vatRate: smallint("vat_rate"),
  partnerId: uuid("partner_id"),
  lines: jsonb("lines").notNull().$type<Array<{ accountId: string; side: LineSide; base: AmountBase }>>(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ---------- NAV Online Számla import (7. lépés) ----------

export type NavDirection = "INBOUND" | "OUTBOUND";
export type NavEnvironment = "TEST" | "PRODUCTION";
export type NavRemoteState = "OK" | "NOT_TESTED" | "BROKEN" | "UNREACHABLE" | "NOT_CONFIGURED" | "REVOKED";

export const navConnections = pgTable("nav_connections", {
  companyId: uuid("company_id").primaryKey(),
  linkId: uuid("link_id").notNull(),
  environment: text("environment").notNull().$type<NavEnvironment>(),
  eafaTaxpayerName: text("eafa_taxpayer_name").notNull(),
  eafaTaxNumber: text("eafa_tax_number").notNull(),
  linkedAt: ts("linked_at").notNull().defaultNow(),
  linkedBy: uuid("linked_by").notNull(),
  remoteState: text("remote_state").$type<NavRemoteState>(),
  remoteTitle: text("remote_title"),
  remoteAction: text("remote_action"),
  remoteCheckedAt: ts("remote_checked_at"),
});

export const navImportRuns = pgTable("nav_import_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  direction: text("direction").notNull().$type<NavDirection>(),
  dateFrom: d("date_from").notNull(),
  dateTo: d("date_to").notNull(),
  status: text("status").notNull().default("RUNNING").$type<"RUNNING" | "DONE" | "FAILED">(),
  windowsTotal: integer("windows_total").notNull(),
  windowsDone: integer("windows_done").notNull().default(0),
  foundCount: integer("found_count").notNull().default(0),
  newCount: integer("new_count").notNull().default(0),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  startedAt: ts("started_at").notNull().defaultNow(),
  startedBy: uuid("started_by").notNull(),
  finishedAt: ts("finished_at"),
});

export const navInvoices = pgTable("nav_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  direction: text("direction").notNull().$type<NavDirection>(),
  invoiceNumber: text("invoice_number").notNull(),
  operation: text("operation").notNull().$type<"CREATE" | "MODIFY" | "STORNO">(),
  modificationIndex: integer("modification_index").notNull().default(0),
  originalInvoiceNumber: text("original_invoice_number"),
  invoiceCategory: text("invoice_category"),
  supplierTaxNumber: text("supplier_tax_number").notNull(),
  supplierName: text("supplier_name"),
  customerTaxNumber: text("customer_tax_number"),
  customerName: text("customer_name"),
  issueDate: d("issue_date").notNull(),
  deliveryDate: d("delivery_date"),
  paymentDate: d("payment_date"),
  paymentMethod: text("payment_method"),
  currency: text("currency"),
  netAmountHuf: bigint("net_amount_huf", { mode: "number" }),
  vatAmountHuf: bigint("vat_amount_huf", { mode: "number" }),
  completenessIndicator: boolean("completeness_indicator"),
  insDate: ts("ins_date"),
  rawDigest: jsonb("raw_digest").notNull(),
  invoiceData: jsonb("invoice_data"),
  invoiceXmlBase64: text("invoice_xml_base64"),
  dataFetchedAt: ts("data_fetched_at"),
  status: text("status").notNull().default("NEW").$type<"NEW" | "IGNORED">(),
  ignoredReason: text("ignored_reason"),
  documentId: uuid("document_id"),
  firstRunId: uuid("first_run_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
