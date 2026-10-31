import { eq } from "drizzle-orm";
import { INTEGRATION_ACCOUNT_KEYS, INTEGRATION_ACCOUNT_LABELS } from "@konyvelo/shared";
import type { Executor, Tx } from "../../core/db";
import { integrationSettings } from "../../core/schema";
import { listAccounts } from "../accounts";
import { openTodo, resolveTodo } from "./todos";

/**
 * Ha egy összekapcsolt cégnél a számla-hozzárendelés valamelyik eleme üres vagy nem könyvelhető (inaktív,
 * gyűjtőszámla), a Kezdőlapon Teendő szól róla, a Beállítások → Integráció oldalra mutatva; amint rendben van,
 * a Teendő magától lezárul. Ugyanaz a szabály, mint a Készletből jött tételek könyvelésénél.
 */
export const MAPPING_TODO_KEY = "szamla-hozzarendeles";

export async function missingMappings(db: Executor, companyId: string): Promise<string[]> {
  const [s] = await db.select().from(integrationSettings).where(eq(integrationSettings.companyId, companyId));
  if (!s) return [];
  const byId = new Map((await listAccounts(db, companyId)).map((a) => [a.id, a]));
  return INTEGRATION_ACCOUNT_KEYS.filter((k) => {
    const id = s[k];
    const a = id ? byId.get(id) : undefined;
    return !a || !a.isActive || a.hasChildren;
  }).map((k) => `${INTEGRATION_ACCOUNT_LABELS[k].label} (pl. ${INTEGRATION_ACCOUNT_LABELS[k].number})`);
}

export async function refreshMappingTodo(tx: Tx, companyId: string): Promise<void> {
  const [s] = await tx.select().from(integrationSettings).where(eq(integrationSettings.companyId, companyId));
  const linked = Boolean(s?.linkedAt && !s.unlinkedAt);
  const missing = linked ? await missingMappings(tx, companyId) : [];
  if (!missing.length) return resolveTodo(tx, companyId, MAPPING_TODO_KEY, null);
  await openTodo(tx, companyId, {
    key: MAPPING_TODO_KEY,
    kind: "MISSING_DATA",
    title: `Hiányzik a számla-hozzárendelés a Készletből jövő tételekhez: ${missing.join(", ")}. Állítsa be: Beállítások → Integráció.`,
    detail: "Amíg nincs megadva, az érintett tételek (pl. pénztárzárás, leltáreltérés) hiányosak, és nem hagyhatók jóvá.",
  });
}

/** Minden cégre, amelynek van integrációs beállítása (az átadó állapot-ellenőrzésében); bontott cégnél lezárja. */
export async function refreshAllMappingTodos(db: { transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T> } & Executor): Promise<void> {
  const rows = await db.select({ companyId: integrationSettings.companyId }).from(integrationSettings);
  for (const c of rows) await db.transaction((tx) => refreshMappingTodo(tx, c.companyId));
}
