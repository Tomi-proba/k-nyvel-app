import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useKeretHaVan } from "@aweboldal/felulet";
import { idoszakSzoveg, konyveloAlapIdoszak, tartomany, type Idoszak } from "@aweboldal/modulok";
import { compareDates, todayIso } from "@konyvelo/domain";
import { hasPermission, type FiscalYearDto, type MeResponse, type Permission } from "@konyvelo/shared";
import { get } from "../lib/api";
import { readSetting, writeSetting } from "../lib/storage";

type CompanyRef = MeResponse["companies"][number];

export type Workspace = {
  me: MeResponse;
  company: CompanyRef | null;
  selectCompany: (id: string) => void;
  fiscalYears: FiscalYearDto[];
  fiscalYearsLoading: boolean;
  fiscalYear: FiscalYearDto | null;
  selectFiscalYear: (id: string) => void;
  can: (permission: Permission) => boolean;
  /**
   * A keretben (TERV.md F23 KB4) a keret választott időszaka (vagy a cég üzleti éveiből számolt alapértelmezés):
   * a Könyvelő üzleti éve az, amelyikbe az időszak kezdete esik. Önálló futásnál null.
   */
  keretIdoszak: { idoszak: Idoszak; szoveg: string; tol: string; ig: string } | null;
};

const WorkspaceContext = createContext<Workspace | null>(null);

export const fiscalYearsKey = (companyId: string | null) => ["fiscal-years", companyId] as const;

function companyFromLink(me: MeResponse): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const id = url.searchParams.get("ceg");
  if (!id) return null;
  url.searchParams.delete("ceg");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  return me.companies.some((c) => c.id === id) ? id : null;
}

/**
 * A választott cég és üzleti év; a választás a böngészőben megmarad. A keretben (`keretCegId`) a cég a portál
 * cégéhez rendelt Könyvelő-cég, az üzleti év pedig a keret időszakából jön: itt nincs saját választás.
 */
export function WorkspaceProvider({ me, keretCegId, children }: { me: MeResponse; keretCegId?: string; children: ReactNode }) {
  const k = useKeretHaVan();
  const keret = keretCegId !== undefined && k !== null;
  // A másik programból (vagy a közös Kezdőlapról) jövő hivatkozás a céget is megadja (`?ceg=`, TERV.md F18):
  // ha a felhasználónak van hozzáférése, az a cég nyílik meg. A paraméter utána eltűnik a címsorból.
  const [companyId, setCompanyId] = useState<string | null>(() => {
    if (keret) return keretCegId;
    const fromLink = companyFromLink(me);
    if (fromLink) writeSetting("companyId", fromLink);
    return fromLink ?? readSetting("companyId");
  });
  const [fiscalYearId, setFiscalYearId] = useState<string | null>(() => readSetting("fiscalYearId"));

  const company = keret ? (me.companies.find((c) => c.id === keretCegId) ?? null) : (me.companies.find((c) => c.id === companyId) ?? me.companies[0] ?? null);

  useEffect(() => {
    if (!keret && company && company.id !== companyId) setCompanyId(company.id);
  }, [keret, company, companyId]);

  const fyQuery = useQuery({
    queryKey: fiscalYearsKey(company?.id ?? null),
    queryFn: () => get<FiscalYearDto[]>(`/api/companies/${company!.id}/fiscal-years`),
    enabled: Boolean(company),
    // A keretben az első megnyitáskor az üzleti év magától jön létre (akár egy másik böngészőlapon): amíg nincs,
    // néhány másodpercig figyeljük, hogy a lap ne ragadjon a „Még nincs üzleti év” állapotban.
    refetchInterval: (q) => (keret && q.state.data?.length === 0 && q.state.dataUpdateCount < 8 ? 1500 : false),
  });
  const fiscalYears = useMemo(() => fyQuery.data ?? [], [fyQuery.data]);

  // A keretben: a választott időszak; ha még nincs választás, a cég valódi üzleti éveiből (a folyó üzleti év
  // folyó hónapja, ennek híján a legutóbbi lezárult év utolsó hónapja). Az üzleti évek betöltése előtt nincs.
  const keretIdoszak = useMemo(() => {
    if (!keret || !fyQuery.isSuccess) return null;
    const idoszak = k.idoszak(null, () => konyveloAlapIdoszak({ uzletiEvek: fiscalYears.map((y) => ({ kezdet: y.startDate, veg: y.endDate })) }));
    return { idoszak, szoveg: idoszakSzoveg(idoszak), ...tartomany(idoszak) };
  }, [keret, k, fyQuery.isSuccess, fiscalYears]);

  // Alapértelmezés: a mai napot tartalmazó üzleti év, különben a legutolsó.
  const sajatFiscalYear = useMemo(() => {
    const chosen = fiscalYears.find((y) => y.id === fiscalYearId);
    if (chosen) return chosen;
    const today = todayIso();
    return (
      fiscalYears.find((y) => compareDates(y.startDate, today) <= 0 && compareDates(today, y.endDate) <= 0) ??
      fiscalYears.at(-1) ??
      null
    );
  }, [fiscalYears, fiscalYearId]);
  const fiscalYear = keret
    ? keretIdoszak
      ? (fiscalYears.find((y) => compareDates(y.startDate, keretIdoszak.tol) <= 0 && compareDates(keretIdoszak.tol, y.endDate) <= 0) ?? null)
      : null
    : sajatFiscalYear;

  const value: Workspace = {
    me,
    company,
    selectCompany: (id) => {
      // A keretben a céget a keret cégváltója választja.
      if (keret) return;
      setCompanyId(id);
      writeSetting("companyId", id);
      setFiscalYearId(null);
      writeSetting("fiscalYearId", null);
    },
    fiscalYears,
    fiscalYearsLoading: fyQuery.isLoading,
    fiscalYear,
    selectFiscalYear: (id) => {
      if (keret) {
        // A keret időszaka az üzleti év egy hónapjára áll: a mai hónapra, ha az évbe esik, különben az első hónapjára.
        const y = fiscalYears.find((f) => f.id === id);
        if (!y) return;
        const ma = todayIso();
        const nap = compareDates(y.startDate, ma) <= 0 && compareDates(ma, y.endDate) <= 0 ? ma : y.startDate;
        k.idoszakValasztas({ ev: Number(nap.slice(0, 4)), fajta: "honap", szam: Number(nap.slice(5, 7)) });
        return;
      }
      setFiscalYearId(id);
      writeSetting("fiscalYearId", id);
    },
    can: (permission) => (company ? hasPermission(company.role, permission) : false),
    keretIdoszak,
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const ws = useContext(WorkspaceContext);
  if (!ws) throw new Error("useWorkspace csak WorkspaceProvider-en belül használható.");
  return ws;
}
