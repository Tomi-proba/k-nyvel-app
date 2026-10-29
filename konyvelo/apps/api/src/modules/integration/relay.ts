import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { todayIso } from "@konyvelo/domain";
import type { EventEnvelope, HubClient } from "@konyvelo/esemenyek";
import type { Db } from "../../core/db";
import { integrationOutbox, integrationSettings, integrationTodos } from "../../core/schema";
import { openTodo, resolveTodo } from "./todos";

/**
 * Az átadó (TERV.md F14.1): a kimenő tábla eseményeit adja át a központnak, és a központba is bejelentett
 * Teendők megoldását jelzi. Több példány is futhat egyszerre: a sorokat zárolva veszi ki. Az esemény csak
 * a központ visszaigazolása után számít elküldöttnek; az ismételt átadás nem baj, mert a központ az
 * azonosító szerint egyszer veszi át.
 */

export type RelayResult = { sent: number; failed: number; error: string | null; todosReported: number };

/** Ennyi perc után nyit Teendőt, ha a központ nem veszi át az eseményeket. */
export const HUB_UNREACHABLE_MINUTES = 30;

export async function relayOnce(db: Db, hub: HubClient, batch = 100): Promise<RelayResult> {
  const out = await db.transaction(async (tx) => {
    const rows = await tx.execute<{ id: string; envelope: EventEnvelope }>(
      sql`SELECT id, envelope FROM integration_outbox WHERE sent_at IS NULL ORDER BY created_at, id LIMIT ${batch} FOR UPDATE SKIP LOCKED`,
    );
    if (!rows.rows.length) return { sent: 0, failed: 0, error: null as string | null };
    try {
      const r = await hub.publish(rows.rows.map((x) => x.envelope));
      const accepted = new Set(r.accepted);
      const rejected = new Map(r.rejected.map((x) => [x.id, x.error]));
      for (const row of rows.rows) {
        if (accepted.has(row.id)) {
          await tx.update(integrationOutbox).set({ sentAt: new Date(), attempts: sql`${integrationOutbox.attempts} + 1`, lastError: null }).where(eq(integrationOutbox.id, row.id));
        } else {
          await tx
            .update(integrationOutbox)
            .set({ attempts: sql`${integrationOutbox.attempts} + 1`, lastError: rejected.get(row.id) ?? "A központ nem vette át." })
            .where(eq(integrationOutbox.id, row.id));
        }
      }
      const failed = rows.rows.length - accepted.size;
      return { sent: accepted.size, failed, error: failed ? "A központ nem vette át az összes eseményt." : null };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await tx.execute(sql`UPDATE integration_outbox SET attempts = attempts + 1, last_error = ${message} WHERE id IN (${sql.join(rows.rows.map((r) => sql`${r.id}`), sql`, `)})`);
      return { sent: 0, failed: rows.rows.length, error: message };
    }
  });

  // A központba bejelentett Teendők megoldásának jelzése (ha nem sikerül, a következő körben újra).
  let todosReported = 0;
  const pending = await db
    .select({ id: integrationTodos.id, companyId: integrationTodos.companyId, hubKey: integrationTodos.hubKey })
    .from(integrationTodos)
    .where(and(isNotNull(integrationTodos.resolvedAt), isNotNull(integrationTodos.hubKey), isNull(integrationTodos.hubResolvedAt)))
    .limit(100);
  for (const t of pending) {
    try {
      await hub.resolveTodo(t.companyId, t.hubKey!);
      await db.update(integrationTodos).set({ hubResolvedAt: new Date() }).where(eq(integrationTodos.id, t.id));
      todosReported++;
    } catch {
      // a központ most nem érhető el; a következő körben újra
    }
  }

  await refreshHealthTodos(db);
  return { ...out, todosReported };
}

/**
 * Az átadás állapotának Teendői cégenként: ha egy esemény régóta vár, „A központ nem érhető el”; ha a
 * bevezető hónap letelt, emlékeztető (magától nem kapcsol át, F14.3).
 */
export async function refreshHealthTodos(db: Db, now = new Date()): Promise<void> {
  const stale = await db.execute<{ company_id: string; n: number; oldest: Date; last_error: string | null }>(sql`
    SELECT company_id, count(*)::int AS n, min(created_at) AS oldest, (array_agg(last_error ORDER BY created_at DESC))[1] AS last_error
      FROM integration_outbox WHERE sent_at IS NULL GROUP BY company_id`);
  const waiting = new Map(stale.rows.map((r) => [r.company_id, r]));
  await db.transaction(async (tx) => {
    for (const r of stale.rows) {
      if (now.getTime() - new Date(r.oldest).getTime() < HUB_UNREACHABLE_MINUTES * 60_000) continue;
      await openTodo(tx, r.company_id, {
        key: "kozpont-nem-erheto-el",
        kind: "HUB_UNREACHABLE",
        title: `Az integrációs központ ${HUB_UNREACHABLE_MINUTES} perce nem veszi át az eseményeket (${r.n} esemény vár).`,
        detail: `Az események nem vesztek el: amint a központ elérhető, átadjuk őket. Utolsó hiba: ${r.last_error ?? "ismeretlen"}.`,
      });
    }
    const open = await tx
      .select({ companyId: integrationTodos.companyId })
      .from(integrationTodos)
      .where(and(eq(integrationTodos.key, "kozpont-nem-erheto-el"), isNull(integrationTodos.resolvedAt)));
    for (const t of open) if (!waiting.has(t.companyId)) await resolveTodo(tx, t.companyId, "kozpont-nem-erheto-el", null);

    // A bevezető hónap letelte: egyszer szól, és nem kapcsol át magától.
    const due = await tx
      .select({ companyId: integrationSettings.companyId, until: integrationSettings.draftOnlyUntil })
      .from(integrationSettings)
      .where(
        and(
          isNotNull(integrationSettings.linkedAt),
          isNull(integrationSettings.unlinkedAt),
          eq(integrationSettings.postingMode, "DRAFT_ONLY"),
          isNotNull(integrationSettings.draftOnlyUntil),
          lte(integrationSettings.draftOnlyUntil, todayIso(now)),
        ),
      );
    for (const s of due) {
      await tx
        .insert(integrationTodos)
        .values({
          companyId: s.companyId,
          key: `bevezeto-honap-${s.until}`,
          kind: "INTRO_MONTH",
          title: "Letelt a bevezető hónap: átkapcsolja a beérkező tételeket automatikus könyvelésre?",
          detail: "Most minden beérkező tétel piszkozat. Automatikus módban a program csak az egyértelmű tételeket könyveli, a többi továbbra is piszkozat lesz. Beállítások → Integráció. Az ELÁBÉ mindig jóváhagyással megy.",
        })
        .onConflictDoNothing();
    }
  });
}

/** Az átadó indítása a szerverben (néhány másodpercenként; egyszerre csak egy kör fut). */
export function startRelay(db: Db, hub: HubClient, log: { warn: (o: unknown, msg: string) => void }, intervalMs = 5_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await relayOnce(db, hub);
      if (r.error) log.warn({ failed: r.failed }, `Integráció: az átadás nem sikerült (${r.error}); a következő körben újra.`);
    } catch (e) {
      log.warn({ err: e }, "Integráció: hiba az átadó körében.");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

