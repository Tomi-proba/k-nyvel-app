import { useQuery } from "@tanstack/react-query";
import type { PartnerDto } from "@konyvelo/shared";
import { useWorkspace } from "../../app/workspace";
import { get } from "../../lib/api";

/** A cég összes (nem anonimizált) partnere a választómezőkhöz. */
export function usePartners() {
  const companyId = useWorkspace().company?.id;
  return useQuery({
    queryKey: ["partners", companyId, "all"],
    queryFn: () => get<PartnerDto[]>(`/api/companies/${companyId}/partners`),
    enabled: Boolean(companyId),
    staleTime: 30_000,
  });
}
