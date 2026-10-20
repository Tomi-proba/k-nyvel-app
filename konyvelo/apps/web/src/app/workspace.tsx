import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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
};

const WorkspaceContext = createContext<Workspace | null>(null);

export const fiscalYearsKey = (companyId: string | null) => ["fiscal-years", companyId] as const;

/** A választott cég és üzleti év; a választás a böngészőben megmarad. */
export function WorkspaceProvider({ me, children }: { me: MeResponse; children: ReactNode }) {
  const [companyId, setCompanyId] = useState<string | null>(() => readSetting("companyId"));
  const [fiscalYearId, setFiscalYearId] = useState<string | null>(() => readSetting("fiscalYearId"));

  const company = me.companies.find((c) => c.id === companyId) ?? me.companies[0] ?? null;

  useEffect(() => {
    if (company && company.id !== companyId) setCompanyId(company.id);
  }, [company, companyId]);

  const fyQuery = useQuery({
    queryKey: fiscalYearsKey(company?.id ?? null),
    queryFn: () => get<FiscalYearDto[]>(`/api/companies/${company!.id}/fiscal-years`),
    enabled: Boolean(company),
  });
  const fiscalYears = useMemo(() => fyQuery.data ?? [], [fyQuery.data]);

  // Alapértelmezés: a mai napot tartalmazó üzleti év, különben a legutolsó.
  const fiscalYear = useMemo(() => {
    const chosen = fiscalYears.find((y) => y.id === fiscalYearId);
    if (chosen) return chosen;
    const today = todayIso();
    return (
      fiscalYears.find((y) => compareDates(y.startDate, today) <= 0 && compareDates(today, y.endDate) <= 0) ??
      fiscalYears.at(-1) ??
      null
    );
  }, [fiscalYears, fiscalYearId]);

  const value: Workspace = {
    me,
    company,
    selectCompany: (id) => {
      setCompanyId(id);
      writeSetting("companyId", id);
      setFiscalYearId(null);
      writeSetting("fiscalYearId", null);
    },
    fiscalYears,
    fiscalYearsLoading: fyQuery.isLoading,
    fiscalYear,
    selectFiscalYear: (id) => {
      setFiscalYearId(id);
      writeSetting("fiscalYearId", id);
    },
    can: (permission) => (company ? hasPermission(company.role, permission) : false),
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const ws = useContext(WorkspaceContext);
  if (!ws) throw new Error("useWorkspace csak WorkspaceProvider-en belül használható.");
  return ws;
}
