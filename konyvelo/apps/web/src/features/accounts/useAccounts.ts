import { useQuery } from "@tanstack/react-query";
import type { AccountDto } from "@konyvelo/shared";
import { useWorkspace } from "../../app/workspace";
import { get } from "../../lib/api";

export const accountsKey = (companyId: string | undefined) => ["accounts", companyId] as const;

/** A választott cég számlatükre (számlaszám szerint rendezve, hierarchia-adatokkal). */
export function useAccounts() {
  const ws = useWorkspace();
  const companyId = ws.company?.id;
  return useQuery({
    queryKey: accountsKey(companyId),
    queryFn: () => get<AccountDto[]>(`/api/companies/${companyId}/accounts`),
    enabled: Boolean(companyId),
    staleTime: 60_000,
  });
}
