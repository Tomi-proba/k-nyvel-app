import { and, isNotNull, isNull, sql } from "drizzle-orm";
import { todayIso } from "@konyvelo/domain";
import { openItemsHash, TODO_MIRROR_REFRESH_MS, type HubClient, type OpenItem, type OpenItemsMirror, type PendingDraft } from "@konyvelo/esemenyek";
import type { Db, Executor } from "../../core/db";
import { integrationSettings } from "../../core/schema";
import { openItems } from "../subledger";
import { konyveloPath } from "./links";

/**
 * Nyitott tételek a Készletnek (TERV.md F19, I6b, KK10): a Könyvelő cégenként elküldi a központnak a nyitott
 * szállítói és vevői tételeit, és a Készletből jött, még piszkozat bizonylatokat. A Készlet ebből mutatja
 * a fizetési kötelezettségeket és a kintlévőséget, hogy mindkét oldalon egy igazság legyen.
 *
 * A lista a folyószámla meglévő számításából készül (openItems). A határidő csak a bizonylaton megadott
 * határidő: ha nincs megadva, null (a folyószámla a könyvelés napját mutatja helyette, de itt nem találunk ki
 * határidőt). Állapot-tükör: csak változáskor küld, de legalább 10 percenként.
 */

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export async function buildOpenItemsMirror(db: Executor, companyId: string, asOf = todayIso()): Promise<OpenItemsMirror> {
  const o = await openItems(db, companyId);
  const ids = [...new Set(o.items.map((i) => i.documentId))];
  const due = new Map<string, string | null>();
  const sources = new Map<string, Array<{ recordType: string; recordId: string }>>();
  if (ids.length) {
    const d = await db.execute<{ id: string; due_date: string | null }>(sql`SELECT id, due_date::text FROM documents WHERE company_id = ${companyId} AND id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    for (const r of d.rows) due.set(r.id, r.due_date);
  }
  // A Készletből jött bizonylatok Készlet-forrásai (beszerzés, eladás, a Könyvelőből indult mozgás).
  const s = await db.execute<{ document_id: string; source_record_type: string; source_record_id: string }>(sql`
    SELECT DISTINCT document_id, source_record_type, source_record_id FROM integration_records
     WHERE company_id = ${companyId} AND source_module = 'keszlet' AND document_id IS NOT NULL
     ORDER BY document_id, source_record_type, source_record_id`);
  for (const r of s.rows) {
    const l = sources.get(r.document_id) ?? [];
    l.push({ recordType: r.source_record_type, recordId: r.source_record_id });
    sources.set(r.document_id, l);
  }
  const link = (documentId: string) => ({ module: "konyvelo" as const, path: konyveloPath(companyId, `/konyveles/${documentId}`) });
  const items: OpenItem[] = o.items
    .filter((i) => i.open > 0)
    .map((i) => ({
      kind: i.kind,
      documentId: i.documentId,
      serialNumber: i.serialNumber,
      externalNumber: i.externalNumber,
      partnerName: i.partnerName,
      description: i.description,
      issueDate: i.issueDate,
      dueDate: due.get(i.documentId) ?? null,
      open: i.open,
      link: link(i.documentId),
      stockSources: (sources.get(i.documentId) ?? []).slice(0, 100),
    }))
    .sort((a, b) => cmp(a.kind, b.kind) || cmp(a.dueDate ?? "9999", b.dueDate ?? "9999") || cmp(a.documentId, b.documentId) || a.open - b.open);
  // Könyvelésre vár: a beszerzésből készült szállítói számla még piszkozat; az eladáshoz még nincs (párosult)
  // vevőszámla – a Könyvelő számla nélkül nem könyvel árbevételt (❓5).
  const p = await db.execute<{ document_id: string | null; kind: "PAYABLE" | "RECEIVABLE"; source_record_type: string; source_record_id: string }>(sql`
    SELECT r.document_id, 'PAYABLE' AS kind, r.source_record_type, r.source_record_id
      FROM integration_records r JOIN documents d ON d.id = r.document_id
     WHERE r.company_id = ${companyId} AND r.source_module = 'keszlet' AND r.kind = 'PURCHASE' AND d.status = 'DRAFT'
    UNION
    SELECT NULL, 'RECEIVABLE', r.source_record_type, r.source_record_id
      FROM integration_records r
     WHERE r.company_id = ${companyId} AND r.source_module = 'keszlet' AND r.kind = 'COGS'
       AND NOT EXISTS (SELECT 1 FROM integration_records x WHERE x.company_id = r.company_id AND x.source_module = 'keszlet'
                        AND x.kind = 'SALE_LINK' AND x.source_record_id = r.source_record_id)
     ORDER BY 2, 1, 3, 4`);
  const byDoc = new Map<string, PendingDraft>();
  const pendingDrafts: PendingDraft[] = [];
  for (const r of p.rows) {
    const src = { recordType: r.source_record_type, recordId: r.source_record_id };
    if (r.document_id) {
      const e = byDoc.get(r.document_id);
      if (e) e.stockSources.push(src);
      else {
        const n: PendingDraft = { kind: r.kind, documentId: r.document_id, link: link(r.document_id), stockSources: [src] };
        byDoc.set(r.document_id, n);
        pendingDrafts.push(n);
      }
    } else pendingDrafts.push({ kind: r.kind, documentId: null, link: null, stockSources: [src] });
  }
  return { companyRef: companyId, asOf, items, pendingDrafts };
}

export type OpenItemsMirrorResult = { sent: number; unchanged: number; failed: number };

/** Egy kör az összes összekapcsolt cégre (hiba esetén a következő kör újrapróbálja). */
export async function mirrorOpenItemsOnce(db: Db, hub: HubClient, now = new Date()): Promise<OpenItemsMirrorResult> {
  const companies = await db
    .select({ companyId: integrationSettings.companyId })
    .from(integrationSettings)
    .where(and(isNotNull(integrationSettings.linkedAt), isNull(integrationSettings.unlinkedAt)));
  const r: OpenItemsMirrorResult = { sent: 0, unchanged: 0, failed: 0 };
  for (const { companyId } of companies) {
    try {
      const m = await buildOpenItemsMirror(db, companyId, todayIso(now));
      const hash = openItemsHash(m);
      const prev = (await db.execute<{ hash: string; sent_at: Date }>(sql`SELECT hash, sent_at FROM integration_open_items_mirror WHERE company_id = ${companyId}`)).rows[0];
      if (prev && prev.hash === hash && now.getTime() - new Date(prev.sent_at).getTime() < TODO_MIRROR_REFRESH_MS) {
        r.unchanged++;
        continue;
      }
      await hub.mirrorOpenItems(m);
      await db.execute(sql`INSERT INTO integration_open_items_mirror (company_id, hash, sent_at) VALUES (${companyId}, ${hash}, ${now})
                           ON CONFLICT (company_id) DO UPDATE SET hash = EXCLUDED.hash, sent_at = EXCLUDED.sent_at`);
      r.sent++;
    } catch {
      r.failed++;
    }
  }
  return r;
}
