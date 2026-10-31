import { and, asc, eq, isNull } from "drizzle-orm";
import { APPROVAL_TODO_KINDS, type IntegrationTodoDto } from "@konyvelo/shared";
import type { Executor, Tx } from "../../core/db";
import { integrationRecords, integrationSettings, integrationTodos } from "../../core/schema";

/**
 * Az integrációs Teendők (TERV.md F14.1). A Könyvelő Kezdőlapján a többi Teendő között látszanak; ha a
 * központnak is bejelentettük (`hubKey`), a megoldásukat az átadó jelzi neki.
 */

export type TodoKind =
  | "PURCHASE_APPROVAL"
  | "COGS_APPROVAL"
  | "REVERSAL_APPROVAL"
  | "MISSING_DATA"
  | "SOURCE_WITHDRAWN"
  | "INVOICE_MISSING"
  | "PARTNER"
  | "INTRO_MONTH"
  | "HUB_UNREACHABLE"
  | "UNSUPPORTED"
  /** A Könyvelőből jött mozgást a Készletben eltérő mennyiséggel hagyták jóvá (vagy nem érkezett / nem ment ki). */
  | "STOCK_DISCREPANCY"
  | "INVENTORY_APPROVAL"
  | "CASH_APPROVAL"
  | "RETURN_APPROVAL"
  | "SOURCE_CHANGED";

export async function openTodo(
  tx: Tx,
  companyId: string,
  t: { key: string; kind: TodoKind; title: string; detail?: string | null; documentId?: string | null; hubKey?: string | null },
): Promise<void> {
  await tx
    .insert(integrationTodos)
    .values({ companyId, key: t.key, kind: t.kind, title: t.title, detail: t.detail ?? null, documentId: t.documentId ?? null, hubKey: t.hubKey ?? null })
    .onConflictDoUpdate({
      target: [integrationTodos.companyId, integrationTodos.key],
      set: { title: t.title, detail: t.detail ?? null, documentId: t.documentId ?? null, resolvedAt: null, resolvedBy: null, hubResolvedAt: null },
    });
}

export async function resolveTodo(tx: Tx, companyId: string, key: string, userId: string | null): Promise<void> {
  await tx
    .update(integrationTodos)
    .set({ resolvedAt: new Date(), resolvedBy: userId })
    .where(and(eq(integrationTodos.companyId, companyId), eq(integrationTodos.key, key), isNull(integrationTodos.resolvedAt)));
}

/** A bizonylathoz tartozó nyitott Teendők lezárása (könyvelés vagy törlés után). */
export async function resolveDocumentTodos(tx: Tx, companyId: string, documentId: string, userId: string | null): Promise<void> {
  await tx
    .update(integrationTodos)
    .set({ resolvedAt: new Date(), resolvedBy: userId })
    .where(and(eq(integrationTodos.companyId, companyId), eq(integrationTodos.documentId, documentId), isNull(integrationTodos.resolvedAt)));
}

export async function recordKindOf(db: Executor, documentId: string) {
  const rows = await db.select({ kind: integrationRecords.kind }).from(integrationRecords).where(eq(integrationRecords.documentId, documentId));
  return rows.map((r) => r.kind);
}

export async function openIntegrationTodos(db: Executor, companyId: string): Promise<IntegrationTodoDto[]> {
  const rows = await db
    .select()
    .from(integrationTodos)
    .where(and(eq(integrationTodos.companyId, companyId), isNull(integrationTodos.resolvedAt)))
    .orderBy(asc(integrationTodos.createdAt));
  return rows.map((t) => ({ id: t.id, kind: t.kind as IntegrationTodoDto["kind"], title: t.title, detail: t.detail, documentId: t.documentId, createdAt: t.createdAt.toISOString() }));
}

/** A Kezdőlap Teendőihez: null, ha a cég soha nem volt összekapcsolva. */
export async function integrationTodosSummary(db: Executor, companyId: string) {
  const [s] = await db.select({ linkedAt: integrationSettings.linkedAt }).from(integrationSettings).where(eq(integrationSettings.companyId, companyId));
  if (!s?.linkedAt) return null;
  const todos = await openIntegrationTodos(db, companyId);
  return { todos, approvals: todos.filter((t) => APPROVAL_TODO_KINDS.includes(t.kind)).length };
}

