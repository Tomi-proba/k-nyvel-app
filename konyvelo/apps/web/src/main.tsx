import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router";
import type { MeResponse } from "@konyvelo/shared";
import { AppLayout, NEW_ENTRY_PATH } from "./app/AppLayout";
import { WorkspaceProvider } from "./app/workspace";
import { ForcedPasswordChangePage, LoginPage, SetupPage } from "./features/auth/AuthPages";
import { ChartOfAccountsPage } from "./features/accounts/ChartOfAccountsPage";
import { HomePage } from "./features/home/HomePage";
import { NewPartnerPage, PartnerDetailPage, PartnersPage } from "./features/partners/PartnersPages";
import { ComingSoon } from "./features/placeholders/ComingSoon";
import { AuditLogPage } from "./features/settings/AuditLogPage";
import { FiscalYearsPage } from "./features/settings/FiscalYearsPage";
import { MembersPage } from "./features/settings/MembersPage";
import { CompanySettingsPage, NewCompanyPage, PasswordPage, SettingsLayout } from "./features/settings/SettingsPages";
import { ApiError, get } from "./lib/api";
import { Loading, PageHeader } from "./ui/Page";
import { ToastProvider } from "./ui/Toasts";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

function NotFound() {
  return (
    <>
      <PageHeader title="Az oldal nem található" />
      <p>
        Ez a cím nem létezik. <Link to="/">Vissza a kezdőlapra</Link>
      </p>
    </>
  );
}

function Root() {
  const setup = useQuery({ queryKey: ["setup-status"], queryFn: () => get<{ needsSetup: boolean }>("/api/setup/status") });
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await get<MeResponse>("/api/auth/me");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    enabled: setup.data?.needsSetup === false,
  });

  if (setup.isLoading || (setup.data?.needsSetup === false && me.isLoading)) {
    return (
      <main className="auth-page">
        <Loading />
      </main>
    );
  }
  if (setup.error || me.error) {
    return (
      <main className="auth-page">
        <div className="alert alert-error" role="alert">
          {(setup.error ?? me.error)?.message} <button className="btn btn-small" onClick={() => location.reload()}>Újrapróbálás</button>
        </div>
      </main>
    );
  }
  if (setup.data?.needsSetup) return <SetupPage />;
  if (!me.data) return <LoginPage />;
  if (me.data.user.mustChangePassword) return <ForcedPasswordChangePage />;

  return (
    <WorkspaceProvider me={me.data}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route
            path="konyveles"
            element={<ComingSoon title="Könyvelés" step={3} description="Bizonylatok rögzítése és könyvelése, napló, sztornó és helyesbítő tételek, kontírozási sablonok." />}
          />
          <Route
            path={NEW_ENTRY_PATH.slice(1)}
            element={
              <ComingSoon
                title="Új tétel"
                step={3}
                description="Itt lesz a gyors, billentyűzetes tételrögzítés: tartozik/követel sorok, számlakereső, folyamatos egyensúly-ellenőrzés, előnézet mentés előtt."
              />
            }
          />
          <Route path="partnerek" element={<PartnersPage />} />
          <Route path="partnerek/uj" element={<NewPartnerPage />} />
          <Route path="partnerek/:partnerId" element={<PartnerDetailPage />} />
          <Route path="kimutatasok" element={<ComingSoon title="Kimutatások" step={5} description="Naplófőkönyv, főkönyvi kivonat, karton, mérleg és eredménykimutatás, exportokkal." />} />
          <Route path="zaras" element={<ComingSoon title="Zárás" step={6} description="Havi időszakok lezárása, évzárás előnézettel, nyitás." />} />
          <Route path="beallitasok" element={<SettingsLayout />}>
            <Route index element={<Navigate to={me.data.companies.length ? "ceg" : "jelszo"} replace />} />
            <Route path="ceg" element={<CompanySettingsPage />} />
            <Route path="uzleti-evek" element={<FiscalYearsPage />} />
            <Route path="szamlatukor" element={<ChartOfAccountsPage />} />
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
    </WorkspaceProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RadixTooltip.Provider>
        <ToastProvider>
          <BrowserRouter>
            <Root />
          </BrowserRouter>
        </ToastProvider>
      </RadixTooltip.Provider>
    </QueryClientProvider>
  </StrictMode>,
);
