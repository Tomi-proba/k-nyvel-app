import { createHash } from "node:crypto";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { canonicalJson, formatDateHu, formatHuf } from "@konyvelo/domain";
import type { EventEnvelope, InboundResult } from "@konyvelo/esemenyek";
import { documentInputSchema } from "@konyvelo/shared";
import { writeAudit } from "../../core/audit";
import type { AuthUser } from "../../core/auth";
import type { Executor, Tx } from "../../core/db";
import { AppError } from "../../core/errors";
import {
  attachments,
  documents,
  documentStockLines,
  integrationProducts,
  integrationRecords,
  integrationSettings,
  journalLines,
  partners,
  SYSTEM_USER_ID,
  type IntegrationRecordKind,
} from "../../core/schema";
import { listAccounts } from "../accounts";
import { createDocument, deleteDraftDocument, postDocument, reverseDocument } from "../documents";
import { emitPartnerChanged } from "./outbox";
import { openTodo, resolveTodo } from "./todos";

/**
 * A beérkező események kezelői (TERV.md F14.1–F14.4). Mindegyik a hívó tranzakciójában dolgozik (a
 * bejövő tábla bejegyzésével együtt, pontosan egyszer), és soha nem találgat: ami nem egyértelmű, az
 * piszkozat és Teendő lesz, az okkal együtt.
 */

export const SYSTEM_USER: AuthUser = { id: SYSTEM_USER_ID, email: "integracio@rendszer.invalid", name: "Integrációs központ (automatikus)", mustChangePassword: false };
const IP = "integracio";

type Settings = typeof integrationSettings.$inferSelect;
type Ctx = { tx: Tx; companyId: string; event: EventEnvelope; settings: Settings };

const docTarget = (id: string, label: string): NonNullable<InboundResult["target"]> => ({ recordType: "bizonylat", recordId: id, url: `/konyveles/${id}`, label });

/** A piszkozat tartalmának lenyomata: ebből derül ki, hogy létrehozás óta hozzányúltak-e. */
export async function draftFingerprint(db: Executor, documentId: string): Promise<string> {
  const [d] = await db.select().from(documents).where(eq(documents.id, documentId));
  const lines = await db.select().from(journalLines).where(eq(journalLines.documentId, documentId)).orderBy(asc(journalLines.lineNo));
  return createHash("sha256")
    .update(
      canonicalJson({
        h: [d!.docType, d!.partnerId, d!.externalNumber, d!.description, d!.issueDate, d!.fulfillmentDate, d!.accountingDate, d!.dueDate],
        l: lines.map((l) => [l.accountId, l.side, l.amount, l.partnerId, l.description]),
      }),
    )
    .digest("hex");
}

// ---------- Segédek ----------

const ACCOUNT_LABELS = {
  inventoryAccountId: "Áruk (261)",
  cogsAccountId: "Eladott áruk beszerzési értéke, ELÁBÉ (814)",
  payableAccountId: "Szállítók (454)",
  receivableAccountId: "Vevők (311)",
  inputVatAccountId: "Előzetesen felszámított áfa (466)",
  outputVatAccountId: "Fizetendő áfa (467)",
  revenueAccountId: "Árbevétel (911)",
} as const;
type AccountKey = keyof typeof ACCOUNT_LABELS;

/** A számla-hozzárendelés egy eleme, ha könyvelhető (létezik, aktív, nem gyűjtőszámla). */
async function mappedAccounts(ctx: Ctx, keys: AccountKey[]) {
  const all = await listAccounts(ctx.tx, ctx.companyId);
  const byId = new Map(all.map((a) => [a.id, a]));
  const out: Partial<Record<AccountKey, string>> = {};
  const problems: string[] = [];
  for (const k of keys) {
    const id = ctx.settings[k];
    const a = id ? byId.get(id) : undefined;
    if (!a) problems.push(`Hiányzik a számla-hozzárendelés: ${ACCOUNT_LABELS[k]} (Beállítások → Integráció).`);
    else if (!a.isActive || a.hasChildren) problems.push(`A(z) ${a.number} számla ${a.isActive ? "gyűjtőszámla" : "inaktív"}; javítsa a számla-hozzárendelést: ${ACCOUNT_LABELS[k]}.`);
    else out[k] = a.id;
  }
  return { ids: out, problems };
}

/** Partner a teljes adószám pontos egyezése alapján (F5); név szerint soha. */
async function partnerByTax(db: Executor, companyId: string, taxNumber: string | undefined) {
  if (!taxNumber) return null;
  const [p] = await db
    .select()
    .from(partners)
    .where(and(eq(partners.companyId, companyId), eq(partners.taxNumber, taxNumber), ne(partners.status, "ANONYMIZED")));
  return p ?? null;
}

async function sourceRecords(db: Executor, companyId: string, e: EventEnvelope) {
  return db
    .select()
    .from(integrationRecords)
    .where(
      and(
        eq(integrationRecords.companyId, companyId),
        eq(integrationRecords.sourceModule, e.source.module),
        eq(integrationRecords.sourceRecordType, e.source.recordType),
        eq(integrationRecords.sourceRecordId, e.source.recordId),
      ),
    )
    .orderBy(asc(integrationRecords.createdAt));
}

async function addRecord(ctx: Ctx, kind: IntegrationRecordKind, documentId: string | null, extra: Partial<typeof integrationRecords.$inferInsert> = {}) {
  await ctx.tx.insert(integrationRecords).values({
    companyId: ctx.companyId,
    documentId,
    kind,
    sourceModule: ctx.event.source.module,
    sourceRecordType: ctx.event.source.recordType,
    sourceRecordId: ctx.event.source.recordId,
    sourceUrl: ctx.event.source.url ?? null,
    sourceLabel: ctx.event.source.label ?? null,
    eventId: ctx.event.id,
    ...(documentId ? { draftFingerprint: await draftFingerprint(ctx.tx, documentId) } : {}),
    ...extra,
  });
}

/** Mentőpont: ha a belső lépés hibát dob, csak az gördül vissza, a bejövő esemény feldolgozása nem. */
async function attempt<T>(tx: Tx, fn: (sp: Tx) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  try {
    return { ok: true, value: await tx.transaction((sp) => fn(sp as Tx)) };
  } catch (e) {
    if (e instanceof AppError) {
      const fields = (e as AppError & { fields?: Record<string, string> }).fields ?? {};
      return { ok: false, message: [e.message, ...Object.values(fields)].filter(Boolean).join(" ") };
    }
    throw e;
  }
}

type StockLine = { productId: string; productName: string; quantity: number; unit: string | null; netAmount: number; vatRate: number | null; vatAmount: number };

async function saveStockLines(tx: Tx, documentId: string, lines: StockLine[]) {
  await tx.delete(documentStockLines).where(eq(documentStockLines.documentId, documentId));
  if (lines.length) {
    await tx.insert(documentStockLines).values(
      lines.map((l, i) => ({ documentId, lineNo: i + 1, productId: l.productId, productName: l.productName, quantity: l.quantity, unit: l.unit, netAmount: l.netAmount, vatRate: l.vatRate, vatAmount: l.vatAmount })),
    );
  }
}

const describe = (prefix: string, lines: StockLine[]) => `${prefix}: ${lines[0]!.productName}${lines.length > 1 ? ` és további ${lines.length - 1} tétel` : ""}`.slice(0, 500);

// ---------- Kezelők ----------

type Purchase = {
  purchaseId: string;
  receivedDate: string;
  invoiceDate: string | null;
  fulfillmentDate: string | null;
  invoiceNumber: string | null;
  supplier: { name: string; taxNumber?: string } | null;
  lines: StockLine[];
  totals: { net: number; vat: number; gross: number };
};

/** KK1: Készlet-beszerzés → szállítói számla piszkozata (T 261 / T 466 / K 454). */
async function purchase(ctx: Ctx, p: Purchase): Promise<InboundResult> {
  const { tx, companyId } = ctx;
  const partner = await partnerByTax(tx, companyId, p.supplier?.taxNumber);
  const problems: string[] = [];
  if (!p.supplier) problems.push("A beszerzésnél nincs megadva a szállító.");
  else if (!partner) problems.push(`A szállító (${p.supplier.name}${p.supplier.taxNumber ? `, ${p.supplier.taxNumber}` : ", adószám nélkül"}) nincs meg a partnerek között pontosan egyező adószámmal; vegye fel, vagy válassza ki.`);

  // Ha ugyanez a számla már rögzítve van (kézzel vagy NAV-importból), nem rögzítjük kétszer: csak párosítjuk.
  if (partner && p.invoiceNumber) {
    const same = await tx
      .select({ id: documents.id, serial: documents.serialNumber })
      .from(documents)
      .where(and(eq(documents.companyId, companyId), eq(documents.docType, "SZSZ"), eq(documents.partnerId, partner.id), sql`lower(trim(${documents.externalNumber})) = lower(trim(${p.invoiceNumber}))`));
    if (same.length === 1) {
      await addRecord(ctx, "PURCHASE_LINK", same[0]!.id);
      return { outcome: "APPLIED", target: docTarget(same[0]!.id, `${same[0]!.serial ?? "Piszkozat"} (már rögzített számla)`) };
    }
    if (same.length > 1) {
      const key = `beszerzes:${ctx.event.source.recordId}`;
      const title = `Több bizonylat is illik a Készlet-beszerzéshez (${p.invoiceNumber}); válassza ki, melyik az.`;
      await openTodo(tx, companyId, { key, kind: "MISSING_DATA", title, hubKey: key });
      await addRecord(ctx, "PURCHASE", null);
      return { outcome: "TODO", todo: { key, title } };
    }
  }

  const { ids, problems: accProblems } = await mappedAccounts(ctx, ["inventoryAccountId", "inputVatAccountId", "payableAccountId"]);
  problems.push(...accProblems);
  if (!p.invoiceNumber) problems.push("A szállító számlaszáma hiányzik.");
  if (!p.fulfillmentDate) problems.push("A teljesítés dátuma hiányzik (a számláról írja be).");

  // A könyvelés dátuma (❓2): a beállítás szerint, vagy a jóváhagyó választ.
  const rule = ctx.settings.purchaseDateRule;
  let accountingDate = p.invoiceDate ?? p.receivedDate;
  let needsDateChoice = false;
  if (rule === "RECEIVED") accountingDate = p.receivedDate;
  else if (rule === "INVOICE" && !p.invoiceDate) needsDateChoice = true;
  else if (rule === "ASK" && p.invoiceDate && p.invoiceDate !== p.receivedDate) needsDateChoice = true;

  const input = documentInputSchema.parse({
    docType: "SZSZ",
    partnerId: partner?.id ?? null,
    externalNumber: p.invoiceNumber,
    description: describe("Készlet-beszerzés", p.lines),
    issueDate: p.invoiceDate,
    fulfillmentDate: p.fulfillmentDate,
    accountingDate,
    lines: [
      { accountId: ids.inventoryAccountId ?? null, side: "D", amount: p.totals.net },
      ...(p.totals.vat ? [{ accountId: ids.inputVatAccountId ?? null, side: "D", amount: p.totals.vat }] : []),
      { accountId: ids.payableAccountId ?? null, side: "C", amount: p.totals.gross },
    ],
  });
  const created = await attempt(tx, (sp) => createDocument(sp, companyId, SYSTEM_USER, IP, input, "INTEGRATION"));
  const key = `beszerzes:${ctx.event.source.recordId}`;
  if (!created.ok) {
    const title = `A Készlet-beszerzésből (${formatDateHu(p.receivedDate)}, ${formatHuf(p.totals.gross)}) nem készülhetett piszkozat: ${created.message}`;
    await openTodo(tx, companyId, { key, kind: "MISSING_DATA", title, hubKey: key });
    await addRecord(ctx, "PURCHASE", null);
    return { outcome: "TODO", todo: { key, title } };
  }
  const docId = created.value;
  await saveStockLines(tx, docId, p.lines);
  await addRecord(ctx, "PURCHASE", docId, { receivedDate: p.receivedDate, invoiceDate: p.invoiceDate, needsDateChoice });
  if (needsDateChoice) problems.push(`Válassza ki a könyvelés dátumát: bevételezés (${formatDateHu(p.receivedDate)})${p.invoiceDate ? ` vagy számla (${formatDateHu(p.invoiceDate)})` : ""}.`);

  // Automatikus mód: csak ha minden egyértelmű, és a beszerzés dátumszabálya nem „kérdezze”.
  if (ctx.settings.postingMode === "AUTO" && rule !== "ASK" && problems.length === 0) {
    const posted = await attempt(tx, (sp) => postDocument(sp, companyId, docId, SYSTEM_USER, IP));
    if (posted.ok) return { outcome: "APPLIED", target: docTarget(docId, posted.value.serialNumber ?? "") };
    problems.push(posted.message);
  }
  const title = `Készlet-beszerzés jóváhagyásra vár: ${partner?.name ?? p.supplier?.name ?? "ismeretlen szállító"}, ${formatHuf(p.totals.gross)} (${formatDateHu(p.receivedDate)})`;
  await openTodo(tx, companyId, { key, kind: "PURCHASE_APPROVAL", title, detail: problems.join("\n") || null, documentId: docId, hubKey: key });
  if (problems.length) await openTodo(tx, companyId, { key: `hiany:${docId}`, kind: "MISSING_DATA", title: `Hiányzó adat a Készletből jött piszkozaton: ${problems[0]}`, detail: problems.join("\n"), documentId: docId });
  return { outcome: "TODO", target: docTarget(docId, "Piszkozat"), todo: { key, title, ...(problems.length ? { detail: problems.join("\n").slice(0, 2000) } : {}), url: `/konyveles/${docId}` } };
}

type Sale = {
  saleId: string;
  date: string;
  customer: { name: string; taxNumber?: string } | null;
  cash: boolean;
  invoiceNumber: string | null;
  costOfGoods: number;
  lines: StockLine[];
  totals: { net: number; vat: number; gross: number };
};

/**
 * KK2: Készlet-eladás. (a) Az ELÁBÉ (T 814 / K 261) MINDIG piszkozat, emberi jóváhagyással (D9, F14.4),
 * a mód beállításától függetlenül. (b) Árbevételt számla nélkül nem könyvelünk (❓5): ha a vevőszámla
 * már rögzítve van, csak párosítjuk, egyébként Teendő.
 */
async function sale(ctx: Ctx, p: Sale): Promise<InboundResult> {
  const { tx, companyId } = ctx;
  const recordId = ctx.event.source.recordId;
  let cogsDoc: string | null = null;
  let result: InboundResult = { outcome: "APPLIED" };

  if (p.costOfGoods > 0) {
    const { ids, problems } = await mappedAccounts(ctx, ["cogsAccountId", "inventoryAccountId"]);
    const input = documentInputSchema.parse({
      docType: "VEGY",
      description: describe(`ELÁBÉ – Készlet-eladás ${formatDateHu(p.date)}`, p.lines),
      issueDate: p.date,
      accountingDate: p.date,
      lines: [
        { accountId: ids.cogsAccountId ?? null, side: "D", amount: p.costOfGoods },
        { accountId: ids.inventoryAccountId ?? null, side: "C", amount: p.costOfGoods },
      ],
    });
    const key = `elabe:${recordId}`;
    const created = await attempt(tx, (sp) => createDocument(sp, companyId, SYSTEM_USER, IP, input, "INTEGRATION"));
    if (!created.ok) {
      const title = `A Készlet-eladás ELÁBÉ-tételéből (${formatDateHu(p.date)}, ${formatHuf(p.costOfGoods)}) nem készülhetett piszkozat: ${created.message}`;
      await openTodo(tx, companyId, { key, kind: "MISSING_DATA", title, hubKey: key });
      result = { outcome: "TODO", todo: { key, title } };
    } else {
      cogsDoc = created.value;
      await saveStockLines(tx, cogsDoc, p.lines);
      const title = `ELÁBÉ jóváhagyásra vár: Készlet-eladás ${formatDateHu(p.date)}, ${formatHuf(p.costOfGoods)}`;
      await openTodo(tx, companyId, { key, kind: "COGS_APPROVAL", title, detail: problems.join("\n") || null, documentId: cogsDoc, hubKey: key });
      if (problems.length) await openTodo(tx, companyId, { key: `hiany:${cogsDoc}`, kind: "MISSING_DATA", title: `Hiányzó adat az ELÁBÉ-piszkozaton: ${problems[0]}`, detail: problems.join("\n"), documentId: cogsDoc });
      result = { outcome: "TODO", target: docTarget(cogsDoc, "ELÁBÉ-piszkozat"), todo: { key, title, url: `/konyveles/${cogsDoc}` } };
    }
  }
  await addRecord(ctx, "COGS", cogsDoc);

  // Árbevétel: a már rögzített vevőszámlával párosítunk, különben Teendő (soha nem könyvelünk számla nélkül).
  const customer = await partnerByTax(tx, companyId, p.customer?.taxNumber);
  const invoices = p.invoiceNumber
    ? await tx
        .select({ id: documents.id, serial: documents.serialNumber, partnerId: documents.partnerId })
        .from(documents)
        .where(and(eq(documents.companyId, companyId), eq(documents.docType, "VSZ"), sql`lower(trim(${documents.externalNumber})) = lower(trim(${p.invoiceNumber}))`))
    : [];
  const matching = invoices.filter((i) => !customer || i.partnerId === customer.id);
  if (matching.length === 1) {
    await addRecord(ctx, "SALE_LINK", matching[0]!.id);
    if (!cogsDoc && result.outcome === "APPLIED") result = { outcome: "APPLIED", target: docTarget(matching[0]!.id, matching[0]!.serial ?? "Vevőszámla") };
  } else {
    const key = `szamla:${recordId}`;
    const title = p.cash
      ? `Készpénzes eladás a Készletben (${formatDateHu(p.date)}, ${formatHuf(p.totals.gross)}): az árbevételt a pénztárban rögzítse.`
      : `A Készlet-eladáshoz (${formatDateHu(p.date)}, ${formatHuf(p.totals.gross)}${p.invoiceNumber ? `, számla: ${p.invoiceNumber}` : ""}) ${matching.length > 1 ? "több vevőszámla is illik; válassza ki, melyik az" : "nincs meg a vevőszámla a Könyvelőben"}.`;
    await openTodo(tx, companyId, { key, kind: "INVOICE_MISSING", title, detail: "Árbevételt számla nélkül nem könyvelünk; ha a számla elkészült, rögzítse (vagy importálja a NAV-ból)." });
    if (result.outcome === "APPLIED") result = { outcome: "TODO", todo: { key, title } };
  }
  return result;
}

/** KK4: a Készletben visszavontak egy beszerzést vagy eladást. */
async function withdrawal(ctx: Ctx, p: { movementKind: "PURCHASE" | "SALE"; movementId: string; date: string; reason: string }): Promise<InboundResult> {
  const { tx, companyId } = ctx;
  const records = (await sourceRecords(tx, companyId, ctx.event)).filter((r) => r.kind !== "REVERSAL");
  if (!records.length) {
    const key = `visszavonas:${ctx.event.source.recordId}`;
    const title = `A Készletben visszavontak egy mozgást (${p.movementKind === "SALE" ? "eladás" : "beszerzés"}, ${formatDateHu(p.date)}), de a Könyvelőben nincs hozzá tétel. Nézze át, kell-e tenni valamit.`;
    await openTodo(tx, companyId, { key, kind: "SOURCE_WITHDRAWN", title, detail: `Ok: ${p.reason}`, hubKey: key });
    return { outcome: "TODO", todo: { key, title } };
  }
  // A forráshoz tartozó, még nyitott „hiányzó számla” Teendő okafogyottá vált.
  await resolveTodo(tx, companyId, `szamla:${ctx.event.source.recordId}`, SYSTEM_USER_ID);
  const todos: Array<NonNullable<InboundResult["todo"]>> = [];
  const done: string[] = [];
  for (const r of records) {
    if (!r.documentId) continue;
    const [doc] = await tx.select().from(documents).where(eq(documents.id, r.documentId));
    if (!doc) continue;
    if (r.kind === "SALE_LINK" || r.kind === "PURCHASE_LINK") {
      // Kézzel rögzített bizonylathoz soha nem nyúlunk magától.
      const key = `visszavonas:${doc.id}`;
      const title = `A Készletben visszavonták a(z) ${doc.serialNumber ?? "piszkozat"} bizonylathoz párosított mozgást (${formatDateHu(p.date)}). Nézze át, kell-e sztornózni.`;
      await openTodo(tx, companyId, { key, kind: "SOURCE_WITHDRAWN", title, detail: `Ok: ${p.reason}`, documentId: doc.id, hubKey: key });
      todos.push({ key, title, url: `/konyveles/${doc.id}` });
      continue;
    }
    if (doc.status === "DRAFT") {
      const [att] = await tx.select({ id: attachments.id }).from(attachments).where(eq(attachments.documentId, doc.id)).limit(1);
      if (!att && r.draftFingerprint === (await draftFingerprint(tx, doc.id))) {
        await deleteDraftDocument(tx, companyId, doc.id, SYSTEM_USER, IP, `A Készletben visszavonva: ${p.reason}`);
        done.push("a piszkozat törölve");
        continue;
      }
      const key = `visszavonas:${doc.id}`;
      const title = `A Készletben visszavonták a forrását, de a piszkozatot már módosították: törölje vagy könyvelje (${doc.description ?? ""}).`;
      await openTodo(tx, companyId, { key, kind: "SOURCE_WITHDRAWN", title, detail: `Ok: ${p.reason}`, documentId: doc.id, hubKey: key });
      todos.push({ key, title, url: `/konyveles/${doc.id}` });
      continue;
    }
    // Könyvelt: sztornó kell.
    const [already] = await tx.select({ id: documents.id }).from(documents).where(eq(documents.reversesDocumentId, doc.id));
    if (already) continue;
    await tx.insert(integrationRecords).values({
      companyId,
      documentId: doc.id,
      kind: "REVERSAL",
      sourceModule: ctx.event.source.module,
      sourceRecordType: ctx.event.source.recordType,
      sourceRecordId: ctx.event.source.recordId,
      sourceUrl: ctx.event.source.url ?? null,
      sourceLabel: p.reason.slice(0, 300),
      eventId: ctx.event.id,
      receivedDate: p.date,
    });
    let failure: string | null = null;
    if (ctx.settings.postingMode === "AUTO") {
      const rev = await attempt(tx, (sp) => reverseDocument(sp, companyId, doc.id, SYSTEM_USER, IP, { accountingDate: p.date, reason: `A Készletben visszavonva: ${p.reason}` }, ctx.event.id));
      if (rev.ok) {
        done.push(`${doc.serialNumber} sztornózva`);
        continue;
      }
      failure = rev.message;
    }
    const key = `sztorno:${doc.id}`;
    const title = `Sztornó javasolt: a Készletben visszavonták a(z) ${doc.serialNumber} forrását (${formatDateHu(p.date)}).`;
    const detail = [`Ok: ${p.reason}`, failure ? `Automatikusan nem sztornózható: ${failure} Válasszon dátumot nyitott időszakban.` : null].filter(Boolean).join("\n");
    await openTodo(tx, companyId, { key, kind: "REVERSAL_APPROVAL", title, detail, documentId: doc.id, hubKey: key });
    todos.push({ key, title, url: `/konyveles/${doc.id}` });
  }
  if (todos.length) return { outcome: "TODO", todo: { ...todos[0]!, ...(todos.length > 1 ? { detail: `${todos.length} tétel érintett.` } : {}) } };
  return { outcome: "APPLIED", ...(done.length ? { target: { recordType: "visszavonas", recordId: ctx.event.source.recordId, label: done.join(", ") } } : {}) };
}

type StockApproval = {
  movementId: string;
  purpose: "RECEIPT" | "ISSUE" | "CUSTOMER_RETURN" | "SUPPLIER_RETURN" | "REVERSAL";
  sourceDocument: { documentId: string; serialNumber: string | null; eventId: string };
  originalMovementId: string | null;
  date: string;
  productId: string;
  productName: string;
  unit: string | null;
  expectedQuantity: number;
  actualQuantity: number;
  note: string | null;
  costOfGoods: number | null;
};

const MOZGAS_SZOVEG: Record<StockApproval["purpose"], { mi: string; hiany: string; tenyleges: string }> = {
  RECEIPT: { mi: "beérkezésnél", hiany: "nem érkezett meg", tenyleges: "érkezett" },
  ISSUE: { mi: "kiadásnál", hiany: "nem ment ki", tenyleges: "ment ki" },
  CUSTOMER_RETURN: { mi: "vevői visszavételnél", hiany: "nem érkezett vissza", tenyleges: "érkezett vissza" },
  SUPPLIER_RETURN: { mi: "szállítói visszaküldésnél", hiany: "nem ment vissza", tenyleges: "ment vissza" },
  REVERSAL: { mi: "a sztornózott számla visszavételénél", hiany: "nem mozdult", tenyleges: "mozdult" },
};

/**
 * F15.4: a Készletben jóváhagyták (vagy elutasították) a Könyvelő bizonylatából jött mozgást.
 * - Eltérő mennyiségnél MINDIG Teendő, és a könyvelés magától nem változik (helyesbítő számla vagy egyeztetés
 *   kell, ezt ember dönti el).
 * - Kiadásnál az ELÁBÉ, vevői visszavételnél az ELÁBÉ csökkentése piszkozat lesz, mindig jóváhagyással (D9).
 * - A sztornózott számla kiadásának visszavételekor a hozzá tartozó ELÁBÉ sztornója javasolt (jóváhagyással),
 *   de csak ha a teljes mennyiség visszajött; részleges visszavételnél csak Teendő.
 */
async function stockApproved(ctx: Ctx, p: StockApproval): Promise<InboundResult> {
  const { tx, companyId } = ctx;
  const [doc] = await tx.select().from(documents).where(and(eq(documents.companyId, companyId), eq(documents.id, p.sourceDocument.documentId)));
  const serial = doc?.serialNumber ?? p.sourceDocument.serialNumber ?? "ismeretlen bizonylat";
  const todos: Array<NonNullable<InboundResult["todo"]>> = [];
  const szoveg = MOZGAS_SZOVEG[p.purpose];
  const egyseg = p.unit ? ` ${p.unit}` : "";

  if (!doc) {
    const key = `keszlet-mozgas:${p.movementId}`;
    const title = `A Készlet egy jóváhagyott mozgást (${p.productName}) a(z) ${serial} bizonylathoz kötött, de az nincs meg a Könyvelőben. Nézze át.`;
    await openTodo(tx, companyId, { key, kind: "STOCK_DISCREPANCY", title, hubKey: key });
    return { outcome: "TODO", todo: { key, title } };
  }

  // A mozgás és a bizonylat kapcsolata („honnan jött?”, és a kiegyenlítés a Készlet felé). Csak a beérkezés és
  // a kiadás köthető a számlához; a visszáru a helyesbítőhöz tartozik, a visszavétel a sztornóhoz.
  if (p.purpose === "RECEIPT" || p.purpose === "ISSUE") await addRecord(ctx, p.purpose === "RECEIPT" ? "PURCHASE_LINK" : "SALE_LINK", doc.id);

  if (p.actualQuantity !== p.expectedQuantity) {
    const key = `elteres:${p.movementId}`;
    const title =
      p.actualQuantity === 0
        ? `Eltérés a ${szoveg.mi}: ${serial} – ${p.productName}: ${p.expectedQuantity}${egyseg} ${szoveg.hiany} (a Készletben elutasították).`
        : `Eltérés a ${szoveg.mi}: ${serial} – ${p.productName}: ${p.expectedQuantity}${egyseg} helyett ${p.actualQuantity}${egyseg} ${szoveg.tenyleges}.`;
    const detail = [
      p.note ? `A Készlet megjegyzése: ${p.note}` : null,
      "A könyvelés magától nem változott. Ha a számla nem a tényleges mennyiségről szól, helyesbítő számla kell (vagy egyeztessen a partnerrel); ha a Készletben tévedtek, ott javítsák.",
    ]
      .filter(Boolean)
      .join("\n");
    await openTodo(tx, companyId, { key, kind: "STOCK_DISCREPANCY", title, detail, documentId: doc.id, hubKey: key });
    todos.push({ key, title, detail, url: `/konyveles/${doc.id}` });
  }

  let cogsDoc: string | null = null;
  const cost = p.costOfGoods ?? 0;
  if ((p.purpose === "ISSUE" || p.purpose === "CUSTOMER_RETURN") && cost > 0) {
    const { ids, problems } = await mappedAccounts(ctx, ["cogsAccountId", "inventoryAccountId"]);
    const issue = p.purpose === "ISSUE";
    const input = documentInputSchema.parse({
      docType: "VEGY",
      description: `${issue ? "ELÁBÉ" : "ELÁBÉ csökkentése (visszavétel)"} – ${serial}: ${p.productName}, ${p.actualQuantity}${egyseg}`.slice(0, 500),
      issueDate: p.date,
      accountingDate: p.date,
      lines: issue
        ? [{ accountId: ids.cogsAccountId ?? null, side: "D", amount: cost }, { accountId: ids.inventoryAccountId ?? null, side: "C", amount: cost }]
        : [{ accountId: ids.inventoryAccountId ?? null, side: "D", amount: cost }, { accountId: ids.cogsAccountId ?? null, side: "C", amount: cost }],
    });
    const key = `elabe:${p.movementId}`;
    const created = await attempt(tx, (sp) => createDocument(sp, companyId, SYSTEM_USER, IP, input, "INTEGRATION"));
    if (!created.ok) {
      const title = `A Készlet ${szoveg.mi} (${serial}, ${formatHuf(cost)}) az ELÁBÉ-piszkozat nem készülhetett el: ${created.message}`;
      await openTodo(tx, companyId, { key, kind: "MISSING_DATA", title, hubKey: key });
      todos.push({ key, title });
    } else {
      cogsDoc = created.value;
      const title = `${issue ? "ELÁBÉ" : "ELÁBÉ csökkentése"} jóváhagyásra vár: ${serial} – ${p.productName}, ${formatHuf(cost)}`;
      await openTodo(tx, companyId, { key, kind: "COGS_APPROVAL", title, detail: problems.join("\n") || null, documentId: cogsDoc, hubKey: key });
      if (problems.length) await openTodo(tx, companyId, { key: `hiany:${cogsDoc}`, kind: "MISSING_DATA", title: `Hiányzó adat az ELÁBÉ-piszkozaton: ${problems[0]}`, detail: problems.join("\n"), documentId: cogsDoc });
      todos.push({ key, title, url: `/konyveles/${cogsDoc}` });
    }
  }
  // Az ELÁBÉ-tétel a mozgás SAJÁT azonosítójához kötve (a visszárué a visszárumozgáséhoz), hogy egy későbbi
  // visszavétel vagy visszavonás pontosan a hozzá tartozót találja meg.
  if (p.purpose === "ISSUE" || p.purpose === "CUSTOMER_RETURN") await addRecord(ctx, "COGS", cogsDoc, { sourceRecordId: p.movementId });

  if (p.purpose === "REVERSAL" && p.originalMovementId) {
    const cogs = await tx
      .select()
      .from(integrationRecords)
      .where(
        and(
          eq(integrationRecords.companyId, companyId),
          eq(integrationRecords.sourceModule, "keszlet"),
          eq(integrationRecords.sourceRecordType, ctx.event.source.recordType),
          eq(integrationRecords.sourceRecordId, p.originalMovementId),
          eq(integrationRecords.kind, "COGS"),
        ),
      );
    for (const r of cogs) {
      if (!r.documentId) continue;
      const [c] = await tx.select().from(documents).where(eq(documents.id, r.documentId));
      if (!c) continue;
      const key = `sztorno:${c.id}`;
      if (p.actualQuantity !== p.expectedQuantity) continue; // részleges visszavétel: csak az eltérés Teendője
      if (c.status === "DRAFT") {
        const title = `A(z) ${serial} sztornója miatt az áru visszajött: a hozzá tartozó ELÁBÉ-piszkozatot törölje.`;
        await openTodo(tx, companyId, { key, kind: "SOURCE_WITHDRAWN", title, documentId: c.id, hubKey: key });
        todos.push({ key, title, url: `/konyveles/${c.id}` });
        continue;
      }
      const [already] = await tx.select({ id: documents.id }).from(documents).where(eq(documents.reversesDocumentId, c.id));
      if (already) continue;
      await addRecord(ctx, "REVERSAL", c.id, { receivedDate: p.date, sourceLabel: `Visszavétel a(z) ${serial} sztornója miatt`.slice(0, 300) });
      const title = `Sztornó javasolt: a(z) ${serial} sztornója miatt az áru visszajött, a(z) ${c.serialNumber} ELÁBÉ-tételt sztornózni kell.`;
      await openTodo(tx, companyId, { key, kind: "REVERSAL_APPROVAL", title, documentId: c.id, hubKey: key });
      todos.push({ key, title, url: `/konyveles/${c.id}` });
    }
  }

  if (todos.length) return { outcome: "TODO", target: docTarget(cogsDoc ?? doc.id, cogsDoc ? "ELÁBÉ-piszkozat" : (doc.serialNumber ?? "Bizonylat")), todo: { ...todos[0]!, ...(todos.length > 1 ? { detail: `${todos.length} teendő: ${todos.map((t) => t.title).join(" | ")}`.slice(0, 2000) } : {}) } };
  return { outcome: "APPLIED", target: docTarget(doc.id, doc.serialNumber ?? "Bizonylat") };
}

/** A Készlet termékei a termékkérdéshez (KK3); csak olvasható másolat. */
async function product(ctx: Ctx, p: { productId: string; name: string; sku: string | null; unit: string | null; vatRate: number | null; active: boolean }): Promise<InboundResult> {
  await ctx.tx
    .insert(integrationProducts)
    .values({ companyId: ctx.companyId, productId: p.productId, name: p.name, sku: p.sku, unit: p.unit, vatRate: p.vatRate, active: p.active })
    .onConflictDoUpdate({
      target: [integrationProducts.companyId, integrationProducts.productId],
      set: { name: p.name, sku: p.sku, unit: p.unit, vatRate: p.vatRate, active: p.active, updatedAt: new Date() },
    });
  return { outcome: "APPLIED" };
}

/** M2: partner változott máshol. Csak pontos adószám-egyezésnél és csak a nevet frissíti; minden más Teendő. */
async function partnerChanged(ctx: Ctx, p: { partner: { name: string; taxNumber?: string }; anonymized: boolean }): Promise<InboundResult> {
  const { tx, companyId } = ctx;
  const key = `partner:${ctx.event.source.recordId}`;
  if (!p.partner.taxNumber) {
    const title = `Partner változott a(z) ${ctx.event.source.module === "keszlet" ? "Készletben" : "közös törzsben"} (${p.partner.name}), de adószám nélkül nem párosítható. Nézze át a partnereket.`;
    await openTodo(tx, companyId, { key, kind: "PARTNER", title, hubKey: key });
    return { outcome: "TODO", todo: { key, title } };
  }
  const existing = await partnerByTax(tx, companyId, p.partner.taxNumber);
  if (!existing) {
    const title = `Új partner a másik modulban: ${p.partner.name} (${p.partner.taxNumber}). Ha a Könyvelőben is kell, vegye fel.`;
    await openTodo(tx, companyId, { key, kind: "PARTNER", title, hubKey: key });
    return { outcome: "TODO", todo: { key, title, url: "/partnerek" } };
  }
  if (p.anonymized) {
    const title = `A másik modulban anonimizálták a(z) ${existing.name} partnert. A Könyvelőben a megőrzési idő miatt nem anonimizálunk magától; nézze át.`;
    await openTodo(tx, companyId, { key, kind: "PARTNER", title, hubKey: key });
    return { outcome: "TODO", todo: { key, title, url: `/partnerek/${existing.id}` } };
  }
  if (existing.name !== p.partner.name) {
    const [after] = await tx.update(partners).set({ name: p.partner.name, updatedAt: new Date() }).where(eq(partners.id, existing.id)).returning();
    await writeAudit(tx, {
      companyId,
      userId: SYSTEM_USER_ID,
      action: "partner.update",
      entityType: "partner",
      entityId: existing.id,
      before: { name: existing.name },
      after: { name: p.partner.name, source: `integráció: ${ctx.event.source.module}`, eventId: ctx.event.id },
      ip: IP,
    });
    await emitPartnerChanged(tx, after!, ctx.event.id);
  }
  return { outcome: "APPLIED", target: { recordType: "partner", recordId: existing.id, url: `/partnerek/${existing.id}`, label: p.partner.name } };
}

/** Egy beérkezett esemény hatása (a bejövő tábla bejegyzésével azonos tranzakcióban). */
export async function applyInbound(tx: Tx, companyId: string, event: EventEnvelope, settings: Settings): Promise<InboundResult> {
  const ctx: Ctx = { tx, companyId, event, settings };
  const payload = event.payload as never;
  switch (`${event.type}@${event.version}`) {
    case "keszlet.beszerzes.veglegesitve@2":
      return purchase(ctx, payload);
    case "keszlet.eladas.veglegesitve@2":
      return sale(ctx, payload);
    case "keszlet.mozgas.sztornozva@2":
      return withdrawal(ctx, payload);
    case "keszlet.mozgas.jovahagyva@1":
      return stockApproved(ctx, payload);
    case "keszlet.termek.valtozott@1":
      return product(ctx, payload);
    case "torzs.partner.valtozott@1":
      return partnerChanged(ctx, payload);
    default: {
      const key = `nem-tamogatott:${event.type}@${event.version}`;
      const title = `A Könyvelő nem ismeri ezt az eseményt (${event.type}, ${event.version}. verzió); frissíteni kell. Az esemény nem veszett el, újraküldhető.`;
      await openTodo(tx, companyId, { key, kind: "UNSUPPORTED", title, hubKey: key });
      return { outcome: "TODO", todo: { key, title } };
    }
  }
}


