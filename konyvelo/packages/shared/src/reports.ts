import type { DocumentType, StatementLine } from "@konyvelo/domain";

/** Kimutatások (PLAN 4.10): API-típusok. Minden összeg fillérben. */

export type ReportCompany = {
  name: string;
  taxNumber: string;
  registrationNumber: string | null;
  address: string | null;
  representativeName: string | null;
  audited: boolean;
};

type DC = { debit: number; credit: number };

export type TrialBalanceRow = {
  accountId: string;
  number: string;
  name: string;
  accountClass: number;
  opening: DC;
  period: DC;
  cumulative: DC;
  closing: DC;
};

export type TrialBalanceDto = {
  company: ReportCompany;
  from: string;
  to: string;
  fiscalYear: { startDate: string; endDate: string };
  rows: TrialBalanceRow[];
  classTotals: Array<{ accountClass: number; label: string; opening: DC; period: DC; cumulative: DC; closing: DC }>;
  /**
   * A korábbi, még le nem zárt üzleti évek eredménye: az évzárásig egyik
   * mérlegszámlán sincs rajta, ezért külön sorként szerepel (a nyitó és a
   * záró oszlopban), így az összesen-sor egyensúlyban marad.
   */
  unclosedPriorResult: DC | null;
  totals: { opening: DC; period: DC; cumulative: DC; closing: DC };
};

export type JournalDto = {
  company: ReportCompany;
  from: string;
  to: string;
  rows: Array<{
    documentId: string;
    serialNumber: string;
    docType: DocumentType;
    date: string;
    partnerName: string | null;
    description: string | null;
    accountNumber: string;
    accountName: string;
    debit: number;
    credit: number;
  }>;
  totals: DC;
  /** Túl sok sor esetén csak az első 20 000 látszik. */
  truncated: boolean;
};

export type LedgerDto = {
  company: ReportCompany;
  account: { id: string; number: string; name: string } | null;
  partner: { id: string; name: string } | null;
  from: string;
  to: string;
  opening: number;
  rows: Array<{
    documentId: string;
    serialNumber: string;
    date: string;
    accountNumber: string;
    partnerName: string | null;
    description: string | null;
    debit: number;
    credit: number;
    balance: number;
  }>;
  totals: DC;
  closing: number;
};

export type StatementLineDto = StatementLine & { previous: number | null };

export type StatementDto = {
  company: ReportCompany;
  /** Mérlegnél a fordulónap, eredménykimutatásnál az időszak. */
  from: string | null;
  to: string;
  previous: { from: string | null; to: string } | null;
  lines: StatementLineDto[];
  /** Mérleg: eszközök és források összesen (tárgyév, előző év). */
  totals: { assets: number; sources: number; previousAssets: number | null; previousSources: number | null } | null;
  /** Kimutatássor nélküli számlák, amelyeknek egyenlege van (ezek miatt nem egyezhet a mérleg). */
  unmapped: Array<{ number: string; name: string; amount: number }>;
};

/** A belső kimutatások szövegei (a megrendelő kérése szerint). */
export const INTERNAL_STATEMENT_HEADER = "Belső kimutatás – nem minősül közzétett beszámolónak";
export const INTERNAL_STATEMENT_FOOTER = "A kimutatás a könyvelt tételek alapján készült.";
/** Szt. 154. § (3): könyvvizsgálattal nem ellenőrzött, közzétett beszámolón kötelező. */
export const NOT_AUDITED_NOTICE = "A közzétett adatok könyvvizsgálattal nincsenek alátámasztva.";
