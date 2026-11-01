import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { registryOf, validateEvent, type EventEnvelope } from "@konyvelo/esemenyek";
import type { Executor, Tx } from "../../core/db";
import { accounts, documents, documentStockLines, integrationOutbox, integrationProducts, integrationRecords, integrationSettings, journalLines, partners, settlements } from "../../core/schema";
import { openTodo } from "./todos";
import { konyveloPath } from "./links";

/**
 * Kimenő események (TERV.md F14.1). Mindig a művelet SAJÁT tranzakciójában: ha a művelet
 * visszagörgetődik, esemény sem marad; ha sikerül, az esemény biztosan megvan, és az átadó (relay.ts)
 * a központ visszaigazolásáig próbálkozik vele.
 *
 * Csak összekapcsolt cégnél keletkezik esemény; anélkül semmi nem változik a Könyvelő működésében.
 */

const registry = registryOf();

export async function isLinked(db: Executor, companyId: string): Promise<boolean> {
  const [s] = await db
    .select({ id: integrationSettings.companyId })
    .from(integrationSettings)
    .where(and(eq(integrationSettings.companyId, companyId), isNotNull(integrationSettings.linkedAt), isNull(integrationSettings.unlinkedAt)));
  return Boolean(s);
}

async function nextSequence(tx: Tx, recordType: string, recordId: string): Promise<number> {
  const r = await tx.execute<{ last_value: number }>(sql`
    INSERT INTO integration_sequences (record_type, record_id, last_value) VALUES (${recordType}, ${recordId}, 1)
    ON CONFLICT (record_type, record_id) DO UPDATE SET last_value = integration_sequences.last_value + 1
    RETURNING last_value`);
  return Number(r.rows[0]!.last_value);
}

export type OutgoingEvent = {
  type: string;
  version: number;
  record: { type: string; id: string; url?: string; label?: string };
  payload: Record<string, unknown>;
  /** Ha az esemény egy beérkezett esemény hatására keletkezett (visszhang tiltása). */
  causedBy?: string | null;
};

/** Esemény a kimenő táblába. Hibás eseményt nem fogad el: a művelet ekkor visszagörgetődik. */
export async function emitEvent(tx: Tx, companyId: string, e: OutgoingEvent): Promise<string | null> {
  if (!(await isLinked(tx, companyId))) return null;
  const envelope: EventEnvelope = {
    id: randomUUID(),
    type: e.type,
    version: e.version,
    source: {
      module: "konyvelo",
      companyRef: companyId,
      recordType: e.record.type,
      recordId: e.record.id,
      sequence: await nextSequence(tx, e.record.type, e.record.id),
      ...(e.record.url ? { url: konyveloPath(companyId, e.record.url) } : {}),
      ...(e.record.label ? { label: e.record.label.slice(0, 300) } : {}),
    },
    occurredAt: new Date().toISOString(),
    ...(e.causedBy ? { causedBy: e.causedBy } : {}),
    payload: e.payload,
  };
  const v = validateEvent(envelope, registry);
  if (!v.ok) throw new Error(`Belső hiba: a kimenő esemény hibás (${v.error}).`);
  await tx.insert(integrationOutbox).values({ id: envelope.id, companyId, envelope: v.event as unknown as Record<string, unknown> });
  return envelope.id;
}

// ---------- Tartalmak ----------

const TAX = /^\d{8}-\d-\d{2}$/;

async function partnerRefs(db: Executor, ids: Array<string | null | undefined>) {
  const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const rows = wanted.length ? await db.select().from(partners).where(inArray(partners.id, wanted)) : [];
  return new Map(rows.map((p) => [p.id, { name: p.name, ...(p.taxNumber && TAX.test(p.taxNumber) ? { taxNumber: p.taxNumber } : {}) }]));
}

/** Ha a bizonylat egy beérkezett esemény hatására jött létre, annak azonosítója (visszhang tiltása). */
export async function originEventOf(db: Executor, documentId: string): Promise<string | null> {
  const [r] = await db.select({ eventId: integrationRecords.eventId }).from(integrationRecords).where(eq(integrationRecords.documentId, documentId)).orderBy(asc(integrationRecords.createdAt)).limit(1);
  return r?.eventId ?? null;
}

type Doc = typeof documents.$inferSelect;
const ref = async (db: Executor, id: string | null) => {
  if (!id) return null;
  const [d] = await db.select({ id: documents.id, serial: documents.serialNumber }).from(documents).where(eq(documents.id, id));
  return d?.serial ? { documentId: d.id, serialNumber: d.serial } : null;
};

/** Könyvelt bizonylat (a sztornó kivételével, az a `bizonylat.sztornozva`; a nyitó és záró tétel nem megy ki). */
export async function emitDocumentPosted(tx: Tx, doc: Doc): Promise<void> {
  if (doc.docType === "SZT" || doc.docType === "NYIT" || doc.docType === "ZAR") return;
  if (!(await isLinked(tx, doc.companyId))) return;
  const lines = await tx.select().from(journalLines).where(eq(journalLines.documentId, doc.id)).orderBy(asc(journalLines.lineNo));
  const accIds = [...new Set(lines.map((l) => l.accountId).filter((x): x is string => Boolean(x)))];
  const accNo = new Map((accIds.length ? await tx.select({ id: accounts.id, number: accounts.number }).from(accounts).where(inArray(accounts.id, accIds)) : []).map((a) => [a.id, a.number]));
  const refs = await partnerRefs(tx, [doc.partnerId, ...lines.map((l) => l.partnerId)]);
  const stock = await tx.select().from(documentStockLines).where(eq(documentStockLines.documentId, doc.id)).orderBy(asc(documentStockLines.lineNo));
  await emitEvent(tx, doc.companyId, {
    type: "konyvelo.bizonylat.konyvelve",
    version: 2,
    record: { type: "bizonylat", id: doc.id, url: `/konyveles/${doc.id}`, label: `${doc.serialNumber}${doc.description ? ` – ${doc.description}` : ""}` },
    causedBy: await originEventOf(tx, doc.id),
    payload: {
      documentId: doc.id,
      serialNumber: doc.serialNumber!,
      docType: doc.docType,
      accountingDate: doc.accountingDate,
      issueDate: doc.issueDate,
      fulfillmentDate: doc.fulfillmentDate,
      dueDate: doc.dueDate,
      externalNumber: doc.externalNumber,
      description: doc.description,
      currency: doc.currency,
      fxAmount: doc.fxAmount,
      fxRate: doc.fxRate,
      partner: doc.partnerId ? (refs.get(doc.partnerId) ?? null) : null,
      corrects: await ref(tx, doc.correctsDocumentId),
      reverses: await ref(tx, doc.reversesDocumentId),
      // A sztornó negatív előjeles módszerénél a sor összege negatív lehet; az esemény mindig pozitív
      // összeget és a tényleges oldalt adja.
      lines: lines
        .filter((l) => l.amount !== 0 && l.accountId && l.side)
        .map((l) => ({
          accountNumber: accNo.get(l.accountId!)!,
          side: (l.amount < 0 ? (l.side === "D" ? "C" : "D") : l.side) as "D" | "C",
          amount: Math.abs(l.amount),
          ...(l.partnerId ? { partner: refs.get(l.partnerId) ?? null } : {}),
        })),
      ...(stock.length
        ? {
            stockLines: stock.map((s) => ({
              productId: s.productId,
              productName: s.productName,
              quantity: Number(s.quantity),
              unit: s.unit,
              netAmount: s.netAmount,
              vatRate: s.vatRate === null ? null : Number(s.vatRate),
              vatAmount: s.vatAmount,
            })),
          }
        : {}),
    },
  });
  await stockQuestionSkipped(tx, doc, stock.length);
}

/**
 * KK3: ha a cégnek van Készlete (ismert termékei), de a vevő- vagy szállítói számlához nem adtak meg
 * terméket, a Készlet nem tudja a mozgást magától rögzíteni: erről Teendő szól (tájékoztató).
 */
async function stockQuestionSkipped(tx: Tx, doc: Doc, stockCount: number) {
  if (stockCount > 0 || (doc.docType !== "SZSZ" && doc.docType !== "VSZ")) return;
  if (await originEventOf(tx, doc.id)) return;
  const [p] = await tx.select({ n: sql<number>`count(*)::int` }).from(integrationProducts).where(eq(integrationProducts.companyId, doc.companyId));
  if (!p?.n) return;
  await openTodo(tx, doc.companyId, {
    key: `termek:${doc.id}`,
    kind: "MISSING_DATA",
    title: `A(z) ${doc.serialNumber} bizonylathoz nem adott meg terméket; a Készletben a mozgást kézzel kell rögzíteni (ott is kérdés lesz).`,
    documentId: doc.id,
  });
}

export async function emitDocumentReversed(tx: Tx, orig: Doc, storno: Doc, causedBy: string | null = null): Promise<void> {
  // A nyitó és záró tétel ki sem ment, így a sztornója sem (évzárás újranyitása).
  if (orig.docType === "NYIT" || orig.docType === "ZAR") return;
  await emitEvent(tx, orig.companyId, {
    type: "konyvelo.bizonylat.sztornozva",
    version: 1,
    record: { type: "bizonylat", id: orig.id, url: `/konyveles/${orig.id}`, label: `${orig.serialNumber} sztornója: ${storno.serialNumber}` },
    causedBy,
    payload: { documentId: orig.id, serialNumber: orig.serialNumber!, reversalDocumentId: storno.id, reversalSerialNumber: storno.serialNumber!, accountingDate: storno.accountingDate },
  });
}

type SettlementRow = typeof settlements.$inferSelect;

async function settlementDocs(tx: Tx, rows: SettlementRow[]) {
  const ids = rows.flatMap((r) => [r.itemLineId, r.settlingLineId]);
  const ls = ids.length ? await tx.select({ id: journalLines.id, documentId: journalLines.documentId }).from(journalLines).where(inArray(journalLines.id, ids)) : [];
  return new Map(ls.map((l) => [l.id, l.documentId]));
}

/**
 * A kiegyenlített tétel nyitott összege MOST (a párosítás vagy bontás után, ugyanabban a tranzakcióban),
 * ugyanúgy számolva, mint a folyószámla (minden párosítás, amelyben a sor szerepel).
 */
async function itemOpenAfter(tx: Tx, itemLineId: string): Promise<number> {
  const r = await tx.execute<{ open: string }>(sql`
    SELECT abs(l.amount) - coalesce((SELECT sum(s.amount) FROM settlements s WHERE l.id IN (s.item_line_id, s.settling_line_id)), 0) AS open
    FROM journal_lines l WHERE l.id = ${itemLineId}`);
  return Math.max(0, Number(r.rows[0]?.open ?? 0));
}

/** Ha a kiegyenlített bizonylat más modul rekordjából jött vagy ahhoz kapcsolódik (pl. Készlet-beszerzés, -eladás). */
async function settledSources(tx: Tx, documentId: string) {
  const rows = await tx
    .selectDistinct({ module: integrationRecords.sourceModule, recordType: integrationRecords.sourceRecordType, recordId: integrationRecords.sourceRecordId })
    .from(integrationRecords)
    .where(and(eq(integrationRecords.documentId, documentId), inArray(integrationRecords.kind, ["PURCHASE", "PURCHASE_LINK", "SALE_LINK"])));
  return rows.sort((a, b) => `${a.module}/${a.recordType}/${a.recordId}`.localeCompare(`${b.module}/${b.recordType}/${b.recordId}`));
}

/** Párosítás (kiegyenlítés). A sztornó saját párosításai (az eredeti és a sztornó sorai) nem mennek ki. */
export async function emitSettlementsCreated(tx: Tx, companyId: string, rows: SettlementRow[], date: string): Promise<void> {
  const real = rows.filter((r) => r.source !== "REVERSAL");
  if (!real.length || !(await isLinked(tx, companyId))) return;
  const docOf = await settlementDocs(tx, real);
  for (const r of real) {
    const settledDocumentId = docOf.get(r.itemLineId)!;
    await emitEvent(tx, companyId, {
      type: "konyvelo.kiegyenlites.rogzitve",
      version: 3,
      record: { type: "kiegyenlites", id: r.id },
      payload: {
        settlementId: r.id,
        documentId: docOf.get(r.settlingLineId)!,
        settledDocumentId,
        amount: Math.abs(r.amount),
        date,
        itemOpenAfter: await itemOpenAfter(tx, r.itemLineId),
        settledSources: await settledSources(tx, settledDocumentId),
      },
    });
  }
}

/** Bontás. Sztornónál a hívó előbb a sztornó saját párosításait is rögzíti, így a tétel nyitott összege 0. */
export async function emitSettlementsRemoved(tx: Tx, companyId: string, rows: SettlementRow[], reason: "MANUAL" | "REVERSAL"): Promise<void> {
  const real = rows.filter((r) => r.source !== "REVERSAL");
  if (!real.length || !(await isLinked(tx, companyId))) return;
  const docOf = await settlementDocs(tx, real);
  for (const r of real) {
    const settledDocumentId = docOf.get(r.itemLineId)!;
    await emitEvent(tx, companyId, {
      type: "konyvelo.kiegyenlites.bontva",
      version: 2,
      record: { type: "kiegyenlites", id: r.id },
      payload: {
        settlementId: r.id,
        documentId: docOf.get(r.settlingLineId)!,
        settledDocumentId,
        amount: Math.abs(r.amount),
        reason,
        itemOpenAfter: await itemOpenAfter(tx, r.itemLineId),
        settledSources: await settledSources(tx, settledDocumentId),
      },
    });
  }
}

export async function emitPeriodChanged(tx: Tx, companyId: string, p: { id: string; kind: "PERIOD" | "FISCAL_YEAR"; startDate: string; endDate: string; closed: boolean }): Promise<void> {
  await emitEvent(tx, companyId, {
    type: p.closed ? "konyvelo.idoszak.lezarva" : "konyvelo.idoszak.feloldva",
    version: 1,
    record: { type: p.kind === "PERIOD" ? "idoszak" : "uzleti_ev", id: p.id },
    payload: { kind: p.kind, startDate: p.startDate, endDate: p.endDate },
  });
}

type PartnerRow = typeof partners.$inferSelect;

export async function emitPartnerChanged(tx: Tx, p: PartnerRow, causedBy: string | null = null): Promise<void> {
  const address = [p.postalCode, p.city, p.addressLine].filter(Boolean).join(" ") || null;
  await emitEvent(tx, p.companyId, {
    type: "torzs.partner.valtozott",
    version: 1,
    record: { type: "partner", id: p.id, url: `/partnerek/${p.id}`, label: p.name },
    causedBy,
    payload: {
      partner: { name: p.name, ...(p.taxNumber && TAX.test(p.taxNumber) ? { taxNumber: p.taxNumber } : {}), address },
      anonymized: p.status === "ANONYMIZED",
    },
  });
}
