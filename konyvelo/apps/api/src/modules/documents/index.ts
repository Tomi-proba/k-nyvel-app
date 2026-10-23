import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  canonicalJson,
  DOCUMENT_TYPES,
  deadlineEventDate,
  deadlineStatus,
  formatDateHu,
  formatSerialNumber,
  missingMapping,
  monthLabelHu,
  recordingDeadline,
  reverseLines,
  todayIso,
  validateForPosting,
  allocateSettlements,
  formatHuf,
  lineRole,
  validateSettlementPlan,
  type DocumentType,
} from "@konyvelo/domain";
import {
  documentInputSchema,
  reverseSchema,
  type DeadlineDto,
  type DocumentDto,
  type DocumentListItemDto,
  type DocumentListResponse,
  type DocumentParsedInput,
  type DocumentRef,
  type SettlementDto,
  type TodosDto,
} from "@konyvelo/shared";
import { writeAudit } from "../../core/audit";
import { requireCompanyPermission, type AuthUser } from "../../core/auth";
import { pgErrorCode, PG_RAISE, PG_UNIQUE_VIOLATION, type Executor, type Tx } from "../../core/db";
import { assertUuid, conflict, notFound, parseBody, validationError } from "../../core/errors";
import type { AppModule } from "../../core/modules";
import { companies, documents, documentSequences, fiscalYears, journalLines, partners, periods, settlements, users } from "../../core/schema";
import { cashOverLimit, firstNegativeCash, openItems } from "../subledger";
import { listAccounts } from "../accounts";
import { navTodos } from "../nav";

type DocRow = typeof documents.$inferSelect;
type LineRow = typeof journalLines.$inferSelect;
type AccountMap = Map<string, Awaited<ReturnType<typeof listAccounts>>[number]>;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const localDate = (d: Date) => todayIso(d);

async function accountMap(db: Executor, companyId: string): Promise<AccountMap> {
  return new Map((await listAccounts(db, companyId)).map((a) => [a.id, a]));
}

async function fiscalYearFor(db: Executor, companyId: string, date: string) {
  const [fy] = await db
    .select()
    .from(fiscalYears)
    .where(and(eq(fiscalYears.companyId, companyId), sql`${date}::date BETWEEN ${fiscalYears.startDate} AND ${fiscalYears.endDate}`))
    .limit(1);
  return fy ?? null;
}

async function loadDoc(db: Executor, companyId: string, id: string, lock = false): Promise<DocRow> {
  assertUuid(id, "A bizonylat nem található.");
  const q = db
    .select()
    .from(documents)
    .where(and(eq(documents.companyId, companyId), eq(documents.id, id)))
    .limit(1);
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw notFound("A bizonylat nem található.");
  return row;
}

function deadlineOf(
  doc: Pick<DocRow, "fulfillmentDate" | "issueDate" | "accountingDate" | "postedAt">,
  flags: { touchesCash: boolean; touchesBank: boolean },
  today = todayIso(),
): DeadlineDto {
  const d = recordingDeadline({ eventDate: deadlineEventDate(doc), ...flags });
  return {
    kind: d.kind,
    deadline: d.deadline,
    rule: d.rule,
    status: deadlineStatus(d.deadline, { postedOn: doc.postedAt ? localDate(doc.postedAt) : null, today }),
  };
}

function touches(lines: Array<Pick<LineRow, "accountId">>, accounts: AccountMap) {
  const subs = lines.map((l) => (l.accountId ? accounts.get(l.accountId)?.subledger : undefined));
  return { touchesCash: subs.includes("CASH"), touchesBank: subs.includes("BANK") };
}

/** A trigger által dobott (P0001) hibák felhasználóbarát válaszként. */
function mapDbError(err: unknown): never {
  const code = pgErrorCode(err);
  if (code === PG_RAISE) throw conflict((err as Error).message);
  if (code === PG_UNIQUE_VIOLATION) throw conflict("A bizonylatot időközben már sztornózták vagy könyvelték. Frissítse az oldalt.");
  throw err;
}

// ---------- Részletes nézet ----------

async function refOf(db: Executor, id: string | null): Promise<DocumentRef | null> {
  if (!id) return null;
  const [r] = await db.select({ id: documents.id, serialNumber: documents.serialNumber, status: documents.status }).from(documents).where(eq(documents.id, id));
  return r ?? null;
}

export async function documentDto(db: Executor, companyId: string, id: string): Promise<DocumentDto> {
  const doc = await loadDoc(db, companyId, id);
  const accounts = await accountMap(db, companyId);
  const lines = await db.select().from(journalLines).where(eq(journalLines.documentId, doc.id)).orderBy(asc(journalLines.lineNo));
  const userIds = [doc.createdBy, doc.postedBy].filter((v): v is string => Boolean(v));
  const names = new Map((await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds))).map((u) => [u.id, u.name]));
  const [partner] = doc.partnerId ? await db.select({ name: partners.name }).from(partners).where(eq(partners.id, doc.partnerId)) : [];
  const [reversedBy] = await db
    .select({ id: documents.id, serialNumber: documents.serialNumber, status: documents.status })
    .from(documents)
    .where(eq(documents.reversesDocumentId, doc.id));
  const correctedBy = await db
    .select({ id: documents.id, serialNumber: documents.serialNumber, status: documents.status })
    .from(documents)
    .where(eq(documents.correctsDocumentId, doc.id))
    .orderBy(asc(documents.createdAt));
  const total = (side: "D" | "C") => lines.filter((l) => l.side === side).reduce((s, l) => s + l.amount, 0);
  const lineIds = lines.map((l) => l.id);
  const pairs = lineIds.length
    ? await db.execute<{ id: string; item_line_id: string; settling_line_id: string; amount: string; source: SettlementDto["source"]; other_doc: string; other_serial: string | null; other_ext: string | null }>(sql`
        SELECT s.id, s.item_line_id, s.settling_line_id, s.amount, s.source, od.id AS other_doc, od.serial_number AS other_serial, od.external_number AS other_ext
          FROM settlements s
          JOIN journal_lines ol ON ol.id = CASE WHEN s.item_line_id IN (${sql.join(lineIds.map((x) => sql`${x}`), sql`, `)}) THEN s.settling_line_id ELSE s.item_line_id END
          JOIN documents od ON od.id = ol.document_id
         WHERE s.item_line_id IN (${sql.join(lineIds.map((x) => sql`${x}`), sql`, `)}) OR s.settling_line_id IN (${sql.join(lineIds.map((x) => sql`${x}`), sql`, `)})
         ORDER BY s.created_at`)
    : { rows: [] };
  const own = new Set(lineIds);
  return {
    id: doc.id,
    docType: doc.docType,
    status: doc.status,
    serialNumber: doc.serialNumber,
    fiscalYearId: doc.fiscalYearId,
    partnerId: doc.partnerId,
    partnerName: partner?.name ?? null,
    externalNumber: doc.externalNumber,
    description: doc.description,
    issueDate: doc.issueDate,
    fulfillmentDate: doc.fulfillmentDate,
    accountingDate: doc.accountingDate,
    dueDate: doc.dueDate,
    currency: doc.currency,
    fxAmount: doc.fxAmount,
    fxRate: doc.fxRate,
    fxRateSource: doc.fxRateSource,
    fxRateDate: doc.fxRateDate,
    authorizedBy: doc.authorizedBy,
    checkedBy: doc.checkedBy,
    source: doc.source,
    templateId: doc.templateId,
    reverses: await refOf(db, doc.reversesDocumentId),
    corrects: await refOf(db, doc.correctsDocumentId),
    reversedBy: reversedBy ?? null,
    correctedBy,
    affectsFiscalYearId: doc.affectsFiscalYearId,
    totalDebit: total("D"),
    totalCredit: total("C"),
    createdAt: doc.createdAt.toISOString(),
    createdByName: names.get(doc.createdBy) ?? null,
    updatedAt: doc.updatedAt.toISOString(),
    postedAt: doc.postedAt?.toISOString() ?? null,
    postedByName: doc.postedBy ? (names.get(doc.postedBy) ?? null) : null,
    contentHash: doc.contentHash,
    deadline: deadlineOf(doc, touches(lines, accounts)),
    settlementPlan: doc.settlementPlan,
    settlements: pairs.rows.map((r) => ({
      id: r.id,
      lineId: own.has(r.item_line_id) ? r.item_line_id : r.settling_line_id,
      otherDocumentId: r.other_doc,
      otherSerialNumber: r.other_serial,
      otherExternalNumber: r.other_ext,
      role: own.has(r.item_line_id) ? ("ITEM" as const) : ("PAYMENT" as const),
      amount: Number(r.amount),
      source: r.source,
    })),
    lines: lines.map((l) => {
      const a = l.accountId ? accounts.get(l.accountId) : undefined;
      return {
        id: l.id,
        lineNo: l.lineNo,
        accountId: l.accountId,
        accountNumber: a?.number ?? null,
        accountName: a?.name ?? null,
        side: l.side,
        amount: l.amount,
        partnerId: l.partnerId,
        description: l.description,
      };
    }),
  };
}

// ---------- Lista ----------

type ListRow = {
  id: string;
  doc_type: DocumentType;
  status: "DRAFT" | "POSTED";
  serial_number: string | null;
  accounting_date: string;
  issue_date: string | null;
  fulfillment_date: string | null;
  posted_at: Date | null;
  updated_at: Date;
  partner_name: string | null;
  external_number: string | null;
  description: string | null;
  total: string;
  touches_cash: boolean | null;
  touches_bank: boolean | null;
  reversed: boolean;
};

async function queryDocuments(db: Executor, companyId: string, where: ReturnType<typeof sql>[], limit: number, offset: number): Promise<{ rows: ListRow[]; total: number }> {
  const result = await db.execute<ListRow & { total_count: string }>(sql`
    SELECT d.id, d.doc_type, d.status, d.serial_number, d.accounting_date, d.issue_date, d.fulfillment_date, d.posted_at, d.updated_at,
           p.name AS partner_name, d.external_number, d.description,
           coalesce(sum(l.amount) FILTER (WHERE l.side = 'D'), 0) AS total,
           bool_or(a.subledger = 'CASH') AS touches_cash,
           bool_or(a.subledger = 'BANK') AS touches_bank,
           EXISTS (SELECT 1 FROM documents r WHERE r.reverses_document_id = d.id) AS reversed,
           count(*) OVER () AS total_count
      FROM documents d
      LEFT JOIN partners p ON p.id = d.partner_id
      LEFT JOIN journal_lines l ON l.document_id = d.id
      LEFT JOIN accounts a ON a.id = l.account_id
     WHERE d.company_id = ${companyId} ${where.length ? sql`AND ${sql.join(where, sql` AND `)}` : sql``}
     GROUP BY d.id, p.name
     ORDER BY d.accounting_date DESC, d.status ASC, d.seq_no DESC NULLS FIRST, d.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`);
  const rows = result.rows.map((r) => ({ ...r, posted_at: r.posted_at ? new Date(r.posted_at) : null, updated_at: new Date(r.updated_at) }));
  return { rows, total: Number(result.rows[0]?.total_count ?? 0) };
}

function listItem(r: ListRow, today: string): DocumentListItemDto {
  return {
    id: r.id,
    docType: r.doc_type,
    status: r.status,
    serialNumber: r.serial_number,
    accountingDate: r.accounting_date,
    partnerName: r.partner_name,
    externalNumber: r.external_number,
    description: r.description,
    total: Number(r.total),
    reversed: r.reversed,
    deadline: deadlineOf(
      { fulfillmentDate: r.fulfillment_date, issueDate: r.issue_date, accountingDate: r.accounting_date, postedAt: r.posted_at },
      { touchesCash: Boolean(r.touches_cash), touchesBank: Boolean(r.touches_bank) },
      today,
    ),
  };
}

// ---------- Mentés (piszkozat) ----------

/** Piszkozat mentése: a hivatkozások ellenőrzése, a fejadatok és a tételsorok írása. */
async function saveDraft(
  tx: Tx,
  companyId: string,
  user: AuthUser,
  input: DocumentParsedInput,
  existing: DocRow | null,
  origin: "NAV_IMPORT" | null = null,
): Promise<string> {
  const fy = await fiscalYearFor(tx, companyId, input.accountingDate);
  if (!fy) {
    throw validationError({
      accountingDate: `A könyvelés dátuma (${formatDateHu(input.accountingDate)}) egyik üzleti évbe sem esik. Előbb hozza létre az üzleti évet a Beállításokban.`,
    });
  }
  const errors: Record<string, string> = {};
  const accounts = await accountMap(tx, companyId);
  input.lines.forEach((l, i) => {
    if (l.accountId && !accounts.has(l.accountId)) errors[`lines.${i}.accountId`] = "A választott számla nem található ebben a cégben.";
  });
  if (input.partnerId) {
    const [p] = await tx.select({ status: partners.status }).from(partners).where(and(eq(partners.companyId, companyId), eq(partners.id, input.partnerId)));
    if (!p || p.status === "ANONYMIZED") errors.partnerId = "A választott partner nem található.";
  }
  let corrects: DocRow | null = null;
  if (input.docType === "HELY") {
    if (!input.correctsDocumentId) errors.docType = "A helyesbítő bizonylatnak hivatkoznia kell az eredeti bizonylatra.";
    else {
      corrects = await loadDoc(tx, companyId, input.correctsDocumentId).catch(() => null);
      if (!corrects || corrects.status !== "POSTED") errors.correctsDocumentId = "Csak könyvelt bizonylat helyesbíthető.";
      else if (corrects.docType === "SZT") errors.correctsDocumentId = "Sztornó bizonylat nem helyesbíthető; rögzítsen új bizonylatot.";
    }
  }
  if (Object.keys(errors).length) throw validationError(errors);

  const values = {
    fiscalYearId: fy.id,
    docType: input.docType,
    externalNumber: input.externalNumber ?? null,
    partnerId: input.partnerId ?? null,
    description: input.description ?? null,
    issueDate: input.issueDate ?? null,
    fulfillmentDate: input.fulfillmentDate ?? null,
    accountingDate: input.accountingDate,
    dueDate: input.dueDate ?? null,
    currency: input.currency,
    fxAmount: input.currency === "HUF" ? null : (input.fxAmount ?? null),
    fxRate: input.currency === "HUF" ? null : (input.fxRate ?? null),
    fxRateSource: input.currency === "HUF" ? null : (input.fxRateSource ?? null),
    fxRateDate: input.currency === "HUF" ? null : (input.fxRateDate ?? null),
    authorizedBy: input.authorizedBy ?? null,
    checkedBy: input.checkedBy ?? null,
    correctsDocumentId: corrects?.id ?? null,
    // Előző évet érintő hiba: a helyesbített bizonylat más üzleti évbe tartozik (K 5.4).
    affectsFiscalYearId: corrects && corrects.fiscalYearId !== fy.id ? corrects.fiscalYearId : null,
    templateId: input.templateId ?? null,
    // A NAV-ból jött bizonylat eredete a piszkozat szerkesztése után is megmarad.
    source: origin ?? (existing?.source === "NAV_IMPORT" ? "NAV_IMPORT" : input.templateId ? "TEMPLATE" : "MANUAL"),
    settlementPlan: input.settlements,
    updatedAt: new Date(),
  };

  let id: string;
  if (existing) {
    await tx.update(documents).set(values).where(eq(documents.id, existing.id));
    await tx.delete(journalLines).where(eq(journalLines.documentId, existing.id));
    id = existing.id;
  } else {
    const [row] = await tx
      .insert(documents)
      .values({ ...values, companyId, createdBy: user.id })
      .returning({ id: documents.id });
    id = row!.id;
  }

  // A teljesen üres sorokat nem tároljuk; a félkész sorok piszkozatban megmaradnak.
  const lines = input.lines.filter((l) => l.accountId || l.amount || l.description);
  if (lines.length) {
    await tx.insert(journalLines).values(
      lines.map((l, i) => {
        const sub = l.accountId ? accounts.get(l.accountId)?.subledger : undefined;
        return {
          companyId,
          documentId: id,
          lineNo: i + 1,
          accountId: l.accountId ?? null,
          side: l.side ?? null,
          amount: l.amount ?? 0,
          // Vevő- és szállítóanalitikás számlánál a tétel a partnerhez tartozik.
          partnerId: sub === "CUSTOMER" || sub === "SUPPLIER" ? (input.partnerId ?? null) : null,
          description: l.description ?? null,
        };
      }),
    );
  }
  return id;
}

function auditSummary(doc: Pick<DocRow, "docType" | "description" | "accountingDate" | "partnerId" | "externalNumber">, lines: Array<{ side: string | null; amount: number }>) {
  return {
    docType: doc.docType,
    description: doc.description,
    accountingDate: doc.accountingDate,
    partnerId: doc.partnerId,
    externalNumber: doc.externalNumber,
    lines: lines.length,
    total: lines.filter((l) => l.side === "D").reduce((s, l) => s + l.amount, 0),
  };
}

// ---------- Könyvelés ----------

/**
 * Könyvelés: teljes ellenőrzés, hézagmentes sorszám, tartalmi hash és a
 * cégenkénti hash-lánc következő eleme. A cégszintű zár sorba rendezi az
 * egyidejű könyveléseket (sorszám és lánc).
 */
export async function postDocument(tx: Tx, companyId: string, docId: string, user: AuthUser, ip: string, opts: { reversal?: boolean } = {}): Promise<DocRow> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"documents-post:" + companyId}, 0))`);
  const doc = await loadDoc(tx, companyId, docId, true);
  if (doc.status === "POSTED") throw conflict(`A bizonylat már könyvelve van (${doc.serialNumber}).`);
  const lines = await tx.select().from(journalLines).where(eq(journalLines.documentId, doc.id)).orderBy(asc(journalLines.lineNo));
  const accounts = await accountMap(tx, companyId);

  const errors = validateForPosting({ ...doc, lines }, (id) => accounts.get(id), { allowNegative: doc.docType === "SZT" });
  lines.forEach((l, i) => {
    const a = l.accountId ? accounts.get(l.accountId) : undefined;
    if (!a || errors[`lines.${i}.accountId`]) return;
    if (a.hasChildren) errors[`lines.${i}.accountId`] = `A(z) ${a.number} gyűjtőszámla; válasszon alszámlát.`;
    // A sztornó az eredeti számlákra könyvel akkor is, ha azokat azóta inaktiválták.
    else if (!a.isActive && !opts.reversal) errors[`lines.${i}.accountId`] = `A(z) ${a.number} számla inaktív.`;
  });
  if (doc.partnerId && !errors.partnerId) {
    const [p] = await tx.select({ kind: partners.kind, status: partners.status, name: partners.name }).from(partners).where(eq(partners.id, doc.partnerId));
    const wanted = DOCUMENT_TYPES[doc.docType].partnerKind;
    if (!p || (p.status !== "ACTIVE" && !opts.reversal)) errors.partnerId = "A választott partner inaktív; aktiválja, vagy válasszon másikat.";
    else if (p && wanted !== "ANY" && p.kind !== wanted && p.kind !== "BOTH") {
      errors.partnerId = wanted === "SUPPLIER" ? `${p.name} nem szállító; a partneradatoknál állítsa át.` : `${p.name} nem vevő; a partneradatoknál állítsa át.`;
    }
  }
  const [fy] = await tx.select().from(fiscalYears).where(eq(fiscalYears.id, doc.fiscalYearId));
  const [period] = await tx
    .select()
    .from(periods)
    .where(and(eq(periods.fiscalYearId, doc.fiscalYearId), sql`${doc.accountingDate}::date BETWEEN ${periods.startDate} AND ${periods.endDate}`));
  if (fy!.status === "CLOSED") {
    errors.accountingDate = "Az üzleti év lezárt, ide nem lehet könyvelni. Rögzítse helyesbítő bizonylatként a nyitott időszakban.";
  } else if (fy!.status === "CLOSING") {
    // Zárlati állapotban csak a mérlegfordulónapra lehet könyvelni (zárlati tételek, Szt. 164. § (1)).
    if (doc.accountingDate !== fy!.endDate) {
      errors.accountingDate = `Az üzleti év zárlati állapotban van: csak a mérlegfordulónapra (${formatDateHu(fy!.endDate)}) lehet zárlati tételt könyvelni.`;
    }
  } else if (!period || period.status === "CLOSED") {
    errors.accountingDate = `A(z) ${monthLabelHu(doc.accountingDate)} lezárt időszak, ide nem lehet könyvelni. Rögzítse helyesbítő tételként a nyitott időszakban.`;
  }
  // Kiegyenlítendő tételek (K 4.4): a partner nyitott tételei közül.
  const plan = opts.reversal ? [] : doc.settlementPlan;
  const open = plan.length ? await openItems(tx, companyId, { partnerId: doc.partnerId ?? undefined }) : null;
  if (open) {
    const byLine = new Map(open.items.map((i) => [i.lineId, i]));
    Object.assign(
      errors,
      validateSettlementPlan(
        plan,
        lines,
        (id) => {
          const i = byLine.get(id);
          return i && { lineId: i.lineId, accountId: i.accountId, accountNumber: i.accountNumber, partnerId: i.partnerId, open: i.open, label: i.serialNumber ?? "" };
        },
        (id) => accounts.get(id)?.subledger,
        doc.partnerId,
      ),
    );
  }
  // Pénztár: az egyenleg egyik napon sem lehet negatív (PLAN 4.7).
  if (!opts.reversal) {
    for (const accountId of new Set(lines.map((l) => l.accountId).filter((id): id is string => Boolean(id)))) {
      const a = accounts.get(accountId);
      if (a?.subledger !== "CASH") continue;
      const neg = await firstNegativeCash(tx, accountId, doc.id, doc.accountingDate);
      if (neg) {
        errors.cash = `A(z) ${a.number} pénztár egyenlege negatív lenne (${formatDateHu(neg.date)}: ${formatHuf(neg.balance)}). Pénztárból csak a meglévő készpénz adható ki; előbb a bevételt rögzítse.`;
      }
    }
  }
  if (Object.keys(errors).length) throw validationError(errors, "A bizonylat nem könyvelhető. Kérjük, javítsa a megjelölt hibákat.");

  const [seq] = await tx
    .insert(documentSequences)
    .values({ companyId, fiscalYearId: doc.fiscalYearId, docType: doc.docType, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [documentSequences.companyId, documentSequences.fiscalYearId, documentSequences.docType],
      set: { lastNumber: sql`${documentSequences.lastNumber} + 1` },
    })
    .returning({ n: documentSequences.lastNumber });
  const seqNo = seq!.n;
  const serialNumber = formatSerialNumber(doc.docType, fy!.startDate, seqNo);

  const [prev] = await tx
    .select({ hash: documents.contentHash })
    .from(documents)
    .where(and(eq(documents.companyId, companyId), eq(documents.status, "POSTED")))
    .orderBy(desc(documents.postedAt), desc(documents.id))
    .limit(1);
  const prevHash = prev?.hash ?? null;
  const postedAt = new Date();
  const contentHash = sha256(
    canonicalJson({
      v: 1,
      prevHash,
      companyId,
      id: doc.id,
      serialNumber,
      docType: doc.docType,
      partnerId: doc.partnerId,
      externalNumber: doc.externalNumber,
      description: doc.description,
      issueDate: doc.issueDate,
      fulfillmentDate: doc.fulfillmentDate,
      accountingDate: doc.accountingDate,
      dueDate: doc.dueDate,
      currency: doc.currency,
      fxAmount: doc.fxAmount,
      fxRate: doc.fxRate,
      reversesDocumentId: doc.reversesDocumentId,
      correctsDocumentId: doc.correctsDocumentId,
      postedAt: postedAt.toISOString(),
      postedBy: user.id,
      lines: lines.map((l) => ({
        lineNo: l.lineNo,
        accountId: l.accountId,
        accountNumber: accounts.get(l.accountId!)?.number,
        side: l.side,
        amount: l.amount,
        partnerId: l.partnerId,
        description: l.description,
      })),
    }),
  );

  const [posted] = await tx
    .update(documents)
    .set({ status: "POSTED", seqNo, serialNumber, postedAt, postedBy: user.id, contentHash, prevHash, updatedAt: postedAt })
    .where(eq(documents.id, doc.id))
    .returning();
  if (open && plan.length) {
    const itemAccount = new Map(open.items.map((i) => [i.lineId, i.accountId]));
    const pairs = allocateSettlements(plan, lines as Array<(typeof lines)[number]>, (id) => itemAccount.get(id), (id) => accounts.get(id)?.subledger);
    if (pairs.length) await tx.insert(settlements).values(pairs.map((p) => ({ ...p, companyId, source: "ENTRY" as const, createdBy: user.id })));
  }
  await writeAudit(tx, {
    companyId,
    userId: user.id,
    action: "document.post",
    entityType: "document",
    entityId: doc.id,
    after: { serialNumber, ...auditSummary(doc, lines), contentHash },
    ip,
  });
  return posted!;
}


/**
 * Sztornó: új, azonnal könyvelt bizonylat ugyanazokkal a tételekkel (a cég
 * beállítása szerint fordított oldalon vagy negatív előjellel), hivatkozással
 * az eredetire. Az analitikai párosítások felbomlanak, az eredeti analitikás
 * sorait a sztornó sorai egyenlítik ki.
 */
export async function reverseDocument(
  tx: Tx,
  companyId: string,
  documentId: string,
  user: AuthUser,
  ip: string,
  input: { accountingDate: string; reason: string },
): Promise<string> {
    const orig = await loadDoc(tx, companyId, documentId, true);
    const [company] = await tx.select({ reversalMethod: companies.reversalMethod }).from(companies).where(eq(companies.id, companyId));
    if (orig.status !== "POSTED") throw conflict("Csak könyvelt bizonylat sztornózható; a piszkozat egyszerűen törölhető.");
    if (orig.docType === "SZT") throw conflict("Sztornó bizonylat nem sztornózható. Ha hibás volt, rögzítse újra az eredeti tételt.");
    const [already] = await tx.select({ serial: documents.serialNumber }).from(documents).where(eq(documents.reversesDocumentId, orig.id));
    if (already) throw conflict(`A bizonylatot már sztornózták (${already.serial}).`);
    const fy = await fiscalYearFor(tx, companyId, input.accountingDate);
    if (!fy) throw validationError({ accountingDate: `A dátum (${formatDateHu(input.accountingDate)}) egyik üzleti évbe sem esik.` });

    const origLines = await tx.select().from(journalLines).where(eq(journalLines.documentId, orig.id)).orderBy(asc(journalLines.lineNo));
    const [storno] = await tx
      .insert(documents)
      .values({
        companyId,
        fiscalYearId: fy.id,
        docType: "SZT",
        externalNumber: orig.serialNumber,
        partnerId: orig.partnerId,
        description: `Sztornó: ${orig.serialNumber} – ${input.reason}`,
        issueDate: todayIso(),
        fulfillmentDate: orig.fulfillmentDate,
        accountingDate: input.accountingDate,
        currency: orig.currency,
        fxAmount: orig.fxAmount,
        fxRate: orig.fxRate,
        fxRateSource: orig.fxRateSource,
        fxRateDate: orig.fxRateDate,
        reversesDocumentId: orig.id,
        affectsFiscalYearId: orig.fiscalYearId !== fy.id ? orig.fiscalYearId : null,
        source: "REVERSAL",
        createdBy: user.id,
      })
      .returning({ id: documents.id });
    await tx.insert(journalLines).values(
      reverseLines(
        origLines.map((l) => ({ ...l, side: l.side! })),
        company!.reversalMethod,
      ).map(({ id: _id, documentId: _d, ...l }) => ({ ...l, documentId: storno!.id })),
    );
    const posted = await postDocument(tx, companyId, storno!.id, user, ip, { reversal: true });
    // Analitika: az eredeti bizonylat párosításai felbomlanak (pl. a kifizetett számla sztornójánál a
    // fizetés újra párosítatlan lesz), az eredeti analitikás sorait pedig a sztornó sorai egyenlítik ki.
    const origIds = origLines.map((l) => l.id);
    const removed = await tx
      .delete(settlements)
      .where(sql`${settlements.itemLineId} IN (${sql.join(origIds.map((x) => sql`${x}`), sql`, `)}) OR ${settlements.settlingLineId} IN (${sql.join(origIds.map((x) => sql`${x}`), sql`, `)})`)
      .returning();
    const accs = await accountMap(tx, companyId);
    const stornoLines = await tx.select().from(journalLines).where(eq(journalLines.documentId, storno!.id)).orderBy(asc(journalLines.lineNo));
    const pairs = origLines.flatMap((l, i) => {
      const sub = l.accountId ? accs.get(l.accountId)?.subledger : undefined;
      const s = stornoLines[i];
      if (!s || !sub || !l.side || !lineRole(sub, l.side) || !l.partnerId) return [];
      return [{ companyId, itemLineId: l.id, settlingLineId: s.id, amount: Math.abs(l.amount), source: "REVERSAL" as const, createdBy: user.id }];
    });
    if (pairs.length) await tx.insert(settlements).values(pairs);
    if (removed.length) {
      await writeAudit(tx, {
        companyId,
        userId: user.id,
        action: "settlement.delete",
        entityType: "document",
        entityId: orig.id,
        before: { reason: "sztornó", settlements: removed.map((r) => ({ itemLineId: r.itemLineId, settlingLineId: r.settlingLineId, amount: r.amount })) },
        ip: ip,
      });
    }
    await writeAudit(tx, {
      companyId,
      userId: user.id,
      action: "document.reverse",
      entityType: "document",
      entityId: orig.id,
      after: { serialNumber: orig.serialNumber, reversalSerialNumber: posted.serialNumber, reason: input.reason, accountingDate: input.accountingDate },
      ip: ip,
    });
    return storno!.id;
}

/** Rendszer által létrehozott (nyitó, záró) bizonylat rögzítése és azonnali könyvelése. */
export async function createSystemDocument(
  tx: Tx,
  companyId: string,
  user: AuthUser,
  ip: string,
  d: {
    docType: "NYIT" | "ZAR";
    accountingDate: string;
    description: string;
    partnerId?: string | null;
    externalNumber?: string | null;
    issueDate?: string | null;
    dueDate?: string | null;
    lines: Array<{ accountId: string; side: "D" | "C"; amount: number; partnerId?: string | null }>;
  },
): Promise<DocRow> {
  const fy = await fiscalYearFor(tx, companyId, d.accountingDate);
  if (!fy) throw validationError({ accountingDate: `A dátum (${formatDateHu(d.accountingDate)}) egyik üzleti évbe sem esik.` });
  const [doc] = await tx
    .insert(documents)
    .values({
      companyId,
      fiscalYearId: fy.id,
      docType: d.docType,
      partnerId: d.partnerId ?? null,
      externalNumber: d.externalNumber ?? null,
      description: d.description,
      issueDate: d.issueDate ?? d.accountingDate,
      accountingDate: d.accountingDate,
      dueDate: d.dueDate ?? null,
      source: d.docType === "NYIT" ? "OPENING" : "CLOSING",
      createdBy: user.id,
    })
    .returning({ id: documents.id });
  await tx.insert(journalLines).values(
    d.lines.map((l, i) => ({ companyId, documentId: doc!.id, lineNo: i + 1, accountId: l.accountId, side: l.side, amount: l.amount, partnerId: l.partnerId ?? null })),
  );
  return postDocument(tx, companyId, doc!.id, user, ip, { reversal: true });
}

/**
 * Új bizonylat (piszkozat, vagy `post: true` esetén azonnal könyvelve) a hívó tranzakciójában, audit
 * naplóval. A NAV-import jóváhagyása is ezt használja, így ugyanazok az ellenőrzések futnak.
 */
export async function createDocument(
  tx: Tx,
  companyId: string,
  user: AuthUser,
  ip: string,
  input: DocumentParsedInput,
  origin: "NAV_IMPORT" | null = null,
): Promise<string> {
  const newId = await saveDraft(tx, companyId, user, input, null, origin);
  const doc = await loadDoc(tx, companyId, newId);
  const lines = await tx.select().from(journalLines).where(eq(journalLines.documentId, newId));
  await writeAudit(tx, {
    companyId,
    userId: user.id,
    action: "document.create",
    entityType: "document",
    entityId: newId,
    after: { ...auditSummary(doc, lines), ...(origin ? { source: origin } : {}) },
    ip,
  });
  if (input.post) await postDocument(tx, companyId, newId, user, ip);
  return newId;
}

export { mapDbError as mapDocumentDbError };

// ---------- Útvonalak ----------

export const documentsModule: AppModule = {
  name: "documents",
  register(app, { db }) {
    const base = "/api/companies/:companyId/documents";
    type P = { Params: { companyId: string } };
    type PD = { Params: { companyId: string; documentId: string } };
    type Q = {
      Params: { companyId: string };
      Querystring: { status?: string; type?: string; q?: string; from?: string; to?: string; fiscalYearId?: string; late?: string; limit?: string; offset?: string };
    };

    app.get<Q>(base, async (request): Promise<DocumentListResponse> => {
      const { companyId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      const { status, type, q, from, to, fiscalYearId, late } = request.query;
      const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 500);
      const offset = Math.max(Number(request.query.offset) || 0, 0);
      const where: ReturnType<typeof sql>[] = [];
      if (status === "DRAFT" || status === "POSTED") where.push(sql`d.status = ${status}`);
      if (status === "REVERSED") where.push(sql`EXISTS (SELECT 1 FROM documents r WHERE r.reverses_document_id = d.id)`);
      if (type && type in DOCUMENT_TYPES) where.push(sql`d.doc_type = ${type}`);
      if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) where.push(sql`d.accounting_date >= ${from}::date`);
      if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) where.push(sql`d.accounting_date <= ${to}::date`);
      if (fiscalYearId && /^[0-9a-f-]{36}$/i.test(fiscalYearId)) where.push(sql`d.fiscal_year_id = ${fiscalYearId}`);
      const query = q?.trim();
      if (query) {
        const like = `%${query.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
        where.push(sql`(d.serial_number ILIKE ${like} OR d.external_number ILIKE ${like} OR d.description ILIKE ${like} OR p.name ILIKE ${like})`);
      }
      const today = todayIso();
      if (late === "1") {
        // A késve könyvelt bizonylatokat a határidő-szabály alapján szűrjük (egy helyen van a logika).
        where.push(sql`d.status = 'POSTED'`, sql`d.posted_at >= now() - interval '1 year'`);
        const { rows } = await queryDocuments(db, companyId, where, 5000, 0);
        const items = rows.map((r) => listItem(r, today)).filter((i) => i.deadline.status === "LATE");
        return { items: items.slice(offset, offset + limit), total: items.length };
      }
      const { rows, total } = await queryDocuments(db, companyId, where, limit, offset);
      return { items: rows.map((r) => listItem(r, today)), total };
    });

    app.get<PD>(`${base}/:documentId`, async (request) => {
      const { companyId, documentId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      return documentDto(db, companyId, documentId);
    });

    /** Új bizonylat: piszkozat, vagy `post: true` esetén azonnal könyvelve (egy tranzakcióban). */
    app.post<P>(base, async (request, reply) => {
      const { companyId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      const input = parseBody(documentInputSchema, request.body);
      const id = await db.transaction((tx) => createDocument(tx, companyId, user, request.ip, input)).catch(mapDbError);
      return reply.code(201).send(await documentDto(db, companyId, id));
    });

    /** Piszkozat módosítása (a tételsorok teljes cseréjével); `post: true` esetén utána könyvelés. */
    app.patch<PD>(`${base}/:documentId`, async (request) => {
      const { companyId, documentId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      const input = parseBody(documentInputSchema, request.body);
      await db
        .transaction(async (tx) => {
          const before = await loadDoc(tx, companyId, documentId, true);
          if (before.status === "POSTED") {
            throw conflict("Könyvelt bizonylat nem módosítható. Javítani sztornóval vagy helyesbítő bizonylattal lehet.");
          }
          const beforeLines = await tx.select().from(journalLines).where(eq(journalLines.documentId, before.id));
          await saveDraft(tx, companyId, user, input, before);
          const after = await loadDoc(tx, companyId, documentId);
          const afterLines = await tx.select().from(journalLines).where(eq(journalLines.documentId, before.id));
          const b = auditSummary(before, beforeLines);
          const a = auditSummary(after, afterLines);
          if (JSON.stringify(a) !== JSON.stringify(b)) {
            await writeAudit(tx, {
              companyId,
              userId: user.id,
              action: "document.update",
              entityType: "document",
              entityId: before.id,
              before: b,
              after: a,
              ip: request.ip,
            });
          }
          if (input.post) await postDocument(tx, companyId, before.id, user, request.ip);
        })
        .catch(mapDbError);
      return documentDto(db, companyId, documentId);
    });

    /** Csak piszkozat törölhető; könyvelt bizonylatot sztornózni kell. */
    app.delete<PD>(`${base}/:documentId`, async (request) => {
      const { companyId, documentId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      await db
        .transaction(async (tx) => {
          const doc = await loadDoc(tx, companyId, documentId, true);
          if (doc.status === "POSTED") throw conflict("Könyvelt bizonylat nem törölhető. Javítani sztornóval vagy helyesbítő bizonylattal lehet.");
          const lines = await tx.select().from(journalLines).where(eq(journalLines.documentId, doc.id));
          await tx.delete(journalLines).where(eq(journalLines.documentId, doc.id));
          await tx.delete(documents).where(eq(documents.id, doc.id));
          await writeAudit(tx, {
            companyId,
            userId: user.id,
            action: "document.delete",
            entityType: "document",
            entityId: doc.id,
            before: auditSummary(doc, lines),
            ip: request.ip,
          });
        })
        .catch(mapDbError);
      return { ok: true };
    });

    app.post<PD>(`${base}/:documentId/post`, async (request) => {
      const { companyId, documentId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      await db.transaction((tx) => postDocument(tx, companyId, documentId, user, request.ip)).catch(mapDbError);
      return documentDto(db, companyId, documentId);
    });

    /**
     * Sztornó: új, azonnal könyvelt bizonylat ugyanazokkal a tételekkel
     * fordított oldalon, hivatkozással az eredetire. Egy bizonylat csak
     * egyszer sztornózható; sztornó bizonylat nem sztornózható.
     */
    app.post<PD>(`${base}/:documentId/reverse`, async (request, reply) => {
      const { companyId, documentId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      const input = parseBody(reverseSchema, request.body);
      const id = await db
        .transaction(async (tx) => {
          return reverseDocument(tx, companyId, documentId, user, request.ip, input);
        })
        .catch(mapDbError);
      return reply.code(201).send(await documentDto(db, companyId, id));
    });

    /** A Kezdőlap teendői: piszkozatok a rögzítési határidővel, késve könyvelt bizonylatok, hiányzó kimutatássorok. */
    app.get<P>("/api/companies/:companyId/todos", async (request): Promise<TodosDto> => {
      const { companyId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      const today = todayIso();
      const drafts = await queryDocuments(db, companyId, [sql`d.status = 'DRAFT'`], 1000, 0);
      const recent = await queryDocuments(db, companyId, [sql`d.status = 'POSTED'`, sql`d.posted_at >= now() - interval '30 days'`], 5000, 0);
      const accounts = await listAccounts(db, companyId);
      const open = await openItems(db, companyId, { asOf: today });
      const overdue = (kind: "RECEIVABLE" | "PAYABLE") => {
        const list = open.items.filter((i) => i.kind === kind && i.daysOverdue > 0);
        return { count: list.length, total: list.reduce((s, i) => s + i.open, 0) };
      };
      return {
        nav: await navTodos(db, companyId),
        overdueReceivables: overdue("RECEIVABLE"),
        overduePayables: overdue("PAYABLE"),
        unappliedPayments: open.unapplied.length,
        cashOverLimit: await cashOverLimit(db, companyId),
        drafts: drafts.rows
          .map((r) => {
            const item = listItem(r, today);
            return {
              id: r.id,
              docType: r.doc_type,
              description: r.description,
              accountingDate: r.accounting_date,
              total: item.total,
              updatedAt: r.updated_at.toISOString(),
              deadline: item.deadline,
            };
          })
          .sort((a, b) => (a.deadline.deadline < b.deadline.deadline ? -1 : a.deadline.deadline > b.deadline.deadline ? 1 : 0)),
        latePostedLast30Days: recent.rows.filter((r) => listItem(r, today).deadline.status === "LATE").length,
        unmappedAccounts: accounts.filter(missingMapping).length,
      };
    });
  },
};
