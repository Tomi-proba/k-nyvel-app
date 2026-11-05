import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router";
import type { MeResponse } from "@konyvelo/shared";
import { AppLayout } from "./app/AppLayout";
import { Utvonalak } from "./app/Utvonalak";
import { WorkspaceProvider } from "./app/workspace";
import { ForcedPasswordChangePage, LoginPage, SetupPage, type SetupStatus } from "./features/auth/AuthPages";
import { KetlepcsosPage, SsoPage } from "./features/auth/KozosBelepes";
import { ApiError, get } from "./lib/api";
import { ujQueryClient } from "./lib/lekerdezes";
import { Loading } from "./ui/Page";
import { ToastProvider } from "./ui/Toasts";
import "@aweboldal/dizajn/tokens.css";
import "@aweboldal/felulet/felulet.css";
import "./styles.css";

const queryClient = ujQueryClient();

function Root() {
  const { pathname } = useLocation();
  // A portálról nyitott belépés (#jegy=…) a bejelentkezési állapottól függetlenül itt kezdődik.
  if (pathname === "/sso") return <SsoPage />;
  return <Belepve />;
}

function Belepve() {
  const setup = useQuery({ queryKey: ["setup-status"], queryFn: () => get<SetupStatus>("/api/setup/status") });
  const me = useQuery({
    queryKey: ["me"],
    // 401-nél a hibakód mondja meg, hiányzik-e a kétlépcsős kód (vagy annak beállítása).
    queryFn: async (): Promise<{ me: MeResponse | null; hianyzik: string | null }> => {
      try {
        return { me: await get<MeResponse>("/api/auth/me"), hianyzik: null };
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return { me: null, hianyzik: err.code };
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
  if (me.data?.hianyzik === "TOTP_REQUIRED") return <KetlepcsosPage beallitas={false} />;
  if (me.data?.hianyzik === "TOTP_SETUP_REQUIRED") return <KetlepcsosPage beallitas />;
  if (!me.data?.me) return <LoginPage status={setup.data!} />;
  if (me.data.me.user.mustChangePassword) return <ForcedPasswordChangePage />;
  const data = me.data.me;

  return (
    <WorkspaceProvider me={data}>
      <Utvonalak me={data} layout={<AppLayout />} />
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
