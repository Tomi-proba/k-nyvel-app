import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  navAmountToFiller,
  proposeNavPosting,
  splitIntoWindows,
  taxNumberBase,
  validateTaxNumber,
  type NavDirection,
  type NavProposal,
} from "@konyvelo/domain";
import {
  documentInputSchema,
  navApproveSchema,
  navIgnoreSchema,
  navImportSchema,
  navLinkSchema,
  type NavConnectionDto,
  type NavImportRunDto,
  type NavInvoiceDetailDto,
  type NavInvoiceListItemDto,
  type NavInvoiceState,
  type NavRemoteState,
} from "@konyvelo/shared";
import type { Config } from "../../config";
import { writeAudit } from "../../core/audit";
import { requireCompanyPermission, type AuthUser } from "../../core/auth";
import type { Db, Executor } from "../../core/db";
import { AppError, assertUuid, conflict, notFound, parseBody, validationError } from "../../core/errors";
import type { AppModule } from "../../core/modules";
import { accounts, companies, documents, navConnections, navImportRuns, navInvoices, partners, postingTemplates, users } from "../../core/schema";
import { createDocument, mapDocumentDbError, reverseDocument } from "../documents";
import { createGatewayClient, GatewayError, type GatewayClient, type GatewayDigest, type GatewayLink } from "./gateway";

/**
 * NAV Online Számla import (PLAN 10.): összekapcsolás az eÁFA NAV-kapcsolatával, a számlák
 * lekérdezése az eÁFA átjáróján, könyvelési javaslat és jóváhagyás.
 *
 * - A Könyvelőben nincs NAV-titok és nincs NAV-cím; a NAV-hívásokat az eÁFA végzi, a saját
 *   főkapcsolója mögött.
 * - Egy cég adatai soha nem érhetők el pusztán az adószám ismeretében (TERV.md D13): az
 *   összekapcsoláshoz az eÁFA-ból kapott, egyszer használható kapcsolódási kód kell.
 * - A NAV-adat könyvelési javaslat; bizonylat csak a felhasználó jóváhagyásával lesz belőle.
 */

type InvoiceRow = typeof navInvoices.$inferSelect;
type ConnectionRow = typeof navConnections.$inferSelect;

const NOT_AVAILABLE =
  "A NAV-import ezen a telepítésen nincs beállítva: az üzemeltetőnek meg kell adnia az eÁFA NAV-átjárójának címét és a közös titkot (EAFA_ATJARO_URL, EAFA_KONYVELO_ATJARO_TITOK).";

function gatewayOf(config: Config): GatewayClient {
  if (!config.eafaGateway) throw new AppError(503, "NAV_NOT_CONFIGURED", NOT_AVAILABLE);
  return createGatewayClient(config.eafaGateway);
}

/** Az átjáró hibája a felhasználónak (a NAV-ra vonatkozó teendővel együtt). */
function gatewayAppError(e: unknown): never {
  if (e instanceof GatewayError) {
    const status = e.status === 422 ? 422 : e.status >= 500 || e.status === 429 ? 503 : 409;
    const message = e.details.action ? `${e.message} ${e.details.action}` : e.message;
    throw new AppError(status, e.code, message, e.code === "INVALID_CODE" ? { code: e.message } : undefined);
  }
  throw e;
}

async function loadConnection(db: Executor, companyId: string): Promise<ConnectionRow | null> {
  const [c] = await db.select().from(navConnections).where(eq(navConnections.companyId, companyId));
  return c ?? null;
}

async function requireConnection(db: Executor, companyId: string): Promise<ConnectionRow> {
  const c = await loadConnection(db, companyId);
  if (!c) throw conflict("A cég még nincs összekapcsolva az eÁFA NAV-kapcsolatával. Beállítások → NAV-kapcsolat.");
  return c;
}

/** Az eÁFA szerinti állapot rögzítése (ebből lesz Teendő, ha hibás). */
async function rememberRemote(db: Executor, companyId: string, state: NavRemoteState, title: string, action: string | null) {
  await db
    .update(navConnections)
    .set({ remoteState: state, remoteTitle: title, remoteAction: action, remoteCheckedAt: new Date() })
    .where(eq(navConnections.companyId, companyId));
}

function remoteOf(link: GatewayLink): { state: NavRemoteState; title: string; action: string | null } {
  if (!link.active) {
    return {
      state: "REVOKED",
      title: link.revokedFrom === "KONYVELO" ? "Az összekapcsolást bontották." : "A cég az eÁFA-ban visszavonta a Könyvelő hozzáférését.",
      action: "Kérjen új kapcsolódási kódot a cég eÁFA-felületén, bontsa itt a kapcsolatot, majd kapcsolja össze újra.",
    };
  }
  const c = link.connection;
  if (!c || !c.configured) return { state: "NOT_CONFIGURED", title: c?.title ?? "A cég NAV-kapcsolata nincs beállítva.", action: c?.action ?? null };
  return { state: c.state, title: c.title, action: c.action };
}

async function connectionDto(db: Executor, config: Config, companyId: string, refresh: boolean): Promise<NavConnectionDto> {
  let c = await loadConnection(db, companyId);
  let calls: { navCallsEnabled: boolean; productionEnabled: boolean } | null = null;
  if (c && refresh && config.eafaGateway) {
    try {
      const link = await gatewayOf(config).status(c.linkId);
      const r = remoteOf(link);
      await rememberRemote(db, companyId, r.state, r.title, r.action);
      calls = { navCallsEnabled: link.navCallsEnabled, productionEnabled: link.productionEnabled };
    } catch (e) {
      if (e instanceof GatewayError && e.code === "LINK_NOT_FOUND") {
        await rememberRemote(db, companyId, "REVOKED", "Az eÁFA nem ismeri ezt az összekapcsolást.", "Bontsa a kapcsolatot, és kapcsolja össze újra egy új kóddal.");
      }
      // Más hibánál (pl. az átjáró nem érhető el) a legutóbbi ismert állapot marad.
    }
    c = await loadConnection(db, companyId);
  }
  const [by] = c ? await db.select({ name: users.name }).from(users).where(eq(users.id, c.linkedBy)) : [];
  return {
    available: config.eafaGateway !== null,
    linked: c !== null,
    environment: c?.environment ?? null,
    eafaTaxpayerName: c?.eafaTaxpayerName ?? null,
    eafaTaxNumber: c?.eafaTaxNumber ?? null,
    linkedAt: c?.linkedAt.toISOString() ?? null,
    linkedByName: by?.name ?? null,
    remote: c?.remoteState
      ? { state: c.remoteState, title: c.remoteTitle ?? "", action: c.remoteAction, checkedAt: c.remoteCheckedAt?.toISOString() ?? null }
      : null,
    navCallsEnabled: calls?.navCallsEnabled ?? null,
    productionEnabled: calls?.productionEnabled ?? null,
  };
}

// ---------- Import ----------

function runDto(r: typeof navImportRuns.$inferSelect): NavImportRunDto {
  return {
    id: r.id,
    direction: r.direction,
    dateFrom: r.dateFrom,
    dateTo: r.dateTo,
    status: r.status,
    windowsTotal: r.windowsTotal,
    windowsDone: r.windowsDone,
    foundCount: r.foundCount,
    newCount: r.newCount,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}

function invoiceValues(companyId: string, direction: NavDirection, runId: string, d: GatewayDigest) {
  return {
    companyId,
    direction,
    invoiceNumber: d.invoiceNumber,
    operation: d.invoiceOperation,
    modificationIndex: d.modificationIndex ?? 0,
    originalInvoiceNumber: d.originalInvoiceNumber,
    invoiceCategory: d.invoiceCategory,
    supplierTaxNumber: d.supplierTaxNumber,
    supplierName: d.supplierName,
    customerTaxNumber: d.customerTaxNumber,
    customerName: d.customerName,
    issueDate: d.invoiceIssueDate,
    deliveryDate: d.invoiceDeliveryDate,
    paymentDate: d.paymentDate,
    paymentMethod: d.paymentMethod,
    currency: d.currency,
    netAmountHuf: navAmountToFiller(d.invoiceNetAmountHuf),
    vatAmountHuf: navAmountToFiller(d.invoiceVatAmountHuf),
    completenessIndicator: d.completenessIndicator,
    insDate: d.insDate ? new Date(d.insDate) : null,
    rawDigest: d,
    firstRunId: runId,
  };
}

/**
 * Az import a háttérben: ablakonként és laponként kéri a kivonatokat (az átjáró 1 kérés/mp-et
 * enged), és felveszi az új számlákat. Ugyanaz a számla többször nem kerül be; ismételhető.
 */
export async function runImport(db: Db, gateway: GatewayClient, runId: string): Promise<void> {
  const [run] = await db.select().from(navImportRuns).where(eq(navImportRuns.id, runId));
  if (!run) return;
  const connection = await loadConnection(db, run.companyId);
  try {
    if (!connection) throw new GatewayError(409, "NOT_LINKED", "A cég nincs összekapcsolva az eÁFA NAV-kapcsolatával.");
    let found = 0;
    let created = 0;
    let done = 0;
    for (const w of splitIntoWindows(run.dateFrom, run.dateTo)) {
      let page = 1;
      let available = 1;
      do {
        const result = await gateway.digest(connection.linkId, { direction: run.direction, dateFrom: w.from, dateTo: w.to, page });
        available = result.availablePage;
        found += result.invoices.length;
        if (result.invoices.length) {
          const inserted = await db
            .insert(navInvoices)
            .values(result.invoices.map((d) => invoiceValues(run.companyId, run.direction, run.id, d)))
            .onConflictDoNothing()
            .returning({ id: navInvoices.id });
          created += inserted.length;
        }
        page++;
      } while (page <= available);
      done++;
      await db.update(navImportRuns).set({ windowsDone: done, foundCount: found, newCount: created }).where(eq(navImportRuns.id, run.id));
    }
    await db.update(navImportRuns).set({ status: "DONE", finishedAt: new Date() }).where(eq(navImportRuns.id, run.id));
    if (connection.remoteState !== "OK") await rememberRemote(db, run.companyId, "OK", "A kapcsolat működik.", null);
  } catch (e) {
    const g = e instanceof GatewayError ? e : null;
    const message = g ? (g.details.action ? `${g.message} ${g.details.action}` : g.message) : "Váratlan hiba történt az import közben.";
    await db
      .update(navImportRuns)
      .set({ status: "FAILED", finishedAt: new Date(), errorCode: g?.code ?? "INTERNAL", errorMessage: message })
      .where(eq(navImportRuns.id, run.id));
    if (g?.details.connectionBroken) await rememberRemote(db, run.companyId, "BROKEN", g.message, g.details.action ?? null);
    if (g?.code === "LINK_NOT_FOUND") {
      await rememberRemote(db, run.companyId, "REVOKED", "Az eÁFA-ban visszavonták a Könyvelő hozzáférését.", "Kérjen új kapcsolódási kódot, és kapcsolja össze újra.");
    }
  }
}

// ---------- Számlák és javaslat ----------

function stateOf(inv: Pick<InvoiceRow, "status" | "documentId">, docStatus: string | null): NavInvoiceState {
  if (inv.status === "IGNORED") return "IGNORED";
  if (!inv.documentId || !docStatus) return "NEW";
  return docStatus === "POSTED" ? "POSTED" : "DRAFT";
}

function listItem(inv: InvoiceRow, doc: { status: string; serialNumber: string | null } | undefined): NavInvoiceListItemDto {
  const inbound = inv.direction === "INBOUND";
  return {
    id: inv.id,
    direction: inv.direction,
    operation: inv.operation,
    invoiceNumber: inv.invoiceNumber,
    originalInvoiceNumber: inv.originalInvoiceNumber,
    partnerName: inbound ? inv.supplierName : inv.customerName,
    partnerTaxNumber: inbound ? inv.supplierTaxNumber : inv.customerTaxNumber,
    issueDate: inv.issueDate,
    netAmountHuf: inv.netAmountHuf,
    vatAmountHuf: inv.vatAmountHuf,
    completenessIndicator: inv.completenessIndicator,
    state: stateOf(inv, doc?.status ?? null),
    documentId: doc ? inv.documentId : null,
    documentSerialNumber: doc?.serialNumber ?? null,
  };
}

async function loadInvoice(db: Executor, companyId: string, id: string): Promise<InvoiceRow> {
  assertUuid(id, "A NAV-számla nem található.");
  const [inv] = await db.select().from(navInvoices).where(and(eq(navInvoices.companyId, companyId), eq(navInvoices.id, id)));
  if (!inv) throw notFound("A NAV-számla nem található.");
  return inv;
}

async function documentInfo(db: Executor, ids: string[]) {
  if (!ids.length) return new Map<string, { status: string; serialNumber: string | null; reversed: boolean }>();
  const rows = await db
    .select({
      id: documents.id,
      status: documents.status,
      serialNumber: documents.serialNumber,
      reversed: sql<boolean>`EXISTS (SELECT 1 FROM documents r WHERE r.reverses_document_id = ${documents.id})`,
    })
    .from(documents)
    .where(inArray(documents.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

type ProposalOptions = { partnerId?: string | null; mainAccountId?: string | null; templateId?: string | null };

type Built = {
  proposal: NavProposal;
  partner: { id: string; name: string } | null;
  original: { invoice: InvoiceRow; documentId: string | null; serialNumber: string | null } | null;
};

async function buildProposal(db: Executor, companyId: string, inv: InvoiceRow, opts: ProposalOptions): Promise<Built> {
  const inbound = inv.direction === "INBOUND";
  const partnerBase = taxNumberBase(inbound ? inv.supplierTaxNumber : inv.customerTaxNumber);
  let partner: typeof partners.$inferSelect | undefined;
  if (opts.partnerId) {
    [partner] = await db.select().from(partners).where(and(eq(partners.companyId, companyId), eq(partners.id, opts.partnerId)));
    if (!partner) throw validationError({ partnerId: "A választott partner nem található." });
  } else if (partnerBase) {
    [partner] = await db
      .select()
      .from(partners)
      .where(and(eq(partners.companyId, companyId), eq(partners.status, "ACTIVE"), sql`replace(${partners.taxNumber}, '-', '') LIKE ${partnerBase + "%"}`))
      .limit(1);
  }
  const byNumber = new Map(
    (await db.select({ id: accounts.id, number: accounts.number }).from(accounts).where(and(eq(accounts.companyId, companyId), inArray(accounts.number, ["311", "454", "466", "467"])))).map(
      (a) => [a.number, a.id],
    ),
  );
  let template: Array<{ accountId: string; side: "D" | "C"; base: "GROSS" | "NET" | "VAT" | "NONE" }> | null = null;
  if (opts.templateId) {
    const [t] = await db.select().from(postingTemplates).where(and(eq(postingTemplates.companyId, companyId), eq(postingTemplates.id, opts.templateId)));
    if (!t) throw validationError({ templateId: "A választott sablon nem található." });
    template = t.lines;
  }
  if (opts.mainAccountId) {
    const [a] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.companyId, companyId), eq(accounts.id, opts.mainAccountId)));
    if (!a) throw validationError({ mainAccountId: "A választott számla nem található." });
  }
  const main = opts.mainAccountId ?? (inbound ? partner?.defaultExpenseAccountId : partner?.defaultRevenueAccountId) ?? null;
  const partnerAccount = (inbound ? partner?.defaultPayableAccountId ?? byNumber.get("454") : partner?.defaultReceivableAccountId ?? byNumber.get("311")) ?? null;

  let original: Built["original"] = null;
  if (inv.operation !== "CREATE" && inv.originalInvoiceNumber) {
    const [o] = await db
      .select()
      .from(navInvoices)
      .where(
        and(
          eq(navInvoices.companyId, companyId),
          eq(navInvoices.direction, inv.direction),
          eq(navInvoices.supplierTaxNumber, inv.supplierTaxNumber),
          eq(navInvoices.invoiceNumber, inv.originalInvoiceNumber),
          eq(navInvoices.operation, "CREATE"),
        ),
      );
    if (o) original = { invoice: o, documentId: o.documentId, serialNumber: null };
  }
  const docs = await documentInfo(db, original?.documentId ? [original.documentId] : []);
  const od = original?.documentId ? docs.get(original.documentId) : undefined;
  if (original) original.serialNumber = od?.serialNumber ?? null;

  const proposal = proposeNavPosting(
    {
      direction: inv.direction,
      operation: inv.operation,
      invoiceNumber: inv.invoiceNumber,
      originalInvoiceNumber: inv.originalInvoiceNumber,
      partnerName: partner?.name ?? (inbound ? inv.supplierName : inv.customerName),
      issueDate: inv.issueDate,
      deliveryDate: inv.deliveryDate,
      paymentDate: inv.paymentDate,
      netAmountHuf: inv.netAmountHuf,
      vatAmountHuf: inv.vatAmountHuf,
      completenessIndicator: inv.completenessIndicator,
      currency: inv.currency,
    },
    { main, partnerAccount, vat: byNumber.get(inbound ? "466" : "467") ?? null },
    od && original?.documentId ? { id: original.documentId, status: od.status as "DRAFT" | "POSTED", reversed: od.reversed, serialNumber: od.serialNumber } : null,
    template,
  );
  if (!partner && proposal.action === "DOCUMENT") {
    proposal.blockers.push("Nincs ilyen adószámú partner: válasszon partnert, vagy vegye fel a NAV-adatokból.");
  }
  return { proposal, partner: partner ? { id: partner.id, name: partner.name } : null, original };
}

async function detailDto(db: Executor, companyId: string, inv: InvoiceRow, opts: ProposalOptions = {}): Promise<NavInvoiceDetailDto> {
  const docs = await documentInfo(db, inv.documentId ? [inv.documentId] : []);
  const doc = inv.documentId ? docs.get(inv.documentId) : undefined;
  // Ha már készült bizonylat, annak partnere számít (a felhasználó választhatott mást is).
  const [docPartner] = doc ? await db.select({ partnerId: documents.partnerId }).from(documents).where(eq(documents.id, inv.documentId!)) : [];
  const { proposal, partner, original } = await buildProposal(db, companyId, inv, { ...opts, partnerId: opts.partnerId ?? docPartner?.partnerId ?? null });
  const accountRows = await db.select({ id: accounts.id, number: accounts.number, name: accounts.name }).from(accounts).where(eq(accounts.companyId, companyId));
  const acc = new Map(accountRows.map((a) => [a.id, a]));
  const inbound = inv.direction === "INBOUND";
  const data = (inv.invoiceData ?? null) as {
    supplierTaxNumberFull?: string | null;
    customerTaxNumberFull?: string | null;
    supplierName?: string | null;
    customerName?: string | null;
    lines?: Array<{ lineNumber: number; description: string | null; quantity: number | null; unitOfMeasure: string | null; netAmountHuf: number | null; vatRate: number | null; vatCase: string | null }>;
  } | null;
  return {
    ...listItem(inv, doc),
    invoiceCategory: inv.invoiceCategory,
    deliveryDate: inv.deliveryDate,
    paymentDate: inv.paymentDate,
    paymentMethod: inv.paymentMethod,
    currency: inv.currency,
    ignoredReason: inv.ignoredReason,
    dataFetchedAt: inv.dataFetchedAt?.toISOString() ?? null,
    lines:
      data?.lines?.map((l) => ({
        lineNumber: l.lineNumber,
        description: l.description,
        quantity: l.quantity,
        unitOfMeasure: l.unitOfMeasure,
        netAmountHuf: navAmountToFiller(l.netAmountHuf),
        vatRate: l.vatRate,
        vatCase: l.vatCase,
      })) ?? null,
    partner,
    newPartner: partner
      ? null
      : {
          kind: inbound ? "SUPPLIER" : "CUSTOMER",
          name: (inbound ? inv.supplierName : inv.customerName) ?? (inbound ? data?.supplierName : data?.customerName) ?? null,
          taxNumberBase: taxNumberBase(inbound ? inv.supplierTaxNumber : inv.customerTaxNumber),
          taxNumberFull: (inbound ? data?.supplierTaxNumberFull : data?.customerTaxNumberFull) ?? null,
        },
    original: original ? { invoiceId: original.invoice.id, documentId: original.documentId, serialNumber: original.serialNumber } : null,
    proposal:
      proposal.action === "DOCUMENT"
        ? {
            action: "DOCUMENT",
            docType: proposal.docType,
            description: proposal.description,
            accountingDate: proposal.accountingDate,
            lines: proposal.lines.map((l) => ({
              accountId: l.accountId,
              accountNumber: l.accountId ? (acc.get(l.accountId)?.number ?? null) : null,
              accountName: l.accountId ? (acc.get(l.accountId)?.name ?? null) : null,
              side: l.side,
              amount: l.amount,
              role: l.role,
            })),
            warnings: proposal.warnings,
            blockers: proposal.blockers,
          }
        : {
            action: "REVERSE",
            originalSerialNumber: original?.serialNumber ?? null,
            accountingDate: proposal.accountingDate,
            reason: proposal.reason,
            warnings: proposal.warnings,
            blockers: proposal.blockers,
          },
  };
}

/** A teljes számlaadat letöltése az átjárón (egy NAV-hívás). */
async function fetchInvoiceData(db: Executor, gateway: GatewayClient, companyId: string, inv: InvoiceRow): Promise<InvoiceRow> {
  const connection = await requireConnection(db, companyId);
  const digest = inv.rawDigest as { batchIndex?: number | null };
  const data = await gateway
    .invoiceData(connection.linkId, {
      invoiceNumber: inv.invoiceNumber,
      direction: inv.direction,
      batchIndex: digest.batchIndex ?? null,
      supplierTaxNumber: inv.direction === "INBOUND" ? inv.supplierTaxNumber : null,
    })
    .catch(async (e) => {
      if (e instanceof GatewayError && e.details.connectionBroken) await rememberRemote(db, companyId, "BROKEN", e.message, e.details.action ?? null);
      return gatewayAppError(e);
    });
  if (!data.found) throw conflict("A NAV ezt a számlát most nem találja. Próbálja újra később.");
  const [updated] = await db
    .update(navInvoices)
    .set({ invoiceData: data.document, invoiceXmlBase64: data.invoiceXmlBase64, dataFetchedAt: new Date(), updatedAt: new Date() })
    .where(eq(navInvoices.id, inv.id))
    .returning();
  return updated!;
}

/** A Kezdőlap Teendői: jóváhagyásra váró NAV-számlák és a hibás kapcsolat. */
export async function navTodos(db: Executor, companyId: string): Promise<{ pending: number; connectionProblem: { title: string; action: string | null } | null } | null> {
  const c = await loadConnection(db, companyId);
  if (!c) return null;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(navInvoices)
    .leftJoin(documents, eq(documents.id, navInvoices.documentId))
    .where(and(eq(navInvoices.companyId, companyId), eq(navInvoices.status, "NEW"), sql`(${navInvoices.documentId} IS NULL OR ${documents.id} IS NULL)`));
  const problem = c.remoteState && !["OK", "NOT_TESTED"].includes(c.remoteState) ? { title: c.remoteTitle ?? "A NAV-kapcsolat hibás.", action: c.remoteAction } : null;
  return { pending: row?.n ?? 0, connectionProblem: problem };
}

// ---------- Útvonalak ----------

export const navModule: AppModule = {
  name: "nav",
  register(app, { db, config }) {
    const base = "/api/companies/:companyId/nav";
    type P = { Params: { companyId: string } };
    type PI = { Params: { companyId: string; invoiceId: string } };

    app.get<P>(`${base}/connection`, async (request) => {
      const { companyId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      return connectionDto(db, config, companyId, true);
    });

    /** Összekapcsolás a kapcsolódási kóddal; az eÁFA a cég adószámát is ellenőrzi. */
    app.post<P>(`${base}/connection`, async (request, reply) => {
      const { companyId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "company:update");
      const input = parseBody(navLinkSchema, request.body);
      const gateway = gatewayOf(config);
      if (await loadConnection(db, companyId)) throw conflict("A cég már össze van kapcsolva. Új kód használatához előbb bontsa a kapcsolatot.");
      const [company] = await db.select({ name: companies.name, taxNumber: companies.taxNumber }).from(companies).where(eq(companies.id, companyId));
      const link = await gateway.link({ code: input.code, taxNumber: company!.taxNumber, companyRef: companyId, companyName: company!.name }).catch(gatewayAppError);
      const r = remoteOf(link);
      await db.transaction(async (tx) => {
        await tx.insert(navConnections).values({
          companyId,
          linkId: link.linkId,
          environment: link.environment,
          eafaTaxpayerName: link.taxpayerName ?? company!.name,
          eafaTaxNumber: link.taxNumber ?? company!.taxNumber,
          linkedBy: user.id,
          remoteState: r.state,
          remoteTitle: r.title,
          remoteAction: r.action,
          remoteCheckedAt: new Date(),
        });
        await writeAudit(tx, {
          companyId,
          userId: user.id,
          action: "nav.link",
          entityType: "nav_connection",
          entityId: companyId,
          after: { environment: link.environment, eafaTaxpayerName: link.taxpayerName, eafaTaxNumber: link.taxNumber },
          ip: request.ip,
        });
      });
      return reply.code(201).send(await connectionDto(db, config, companyId, false));
    });

    app.delete<P>(`${base}/connection`, async (request) => {
      const { companyId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "company:update");
      const c = await requireConnection(db, companyId);
      if (config.eafaGateway) {
        await gatewayOf(config)
          .unlink(c.linkId)
          .catch((e) => {
            // Ha az eÁFA-ban már visszavonták, itt is bontjuk.
            if (!(e instanceof GatewayError && e.code === "LINK_NOT_FOUND")) gatewayAppError(e);
          });
      }
      await db.transaction(async (tx) => {
        await tx.delete(navConnections).where(eq(navConnections.companyId, companyId));
        await writeAudit(tx, {
          companyId,
          userId: user.id,
          action: "nav.unlink",
          entityType: "nav_connection",
          entityId: companyId,
          before: { environment: c.environment, eafaTaxpayerName: c.eafaTaxpayerName },
          ip: request.ip,
        });
      });
      return connectionDto(db, config, companyId, false);
    });

    app.get<P>(`${base}/imports`, async (request) => {
      const { companyId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      const rows = await db.select().from(navImportRuns).where(eq(navImportRuns.companyId, companyId)).orderBy(desc(navImportRuns.startedAt)).limit(20);
      return rows.map(runDto);
    });

    app.get<{ Params: { companyId: string; runId: string } }>(`${base}/imports/:runId`, async (request) => {
      const { companyId, runId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      assertUuid(runId, "Az import nem található.");
      const [r] = await db.select().from(navImportRuns).where(and(eq(navImportRuns.companyId, companyId), eq(navImportRuns.id, runId)));
      if (!r) throw notFound("Az import nem található.");
      return runDto(r);
    });

    /** Import indítása; a háttérben fut, az állapota lekérdezhető. */
    app.post<P>(`${base}/imports`, async (request, reply) => {
      const { companyId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      const input = parseBody(navImportSchema, request.body);
      const gateway = gatewayOf(config);
      await requireConnection(db, companyId);
      const run = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"nav-import:" + companyId}, 0))`);
        const [running] = await tx
          .select({ id: navImportRuns.id })
          .from(navImportRuns)
          .where(and(eq(navImportRuns.companyId, companyId), eq(navImportRuns.status, "RUNNING"), sql`${navImportRuns.startedAt} > now() - interval '1 hour'`));
        if (running) throw conflict("Már fut egy NAV-import ennél a cégnél; várja meg, amíg befejeződik.");
        const [created] = await tx
          .insert(navImportRuns)
          .values({ companyId, direction: input.direction, dateFrom: input.dateFrom, dateTo: input.dateTo, windowsTotal: splitIntoWindows(input.dateFrom, input.dateTo).length, startedBy: user.id })
          .returning();
        await writeAudit(tx, {
          companyId,
          userId: user.id,
          action: "nav.import",
          entityType: "nav_import_run",
          entityId: created!.id,
          after: { direction: input.direction, dateFrom: input.dateFrom, dateTo: input.dateTo },
          ip: request.ip,
        });
        return created!;
      });
      void runImport(db, gateway, run.id).catch((e) => request.log.error(e));
      return reply.code(202).send(runDto(run));
    });

    app.get<{ Params: { companyId: string }; Querystring: { state?: string; direction?: string } }>(`${base}/invoices`, async (request) => {
      const { companyId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      const where = [eq(navInvoices.companyId, companyId)];
      if (request.query.direction === "INBOUND" || request.query.direction === "OUTBOUND") where.push(eq(navInvoices.direction, request.query.direction));
      const rows = await db.select().from(navInvoices).where(and(...where)).orderBy(desc(navInvoices.issueDate), desc(navInvoices.createdAt)).limit(1000);
      const docs = await documentInfo(db, rows.map((r) => r.documentId).filter((v): v is string => Boolean(v)));
      const items = rows.map((r) => listItem(r, r.documentId ? docs.get(r.documentId) : undefined));
      const state = request.query.state;
      return state && ["NEW", "DRAFT", "POSTED", "IGNORED"].includes(state) ? items.filter((i) => i.state === state) : items;
    });

    app.get<PI & { Querystring: { partnerId?: string; mainAccountId?: string; templateId?: string } }>(`${base}/invoices/:invoiceId`, async (request) => {
      const { companyId, invoiceId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      const q = request.query;
      for (const [k, v] of Object.entries(q)) if (v) assertUuid(v, `Érvénytelen paraméter: ${k}`);
      return detailDto(db, companyId, await loadInvoice(db, companyId, invoiceId), q);
    });

    app.post<PI>(`${base}/invoices/:invoiceId/fetch-data`, async (request) => {
      const { companyId, invoiceId } = request.params;
      await requireCompanyPermission(db, request, companyId, "ledger:post");
      const updated = await fetchInvoiceData(db, gatewayOf(config), companyId, await loadInvoice(db, companyId, invoiceId));
      return detailDto(db, companyId, updated);
    });

    /**
     * Jóváhagyás: a javaslatból bizonylat lesz (piszkozat, vagy `post: true` esetén könyvelve). A
     * sztornó számlánál az eredeti bizonylat sztornója készül (az mindig azonnal könyvelt).
     */
    app.post<PI>(`${base}/invoices/:invoiceId/approve`, async (request, reply) => {
      const { companyId, invoiceId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      const input = parseBody(navApproveSchema, request.body);
      let inv = await loadInvoice(db, companyId, invoiceId);
      if (inv.status === "IGNORED") throw conflict("A számlát figyelmen kívül hagyták; előbb vegye vissza.");
      const existing = await documentInfo(db, inv.documentId ? [inv.documentId] : []);
      if (inv.documentId && existing.has(inv.documentId)) throw conflict("Ebből a NAV-számlából már készült bizonylat.");

      let partnerId = input.partnerId ?? null;
      if (input.createPartner && !partnerId) {
        if (!inv.invoiceData) inv = await fetchInvoiceData(db, gatewayOf(config), companyId, inv);
        partnerId = await createPartnerFromInvoice(db, companyId, user, request.ip, inv);
      }
      const { proposal, partner } = await buildProposal(db, companyId, inv, { partnerId, mainAccountId: input.mainAccountId, templateId: input.templateId });
      if (proposal.blockers.length) throw conflict(proposal.blockers.join(" "));

      const documentId = await db
        .transaction(async (tx) => {
          // Párhuzamos jóváhagyás ellen: a NAV-számla sorának zárolása.
          const [locked] = await tx.select().from(navInvoices).where(eq(navInvoices.id, inv.id)).for("update");
          if (locked!.documentId && (await documentInfo(tx, [locked!.documentId])).has(locked!.documentId)) {
            throw conflict("Ebből a NAV-számlából időközben már készült bizonylat.");
          }
          let id: string;
          if (proposal.action === "REVERSE") {
            id = await reverseDocument(tx, companyId, proposal.originalDocumentId!, user, request.ip, {
              accountingDate: input.accountingDate ?? proposal.accountingDate,
              reason: proposal.reason,
            });
          } else {
            const parsed = documentInputSchema.parse({
              docType: proposal.docType,
              description: proposal.description,
              partnerId: partner?.id ?? null,
              externalNumber: proposal.externalNumber,
              issueDate: proposal.issueDate,
              fulfillmentDate: proposal.fulfillmentDate,
              accountingDate: input.accountingDate ?? proposal.accountingDate,
              dueDate: proposal.dueDate,
              correctsDocumentId: proposal.correctsDocumentId,
              templateId: input.templateId ?? null,
              lines: proposal.lines.map((l) => ({ accountId: l.accountId, side: l.side, amount: l.amount })),
              post: input.post,
            });
            id = await createDocument(tx, companyId, user, request.ip, parsed, "NAV_IMPORT");
          }
          await tx.update(navInvoices).set({ documentId: id, updatedAt: new Date() }).where(eq(navInvoices.id, inv.id));
          await writeAudit(tx, {
            companyId,
            userId: user.id,
            action: "nav_invoice.approve",
            entityType: "nav_invoice",
            entityId: inv.id,
            after: { invoiceNumber: inv.invoiceNumber, operation: inv.operation, documentId: id, posted: proposal.action === "REVERSE" || input.post },
            ip: request.ip,
          });
          return id;
        })
        .catch(mapDocumentDbError);
      const after = await loadInvoice(db, companyId, inv.id);
      return reply.code(201).send({ documentId, invoice: await detailDto(db, companyId, after) });
    });

    app.post<PI>(`${base}/invoices/:invoiceId/ignore`, async (request) => {
      const { companyId, invoiceId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      const input = parseBody(navIgnoreSchema, request.body);
      const inv = await loadInvoice(db, companyId, invoiceId);
      if (inv.documentId && (await documentInfo(db, [inv.documentId])).has(inv.documentId)) {
        throw conflict("Ebből a NAV-számlából már bizonylat készült; azt a bizonylatok között kezelje.");
      }
      await db.transaction(async (tx) => {
        await tx.update(navInvoices).set({ status: "IGNORED", ignoredReason: input.reason, updatedAt: new Date() }).where(eq(navInvoices.id, inv.id));
        await writeAudit(tx, {
          companyId,
          userId: user.id,
          action: "nav_invoice.ignore",
          entityType: "nav_invoice",
          entityId: inv.id,
          after: { invoiceNumber: inv.invoiceNumber, reason: input.reason },
          ip: request.ip,
        });
      });
      return detailDto(db, companyId, await loadInvoice(db, companyId, inv.id));
    });

    app.post<PI>(`${base}/invoices/:invoiceId/restore`, async (request) => {
      const { companyId, invoiceId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      const inv = await loadInvoice(db, companyId, invoiceId);
      await db.transaction(async (tx) => {
        await tx.update(navInvoices).set({ status: "NEW", ignoredReason: null, updatedAt: new Date() }).where(eq(navInvoices.id, inv.id));
        await writeAudit(tx, {
          companyId,
          userId: user.id,
          action: "nav_invoice.restore",
          entityType: "nav_invoice",
          entityId: inv.id,
          after: { invoiceNumber: inv.invoiceNumber },
          ip: request.ip,
        });
      });
      return detailDto(db, companyId, await loadInvoice(db, companyId, inv.id));
    });
  },
};

/** Partner felvétele a NAV-adatokból (név és teljes adószám a számlaadatból). */
async function createPartnerFromInvoice(db: Db, companyId: string, user: AuthUser, ip: string, inv: InvoiceRow): Promise<string> {
  const inbound = inv.direction === "INBOUND";
  const data = (inv.invoiceData ?? {}) as { supplierTaxNumberFull?: string | null; customerTaxNumberFull?: string | null; supplierName?: string | null; customerName?: string | null };
  const full = inbound ? data.supplierTaxNumberFull : data.customerTaxNumberFull;
  const name = (inbound ? inv.supplierName ?? data.supplierName : inv.customerName ?? data.customerName)?.trim();
  const tax = full ? validateTaxNumber(full) : null;
  if (!name || !tax?.ok) {
    throw validationError(
      { partnerId: "A NAV-adatokból nem vehető fel a partner (hiányzik a név vagy a teljes adószám). Vegye fel a Partnerek között, majd válassza ki." },
      "A partner nem vehető fel automatikusan.",
    );
  }
  const [dup] = await db.select({ id: partners.id }).from(partners).where(and(eq(partners.companyId, companyId), eq(partners.taxNumber, tax.normalized)));
  if (dup) return dup.id;
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(partners)
      .values({ companyId, kind: inbound ? "SUPPLIER" : "CUSTOMER", name, taxNumber: tax.normalized, createdBy: user.id, notes: `A NAV-importból felvéve (${inv.invoiceNumber}).` })
      .returning();
    await writeAudit(tx, {
      companyId,
      userId: user.id,
      action: "partner.create",
      entityType: "partner",
      entityId: created!.id,
      after: { name, taxNumber: tax.normalized, kind: created!.kind, source: "NAV_IMPORT" },
      ip,
    });
    return created!.id;
  });
}
