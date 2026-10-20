import {
  addDays,
  applyTemplate,
  deadlineEventDate,
  deadlineStatus,
  documentBalance,
  isValidIsoDate,
  recordingDeadline,
  splitByVat,
  todayIso,
  validateForPosting,
  validateSettlementPlan,
  type DocumentType,
  type LineSide,
  type TemplateLine,
} from "@konyvelo/domain";
import type { AccountDto, DocumentDto, DocumentInput, OpenItemDto, PartnerDto } from "@konyvelo/shared";
import { amountFromText, amountText } from "../../ui/AmountInput";

/** A rögzítő űrlap állapota (a felület szövegként tárolja az összegeket, ahogy a felhasználó beírta). */

export type Row = { key: string; accountId: string | null; debit: string; credit: string; description: string };

export type Header = {
  docType: DocumentType | "";
  partnerId: string | null;
  externalNumber: string;
  description: string;
  issueDate: string;
  fulfillmentDate: string;
  accountingDate: string;
  dueDate: string;
  currency: string;
  fxAmount: string;
  fxRate: string;
  fxRateSource: "" | "MNB" | "ECB" | "BANK" | "VAT_ACT";
  fxRateDate: string;
  authorizedBy: string;
  checkedBy: string;
  correctsDocumentId: string | null;
  templateId: string | null;
};

/** Kiegyenlítendő nyitott tétel a bizonylaton (az összeg szövegként, ahogy beírták). */
export type PlanRow = { itemLineId: string; amount: string };
export type EntryState = { header: Header; rows: Row[]; plan: PlanRow[] };

let rowSeq = 0;
export const newRow = (over: Partial<Row> = {}): Row => ({ key: `r${++rowSeq}`, accountId: null, debit: "", credit: "", description: "", ...over });

export function emptyHeader(over: Partial<Header> = {}): Header {
  return {
    docType: "",
    partnerId: null,
    externalNumber: "",
    description: "",
    issueDate: "",
    fulfillmentDate: "",
    accountingDate: "",
    dueDate: "",
    currency: "HUF",
    fxAmount: "",
    fxRate: "",
    fxRateSource: "",
    fxRateDate: "",
    authorizedBy: "",
    checkedBy: "",
    correctsDocumentId: null,
    templateId: null,
    ...over,
  };
}

/** Alapértelmezett dátum: a mai nap, ha a kiválasztott üzleti évbe esik, különben az üzleti év utolsó napja. */
export function defaultDate(fy: { startDate: string; endDate: string } | null): string {
  const today = todayIso();
  if (!fy || (today >= fy.startDate && today <= fy.endDate)) return today;
  return fy.endDate;
}

export function newEntry(fy: { startDate: string; endDate: string } | null, docType: DocumentType | ""): EntryState {
  const d = defaultDate(fy);
  return { header: emptyHeader({ docType, issueDate: d, fulfillmentDate: d, accountingDate: d }), rows: [newRow(), newRow()], plan: [] };
}

const rowsFromLines = (lines: DocumentDto["lines"]): Row[] =>
  lines.map((l) =>
    newRow({
      accountId: l.accountId,
      debit: l.side === "D" && l.amount ? amountText(l.amount) : "",
      credit: l.side === "C" && l.amount ? amountText(l.amount) : "",
      description: l.description ?? "",
    }),
  );

const fxText = (minor: number | null) => (minor == null ? "" : amountText(minor));

/** Meglévő bizonylatból: piszkozat szerkesztése, másolat, vagy helyesbítő bizonylat. */
export function entryFromDocument(doc: DocumentDto, mode: "edit" | "copy" | "correct", fy: { startDate: string; endDate: string } | null): EntryState {
  if (mode === "edit") {
    const rows = rowsFromLines(doc.lines);
    return {
      header: emptyHeader({
        docType: doc.docType,
        partnerId: doc.partnerId,
        externalNumber: doc.externalNumber ?? "",
        description: doc.description ?? "",
        issueDate: doc.issueDate ?? "",
        fulfillmentDate: doc.fulfillmentDate ?? "",
        accountingDate: doc.accountingDate,
        dueDate: doc.dueDate ?? "",
        currency: doc.currency,
        fxAmount: fxText(doc.fxAmount),
        fxRate: doc.fxRate == null ? "" : String(doc.fxRate).replace(".", ","),
        fxRateSource: doc.fxRateSource ?? "",
        fxRateDate: doc.fxRateDate ?? "",
        authorizedBy: doc.authorizedBy ?? "",
        checkedBy: doc.checkedBy ?? "",
        correctsDocumentId: doc.corrects?.id ?? null,
        templateId: doc.templateId,
      }),
      rows: rows.length >= 2 ? rows : [...rows, ...Array.from({ length: 2 - rows.length }, () => newRow())],
      plan: doc.settlementPlan.map((p) => ({ itemLineId: p.itemLineId, amount: amountText(p.amount) })),
    };
  }
  const base = newEntry(fy, mode === "correct" ? "HELY" : doc.docType === "SZT" ? "" : doc.docType);
  if (mode === "correct") {
    base.header.partnerId = doc.partnerId;
    base.header.correctsDocumentId = doc.id;
    base.header.description = `Helyesbítés: ${doc.serialNumber} – `;
    base.header.externalNumber = doc.serialNumber ?? "";
    return base;
  }
  base.header = {
    ...base.header,
    partnerId: doc.partnerId,
    description: doc.description ?? "",
    currency: doc.currency,
  };
  base.rows = rowsFromLines(doc.lines);
  return base;
}

export type PreparedLine = { key: string; accountId: string | null; side: LineSide | null; amount: number | null; description: string | null };

/**
 * Az elküldendő adatok: a teljesen üres sorok kimaradnak (a szerver is így
 * tárolja), a hibás összegű sorok hibát kapnak.
 */
export function prepare(state: EntryState) {
  const amountErrors: Record<string, string> = {};
  const lines: PreparedLine[] = [];
  for (const r of state.rows) {
    const d = amountFromText(r.debit);
    const c = amountFromText(r.credit);
    if (d === undefined || c === undefined) amountErrors[`line:${r.key}:amount`] = "Érvénytelen összeg (pl. 12 500 vagy 12 500,50).";
    const debit = typeof d === "number" && d > 0 ? d : null;
    const credit = typeof c === "number" && c > 0 ? c : null;
    if (debit && credit) amountErrors[`line:${r.key}:amount`] = "Egy sorban csak az egyik oldalon lehet összeg.";
    const side: LineSide | null = debit ? "D" : credit ? "C" : null;
    const amount = debit ?? credit ?? null;
    const description = r.description.trim() || null;
    if (!r.accountId && !amount && !description && !amountErrors[`line:${r.key}:amount`]) continue;
    lines.push({ key: r.key, accountId: r.accountId, side, amount, description });
  }
  const h = state.header;
  const fxAmount = h.currency !== "HUF" ? amountFromText(h.fxAmount) : null;
  const fxRateNum = h.fxRate.trim() ? Number(h.fxRate.replace(/\s/g, "").replace(",", ".")) : null;
  const payload: DocumentInput = {
    docType: (h.docType || undefined) as DocumentType,
    description: h.description,
    partnerId: h.partnerId,
    externalNumber: h.externalNumber,
    issueDate: h.issueDate || null,
    fulfillmentDate: h.fulfillmentDate || null,
    accountingDate: h.accountingDate,
    dueDate: h.dueDate || null,
    currency: h.currency || "HUF",
    fxAmount: typeof fxAmount === "number" ? fxAmount : null,
    fxRate: fxRateNum != null && Number.isFinite(fxRateNum) ? fxRateNum : null,
    fxRateSource: h.fxRateSource || null,
    fxRateDate: h.fxRateDate || null,
    authorizedBy: h.authorizedBy,
    checkedBy: h.checkedBy,
    correctsDocumentId: h.correctsDocumentId,
    templateId: h.templateId,
    lines: lines.map(({ key: _k, ...l }) => l),
    settlements: state.plan.map((p) => ({ itemLineId: p.itemLineId, amount: amountFromText(p.amount) ?? 0 })),
  };
  const fieldErrors: Record<string, string> = {};
  if (h.currency !== "HUF" && fxAmount === undefined) fieldErrors.fxAmount = "Érvénytelen devizaösszeg.";
  if (h.fxRate.trim() && (fxRateNum == null || !Number.isFinite(fxRateNum))) fieldErrors.fxRate = "Érvénytelen árfolyam (pl. 395,12).";
  state.plan.forEach((p, i) => {
    if (amountFromText(p.amount) === undefined) fieldErrors[`settlements.${i}`] = "Érvénytelen összeg.";
  });
  return { payload, lines, rowKeys: lines.map((l) => l.key), amountErrors, fieldErrors, balance: documentBalance(lines) };
}

/** A szerver „lines.3.amount” kulcsait a felület sorazonosítóira fordítja. */
export function mapLineErrors(errors: Record<string, string>, rowKeys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(errors)) {
    const m = /^lines\.(\d+)\.(\w+)$/.exec(k);
    const key = m ? rowKeys[Number(m[1])] : undefined;
    out[m && key ? `line:${key}:${m[2] === "side" ? "amount" : m[2]}` : k] = v;
  }
  return out;
}

export function validateEntry(state: EntryState, accounts: ReadonlyMap<string, AccountDto>, openItems?: ReadonlyMap<string, OpenItemDto>) {
  const p = prepare(state);
  const planErrors =
    openItems && state.plan.length
      ? validateSettlementPlan(
          p.payload.settlements ?? [],
          p.lines,
          (id) => {
            const i = openItems.get(id);
            return i && { lineId: i.lineId, accountId: i.accountId, accountNumber: i.accountNumber, partnerId: i.partnerId, open: i.open, label: i.serialNumber ?? "" };
          },
          (id) => accounts.get(id)?.subledger,
          state.header.partnerId,
        )
      : {};
  const errors = mapLineErrors(
    validateForPosting(
      {
        docType: p.payload.docType ?? null,
        description: p.payload.description ?? null,
        issueDate: p.payload.issueDate ?? null,
        fulfillmentDate: p.payload.fulfillmentDate ?? null,
        accountingDate: p.payload.accountingDate || null,
        dueDate: p.payload.dueDate ?? null,
        externalNumber: p.payload.externalNumber ?? null,
        partnerId: p.payload.partnerId ?? null,
        currency: p.payload.currency ?? "HUF",
        fxAmount: p.payload.fxAmount ?? null,
        fxRate: p.payload.fxRate ?? null,
        correctsDocumentId: p.payload.correctsDocumentId ?? null,
        lines: p.lines,
      },
      (id) => accounts.get(id),
    ),
    p.rowKeys,
  );
  p.lines.forEach((l) => {
    const a = l.accountId ? accounts.get(l.accountId) : undefined;
    if (a?.hasChildren) errors[`line:${l.key}:accountId`] = `A(z) ${a.number} gyűjtőszámla; válasszon alszámlát.`;
  });
  return { ...p, errors: { ...errors, ...planErrors, ...p.amountErrors, ...p.fieldErrors } };
}

/** Rögzítési határidő a bizonylat adatai alapján (ha a dátumok már megvannak). */
export function entryDeadline(state: EntryState, accounts: ReadonlyMap<string, AccountDto>) {
  const h = state.header;
  if (!isValidIsoDate(h.accountingDate)) return null;
  const subs = state.rows.map((r) => (r.accountId ? accounts.get(r.accountId)?.subledger : undefined));
  const d = recordingDeadline({
    eventDate: deadlineEventDate({ fulfillmentDate: h.fulfillmentDate || null, issueDate: h.issueDate || null, accountingDate: h.accountingDate }),
    touchesCash: subs.includes("CASH"),
    touchesBank: subs.includes("BANK"),
  });
  return { ...d, status: deadlineStatus(d.deadline, { postedOn: null, today: todayIso() }) };
}

// ---------- Sablonok és partner-alapértelmezés ----------

export type ApplicableTemplate = {
  id: string | null;
  name: string;
  shortcut: string | null;
  docType: DocumentType | null;
  description: string | null;
  vatRate: number | null;
  partnerId: string | null;
  lines: TemplateLine[];
};

/** A partner alapértelmezett kontírozása mint sablon (szállítói / vevőszámlánál). */
export function partnerTemplate(p: PartnerDto | undefined, docType: Header["docType"], accounts: readonly AccountDto[]): ApplicableTemplate | null {
  if (!p) return null;
  const byNumber = (n: string) => accounts.find((a) => a.number === n && a.isActive && !a.hasChildren)?.id;
  if (docType === "SZSZ" && p.defaultExpenseAccountId) {
    const payable = p.defaultPayableAccountId ?? byNumber("454");
    const vat = byNumber("466");
    if (!payable) return null;
    return {
      id: null,
      name: `${p.name} – alapértelmezett kontírozás (27% áfa)`,
      shortcut: null,
      docType: "SZSZ",
      description: null,
      vatRate: 27,
      partnerId: p.id,
      lines: [
        { accountId: p.defaultExpenseAccountId, side: "D", base: "NET" },
        ...(vat ? [{ accountId: vat, side: "D" as const, base: "VAT" as const }] : []),
        { accountId: payable, side: "C", base: "GROSS" },
      ],
    };
  }
  if (docType === "VSZ" && p.defaultRevenueAccountId) {
    const receivable = p.defaultReceivableAccountId ?? byNumber("311");
    const vat = byNumber("467");
    if (!receivable) return null;
    return {
      id: null,
      name: `${p.name} – alapértelmezett kontírozás (27% áfa)`,
      shortcut: null,
      docType: "VSZ",
      description: null,
      vatRate: 27,
      partnerId: p.id,
      lines: [
        { accountId: receivable, side: "D", base: "GROSS" },
        { accountId: p.defaultRevenueAccountId, side: "C", base: "NET" },
        ...(vat ? [{ accountId: vat, side: "C" as const, base: "VAT" as const }] : []),
      ],
    };
  }
  return null;
}

/** Sablon alkalmazása az űrlapra: sorok, és ha még üres, típus, leírás, partner. */
export function withTemplate(state: EntryState, t: ApplicableTemplate, amount: number | null, kind: "GROSS" | "NET", vatRate: number): EntryState {
  const split = amount != null && amount > 0 ? splitByVat(amount, kind, vatRate) : null;
  const rows = applyTemplate(t.lines, split).map((l) =>
    newRow({ accountId: l.accountId, debit: l.side === "D" && l.amount ? amountText(l.amount) : "", credit: l.side === "C" && l.amount ? amountText(l.amount) : "" }),
  );
  const h = state.header;
  return {
    header: {
      ...h,
      docType: h.docType === "HELY" ? h.docType : (t.docType ?? h.docType),
      description: h.description.trim() ? h.description : (t.description ?? h.description),
      partnerId: h.partnerId ?? t.partnerId,
      templateId: t.id,
    },
    rows: [...rows, newRow()],
    plan: state.plan,
  };
}

/**
 * A kiválasztott nyitott tételekből a tételsorok: számlánként egy
 * kiegyenlítő sor (szállítónál tartozik, vevőnél követel), és – bank- vagy
 * pénztárbizonylatnál – az ellenoldali pénzeszközsor.
 */
export function rowsFromPlan(state: EntryState, items: ReadonlyMap<string, OpenItemDto>, accounts: readonly AccountDto[]): Row[] {
  const perAccount = new Map<string, { kind: OpenItemDto["kind"]; sum: number }>();
  for (const p of state.plan) {
    const it = items.get(p.itemLineId);
    const a = amountFromText(p.amount);
    if (!it || typeof a !== "number") continue;
    const cur = perAccount.get(it.accountId) ?? { kind: it.kind, sum: 0 };
    cur.sum += a;
    perAccount.set(it.accountId, cur);
  }
  const rows: Row[] = [];
  let net = 0; // pénzeszköz-hatás: + bevétel, − kiadás
  for (const [accountId, { kind, sum }] of perAccount) {
    if (kind === "PAYABLE") {
      rows.push(newRow({ accountId, debit: amountText(sum) }));
      net -= sum;
    } else {
      rows.push(newRow({ accountId, credit: amountText(sum) }));
      net += sum;
    }
  }
  const t = state.header.docType;
  const sub = t === "BANK" ? "BANK" : t === "PB" || t === "PK" ? "CASH" : null;
  const money = sub ? accounts.find((a) => a.subledger === sub && a.isActive && !a.hasChildren) : undefined;
  if (money && net !== 0) rows.push(newRow({ accountId: money.id, debit: net > 0 ? amountText(net) : "", credit: net < 0 ? amountText(-net) : "" }));
  return [...rows, newRow()];
}

/** Fizetési határidő a partner fizetési feltétele szerint (számláknál), ha kiszámítható. */
export function suggestedDueDate(h: Header, p: PartnerDto | undefined | null): string | null {
  if (!p || p.paymentTermsDays == null || !isValidIsoDate(h.issueDate) || (h.docType !== "SZSZ" && h.docType !== "VSZ")) return null;
  return addDays(h.issueDate, p.paymentTermsDays);
}

/** Partner választásakor: a fizetési határidő a partner fizetési feltételéből, ha a felhasználó nem adta meg kézzel. */
export function withPartner(state: EntryState, p: PartnerDto | null, dueDateTouched: boolean): EntryState {
  const h = { ...state.header, partnerId: p?.id ?? null };
  // Másik partner tételei nem egyenlíthetők ki.
  if (h.partnerId !== state.header.partnerId) state = { ...state, plan: [] };
  const due = dueDateTouched ? null : suggestedDueDate(h, p);
  return { ...state, header: { ...h, dueDate: due ?? h.dueDate } };
}
