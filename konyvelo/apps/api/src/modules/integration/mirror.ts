import { and, isNotNull, isNull, sql } from "drizzle-orm";
import { APPROVAL_TODO_KINDS } from "@konyvelo/shared";
import { TODO_MIRROR_REFRESH_MS, todoMirrorHash, type HubClient, type ModuleTodo } from "@konyvelo/esemenyek";
import type { Db, Executor } from "../../core/db";
import { integrationSettings } from "../../core/schema";
import { companyTodos } from "../documents";
import { konyveloPath } from "./links";

/**
 * Közös Teendők (TERV.md F18, I6): a Könyvelő cégenként elküldi a nyitott Teendőinek teljes listáját a
 * központnak, hogy a cég többi programja (és majd a közös Kezdőlap) is lássa. A lista a Kezdőlappal
 * azonos forrásból készül. Ez állapot-tükör: ha egy küldés elmarad, a következő pótolja.
 *
 * Nem kerül bele, ami egy másik program állapotának visszhangja (ott a saját Teendőjük látszik):
 * az egyeztetés eredménye (RECONCILIATION), az eÁFA önellenőrzés-jelzése (VAT_SELF_CHECK), és a központ
 * elérhetősége (HUB_UNREACHABLE: ilyenkor a lista sem jutna el).
 */

const ECHO_KINDS = new Set(["RECONCILIATION", "VAT_SELF_CHECK", "HUB_UNREACHABLE"]);


export async function buildTodoMirror(db: Executor, companyId: string): Promise<ModuleTodo[]> {
  const t = await companyTodos(db, companyId);
  const link = (path: string) => ({ module: "konyvelo" as const, path: konyveloPath(companyId, path) });
  const out: ModuleTodo[] = [];
  for (const x of t.integration?.todos ?? []) {
    if (ECHO_KINDS.has(x.kind)) continue;
    const path = x.documentId ? `/konyveles/${x.documentId}` : (APPROVAL_TODO_KINDS as readonly string[]).includes(x.kind) ? "/konyveles/jovahagyas" : "/beallitasok/integracio";
    out.push({ key: `integracio:${x.id}`, kind: x.kind, title: x.title, detail: x.detail, link: link(path), since: x.createdAt });
  }
  if (t.integration?.approvals) {
    out.push({ key: "jovahagyasra-var", kind: "APPROVALS", title: `${t.integration.approvals} beérkezett tétel vár jóváhagyásra`, link: link("/konyveles/jovahagyas") });
  }
  if (t.drafts.length) {
    const late = t.drafts.filter((d) => d.deadline.status !== "OK").length;
    out.push({
      key: "piszkozatok",
      kind: "DRAFTS",
      title: `${t.drafts.length} piszkozat vár könyvelésre${late ? `, ebből ${late} a rögzítési határidő közelében vagy azon túl` : ""}`,
      link: link("/konyveles"),
    });
  }
  if (t.nav?.pending) out.push({ key: "nav-jovahagyas", kind: "NAV_PENDING", title: `${t.nav.pending} NAV-számla vár jóváhagyásra`, link: link("/konyveles/nav-import") });
  if (t.nav?.connectionProblem) out.push({ key: "nav-kapcsolat", kind: "NAV_CONNECTION", title: t.nav.connectionProblem.title, detail: t.nav.connectionProblem.action, link: link("/beallitasok/nav-kapcsolat") });
  if (t.unmappedAccounts) out.push({ key: "kimutatassor", kind: "UNMAPPED_ACCOUNTS", title: `${t.unmappedAccounts} könyvelhető számlának nincs kimutatássora`, link: link("/beallitasok/szamlatukor") });
  if (t.unappliedPayments) out.push({ key: "parositatlan-penzmozgas", kind: "UNAPPLIED_PAYMENTS", title: `${t.unappliedPayments} pénzmozgás nincs számlához párosítva`, link: link("/partnerek/nyitott-tetelek") });
  if (t.cashOverLimit.length) out.push({ key: "penztar-maximum", kind: "CASH_OVER_LIMIT", title: `A pénztár záróegyenlege ${t.cashOverLimit.length} napon meghaladta a maximumot (elmúlt 30 nap)`, link: link("/konyveles/penzeszkozok") });
  return out;
}

export type MirrorResult = { sent: number; unchanged: number; failed: number };

/**
 * Egy tükrözési kör az összes összekapcsolt cégre: csak akkor küld, ha a lista változott, vagy ha az utolsó
 * küldés óta letelt a frissítési idő. Hiba esetén a következő kör újrapróbálja (semmi nem vész el).
 */
export async function mirrorTodosOnce(db: Db, hub: HubClient, now = new Date()): Promise<MirrorResult> {
  const companies = await db
    .select({ companyId: integrationSettings.companyId })
    .from(integrationSettings)
    .where(and(isNotNull(integrationSettings.linkedAt), isNull(integrationSettings.unlinkedAt)));
  const r: MirrorResult = { sent: 0, unchanged: 0, failed: 0 };
  for (const { companyId } of companies) {
    try {
      const todos = await buildTodoMirror(db, companyId);
      const hash = todoMirrorHash(todos);
      const prev = await db.execute<{ hash: string; sent_at: Date }>(sql`SELECT hash, sent_at FROM integration_todo_mirror WHERE company_id = ${companyId}`);
      const p = prev.rows[0];
      if (p && p.hash === hash && now.getTime() - new Date(p.sent_at).getTime() < TODO_MIRROR_REFRESH_MS) {
        r.unchanged++;
        continue;
      }
      await hub.mirrorTodos(companyId, todos);
      await db.execute(sql`INSERT INTO integration_todo_mirror (company_id, hash, sent_at) VALUES (${companyId}, ${hash}, ${now})
                           ON CONFLICT (company_id) DO UPDATE SET hash = EXCLUDED.hash, sent_at = EXCLUDED.sent_at`);
      r.sent++;
    } catch {
      r.failed++;
    }
  }
  return r;
}
