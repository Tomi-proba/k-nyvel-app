import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DeadlineDto, DocumentDto, TemplateDto, TodosDto } from "@konyvelo/shared";
import { formatDateHu } from "@konyvelo/domain";
import { useWorkspace } from "../../app/workspace";
import { get } from "../../lib/api";

export const documentsKey = (companyId: string | undefined) => ["documents", companyId] as const;
export const todosKey = (companyId: string | undefined) => ["todos", companyId] as const;
export const templatesKey = (companyId: string | undefined) => ["templates", companyId] as const;

export function useDocument(id: string | null | undefined) {
  const companyId = useWorkspace().company?.id;
  return useQuery({
    queryKey: [...documentsKey(companyId), "detail", id],
    queryFn: () => get<DocumentDto>(`/api/companies/${companyId}/documents/${id}`),
    enabled: Boolean(companyId && id),
  });
}

export function useTemplates() {
  const companyId = useWorkspace().company?.id;
  return useQuery({
    queryKey: templatesKey(companyId),
    queryFn: () => get<TemplateDto[]>(`/api/companies/${companyId}/templates`),
    enabled: Boolean(companyId),
    staleTime: 60_000,
  });
}

export function useTodos() {
  const companyId = useWorkspace().company?.id;
  return useQuery({
    queryKey: todosKey(companyId),
    queryFn: () => get<TodosDto>(`/api/companies/${companyId}/todos`),
    enabled: Boolean(companyId),
  });
}

/** Bizonylat mentése után: lista, teendők és az adott bizonylat frissítése. */
export function useInvalidateDocuments() {
  const queryClient = useQueryClient();
  const companyId = useWorkspace().company?.id;
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: documentsKey(companyId) }),
      queryClient.invalidateQueries({ queryKey: todosKey(companyId) }),
    ]);
}

/** A rögzítési határidő rövid szöveges állapota (Szt. 165. § (3)). */
export function deadlineText(d: DeadlineDto): string {
  const date = formatDateHu(d.deadline);
  switch (d.status) {
    case "OVERDUE":
      return `Rögzítési határidő lejárt: ${date}`;
    case "DUE_SOON":
      return `Rögzítési határidő: ${date} (hamarosan lejár)`;
    case "LATE":
      return `Határidőn túl könyvelve (határidő: ${date})`;
    default:
      return `Rögzítési határidő: ${date}`;
  }
}
