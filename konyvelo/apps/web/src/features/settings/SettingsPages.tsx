import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import type { CompanyDto } from "@konyvelo/shared";
import { useWorkspace } from "../../app/workspace";
import { get, patch, post } from "../../lib/api";
import { ErrorBox, Loading, PageHeader } from "../../ui/Page";
import { useToast } from "../../ui/Toasts";
import { ChangePasswordForm } from "../auth/AuthPages";
import { CompanyForm } from "./CompanyForm";

export function SettingsLayout() {
  const ws = useWorkspace();
  const items = [
    { to: "/beallitasok/ceg", label: "Cégadatok", show: Boolean(ws.company) },
    { to: "/beallitasok/uzleti-evek", label: "Üzleti évek", show: Boolean(ws.company) },
    { to: "/beallitasok/felhasznalok", label: "Felhasználók", show: ws.can("members:manage") },
    { to: "/beallitasok/naplo", label: "Audit napló", show: ws.can("audit:read") },
    { to: "/beallitasok/jelszo", label: "Saját jelszó", show: true },
    { to: "/cegek/uj", label: "Új cég felvétele", show: true },
  ];
  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Beállítások">
        <ul>
          {items
            .filter((i) => i.show)
            .map((i) => (
              <li key={i.to}>
                <NavLink to={i.to}>{i.label}</NavLink>
              </li>
            ))}
        </ul>
      </nav>
      <div>
        <Outlet />
      </div>
    </div>
  );
}

export function CompanySettingsPage() {
  const ws = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const companyId = ws.company?.id;
  const q = useQuery({
    queryKey: ["company", companyId],
    queryFn: () => get<CompanyDto>(`/api/companies/${companyId}`),
    enabled: Boolean(companyId),
  });
  const canEdit = ws.can("company:update");

  return (
    <>
      <PageHeader title="Cégadatok" description={canEdit ? undefined : "Az adatokat csak Adminisztrátor vagy Vezető könyvelő módosíthatja."} />
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && (
        <CompanyForm
          key={q.data.id}
          company={q.data}
          readOnly={!canEdit}
          submitLabel="Változások mentése"
          onSubmit={async (data) => {
            const updated = await patch<CompanyDto>(`/api/companies/${q.data.id}`, data);
            queryClient.setQueryData(["company", updated.id], updated);
            await queryClient.invalidateQueries({ queryKey: ["me"] });
            toast("success", "A cégadatok mentése sikerült.");
          }}
        />
      )}
    </>
  );
}

export function NewCompanyPage() {
  const ws = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <>
      <PageHeader title="Új cég felvétele" description="A létrehozó a cég Adminisztrátora lesz. Később további felhasználókat adhat hozzá." />
      <CompanyForm
        submitLabel="Cég létrehozása"
        onSubmit={async (data) => {
          const created = await post<CompanyDto>("/api/companies", data);
          await queryClient.invalidateQueries({ queryKey: ["me"] });
          ws.selectCompany(created.id);
          toast("success", `A(z) ${created.shortName} cég létrejött. Következő lépés: az első üzleti év.`);
          navigate("/beallitasok/uzleti-evek");
        }}
      />
    </>
  );
}

export function PasswordPage() {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <>
      <PageHeader title="Saját jelszó" description="A jelszócsere után a többi eszközön a bejelentkezés megszűnik." />
      {done && <div className="alert alert-success">A jelszó cseréje sikerült.</div>}
      <ChangePasswordForm
        onDone={() => {
          setDone(true);
          toast("success", "A jelszó cseréje sikerült.");
        }}
      />
    </>
  );
}

/** Közös kis segéd a módosító műveletekhez: siker/hiba visszajelzés. */
export function useAction<T>(fn: (arg: T) => Promise<unknown>, success: string, invalidate: unknown[][]) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(invalidate.map((key) => queryClient.invalidateQueries({ queryKey: key })));
      toast("success", success);
    },
    onError: (err) => toast("error", err instanceof Error ? err.message : "Váratlan hiba történt."),
  });
}
