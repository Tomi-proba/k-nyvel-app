// A Könyvelő útvonalai: önállóan a saját fejlécével (AppLayout), a keretben a keret alatt (KeretLayout).
import type { ReactElement } from "react";
import { Route, Routes } from "react-router";
import type { MeResponse } from "@konyvelo/shared";
import { Navigate } from "../keret/router";
import { NEW_ENTRY_PATH } from "./AppLayout";
import { ChartOfAccountsPage } from "../features/accounts/ChartOfAccountsPage";
import { DocumentPage, DocumentsPage, NewDocumentPage } from "../features/documents/DocumentsPages";
import { MoneyPage } from "../features/subledger/MoneyPage";
import { ClosingPage, OpeningPage } from "../features/closing/ClosingPages";
import { BalanceSheetPage, IncomeStatementPage, JournalPage, LedgerPage, TrialBalancePage } from "../features/reports/ReportsPages";
import { OpenItemsPage, ReconciliationPage } from "../features/subledger/SubledgerPages";
import { HomePage } from "../features/home/HomePage";
import { HelpPage } from "../features/help/HelpPage";
import { BackupExportPage } from "../features/settings/BackupExportPage";
import { NavConnectionPage, NavImportPage, NavInvoicePage } from "../features/nav/NavPages";
import { NewPartnerPage, PartnerDetailPage, PartnersPage } from "../features/partners/PartnersPages";
import { AuditLogPage } from "../features/settings/AuditLogPage";
import { FiscalYearsPage } from "../features/settings/FiscalYearsPage";
import { MembersPage } from "../features/settings/MembersPage";
import { TemplatesPage } from "../features/settings/TemplatesPage";
import { ApprovalsPage, IntegrationSettingsPage } from "../features/integration/IntegrationPages";
import { CompanySettingsPage, NewCompanyPage, PasswordPage, SettingsLayout } from "../features/settings/SettingsPages";
import { NotFound } from "./NotFound";

export function Utvonalak({ me, layout }: { me: MeResponse; layout: ReactElement }) {
  return (
    <Routes>
      <Route element={layout}>
        <Route index element={<HomePage />} />
        <Route path="konyveles" element={<DocumentsPage />} />
        <Route path={NEW_ENTRY_PATH.slice(1)} element={<NewDocumentPage />} />
        <Route path="konyveles/penzeszkozok" element={<MoneyPage />} />
        <Route path="konyveles/nav-import" element={<NavImportPage />} />
        <Route path="konyveles/jovahagyas" element={<ApprovalsPage />} />
        <Route path="konyveles/nav-import/:invoiceId" element={<NavInvoicePage />} />
        <Route path="konyveles/:documentId" element={<DocumentPage />} />
        <Route path="partnerek" element={<PartnersPage />} />
        <Route path="partnerek/uj" element={<NewPartnerPage />} />
        <Route path="partnerek/nyitott-tetelek" element={<OpenItemsPage />} />
        <Route path="partnerek/egyeztetes" element={<ReconciliationPage />} />
        <Route path="partnerek/:partnerId" element={<PartnerDetailPage />} />
        <Route path="kimutatasok" element={<TrialBalancePage />} />
        <Route path="kimutatasok/naplo" element={<JournalPage />} />
        <Route path="kimutatasok/karton" element={<LedgerPage />} />
        <Route path="kimutatasok/merleg" element={<BalanceSheetPage />} />
        <Route path="kimutatasok/eredmeny" element={<IncomeStatementPage />} />
        <Route path="zaras" element={<ClosingPage />} />
        <Route path="zaras/nyitas" element={<OpeningPage />} />
        <Route path="sugo" element={<HelpPage />} />
        <Route path="beallitasok" element={<SettingsLayout />}>
          <Route index element={<Navigate to={me.companies.length ? "ceg" : "jelszo"} replace />} />
          <Route path="ceg" element={<CompanySettingsPage />} />
          <Route path="uzleti-evek" element={<FiscalYearsPage />} />
          <Route path="szamlatukor" element={<ChartOfAccountsPage />} />
          <Route path="sablonok" element={<TemplatesPage />} />
          <Route path="nav-kapcsolat" element={<NavConnectionPage />} />
          <Route path="integracio" element={<IntegrationSettingsPage />} />
          <Route path="mentes" element={<BackupExportPage />} />
          <Route path="felhasznalok" element={<MembersPage />} />
          <Route path="naplo" element={<AuditLogPage />} />
          <Route path="jelszo" element={<PasswordPage />} />
        </Route>
        <Route path="cegek/uj" element={<SettingsLayout />}>
          <Route index element={<NewCompanyPage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
