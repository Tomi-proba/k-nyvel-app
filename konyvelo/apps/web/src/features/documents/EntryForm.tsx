import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { DOCUMENT_TYPES, formatDateHu, formatHuf, missingAmountFor, documentBalance, balanceErrorMessage, type DocumentType } from "@konyvelo/domain";
import { ENTERABLE_DOCUMENT_TYPES, FX_RATE_SOURCE_LABELS, FX_RATE_SOURCES, type DocumentDto } from "@konyvelo/shared";
import { useWorkspace } from "../../app/workspace";
import { ApiError, del, patch, post } from "../../lib/api";
import { submitOnCtrlEnter } from "../../lib/form";
import { writeSetting } from "../../lib/storage";
import { AccountPicker } from "../../ui/AccountPicker";
import { AmountInput, amountText } from "../../ui/AmountInput";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { DateInput } from "../../ui/DateInput";
import { ErrorSummary, Field } from "../../ui/Field";
import { PageHeader } from "../../ui/Page";
import { PartnerPicker } from "../../ui/PartnerPicker";
import { useToast } from "../../ui/Toasts";
import { HelpTip, Kbd, Tooltip } from "../../ui/Tooltip";
import { useAccounts } from "../accounts/useAccounts";
import { usePartners } from "../partners/usePartners";
import {
  entryDeadline,
  mapLineErrors,
  newRow,
  partnerTemplate,
  prepare,
  rowsFromPlan,
  suggestedDueDate,
  validateEntry,
  withPartner,
  withTemplate,
  type ApplicableTemplate,
  type EntryState,
  type Header,
  type Row,
} from "./entry-model";
import { PreviewDialog, type PreviewData } from "./PreviewDialog";
import { deadlineText, useInvalidateDocuments, useTemplates } from "./queries";
import { SettlementSection } from "./SettlementSection";
import { TemplateDialog } from "./TemplateDialog";
import { useOpenItems } from "../subledger/SubledgerPages";

/**
 * Bizonylat rögzítése (PLAN 5.2): fejadatok, tételsorok tartozik/követel
 * oszloppal, folyamatos egyensúly-ellenőrzés, előnézet könyvelés előtt.
 * Billentyűk: Enter a következő mezőre lép (a sor végén új sor), „=” a
 * hiányzó különbözetet írja be, Alt+L sablon, Ctrl+Enter előnézet.
 */
export function EntryForm({ initial, draftId, reference }: { initial: EntryState; draftId: string | null; reference?: DocumentDto | null }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidateDocuments();
  const companyId = ws.company!.id;
  const accountsQ = useAccounts();
  const partnersQ = usePartners();
  const templatesQ = useTemplates();
  const accountList = useMemo(() => accountsQ.data ?? [], [accountsQ.data]);
  const accounts = useMemo(() => new Map(accountList.map((a) => [a.id, a])), [accountList]);
  const partners = useMemo(() => partnersQ.data ?? [], [partnersQ.data]);

  const [state, setState] = useState<EntryState>(initial);
  // A kézzel módosított dátumokat a rendszer már nem írja át automatikusan.
  const [touched, setTouched] = useState<{ accountingDate: boolean; fulfillmentDate: boolean; dueDate: boolean }>({
    accountingDate: Boolean(draftId),
    fulfillmentDate: Boolean(draftId),
    dueDate: Boolean(draftId),
  });
  const [attempted, setAttempted] = useState(false);
  /** Könyvelési kísérletek száma: minden kísérletnél a hibaösszesítő újra fókuszt kap. */
  const [attempts, setAttempts] = useState(0);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const initialJson = useRef(JSON.stringify(initial));
  const dirty = JSON.stringify(state) !== initialJson.current;
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  const h = state.header;
  const type = h.docType ? DOCUMENT_TYPES[h.docType] : null;
  const defaultYear = Number((ws.fiscalYear?.startDate ?? h.accountingDate ?? "").slice(0, 4)) || undefined;

  // A partner nyitott tételei (kiegyenlítéshez); számlánál nem kínáljuk fel.
  const offerSettlement = Boolean(h.partnerId) && h.docType !== "" && h.docType !== "SZSZ" && h.docType !== "VSZ";
  const openQ = useOpenItems({ partnerId: h.partnerId }, offerSettlement);
  const openMap = useMemo(() => new Map((openQ.data?.items ?? []).map((i) => [i.lineId, i])), [openQ.data]);
  const v = useMemo(() => validateEntry(state, accounts, openQ.data ? openMap : undefined), [state, accounts, openQ.data, openMap]);
  const errors = attempted ? { ...v.errors, ...serverErrors } : serverErrors;
  const deadline = useMemo(() => entryDeadline(state, accounts), [state, accounts]);
  const balanceMsg = balanceErrorMessage(v.balance);

  // Nem mentett változásnál a böngésző figyelmeztet az oldal elhagyásakor.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Alt+L: sablon választása.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyL") {
        if (document.querySelector("[role='dialog'], [role='alertdialog']")) return;
        e.preventDefault();
        setTemplateOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!focusRow) return;
    tbodyRef.current?.querySelector<HTMLInputElement>(`tr[data-row-key="${focusRow}"] input`)?.focus();
    setFocusRow(null);
  }, [focusRow, state.rows]);

  const update = (fn: (s: EntryState) => EntryState) => {
    setState(fn);
    setServerErrors({});
    setFormError(null);
  };
  const setHeader = <K extends keyof Header>(key: K, value: Header[K]) => update((s) => ({ ...s, header: { ...s.header, [key]: value } }));
  const setRow = (key: string, patchRow: Partial<Row>) => update((s) => ({ ...s, rows: s.rows.map((r) => (r.key === key ? { ...r, ...patchRow } : r)) }));
  const addRow = (focus = true) => {
    const r = newRow();
    update((s) => ({ ...s, rows: [...s.rows, r] }));
    if (focus) setFocusRow(r.key);
  };
  const removeRow = (key: string) => update((s) => ({ ...s, rows: s.rows.length > 1 ? s.rows.filter((r) => r.key !== key) : [newRow()] }));

  /** „=”: a sor oldalára a többi sor alapján hiányzó összeg. */
  const fillDifference = (row: Row, side: "D" | "C") => {
    const others = prepare({ ...state, rows: state.rows.filter((r) => r.key !== row.key) });
    const missing = missingAmountFor(side, documentBalance(others.lines));
    if (missing > 0) setRow(row.key, side === "D" ? { debit: amountText(missing), credit: "" } : { credit: amountText(missing), debit: "" });
  };

  const setIssueDate = (iso: string) =>
    update((s) => {
      const header = {
        ...s.header,
        issueDate: iso,
        accountingDate: touched.accountingDate || !iso ? s.header.accountingDate : iso,
        fulfillmentDate: touched.fulfillmentDate || !iso ? s.header.fulfillmentDate : iso,
      };
      const due = touched.dueDate ? null : suggestedDueDate(header, partners.find((p) => p.id === header.partnerId));
      return { ...s, header: { ...header, dueDate: due ?? header.dueDate } };
    });

  const templates: ApplicableTemplate[] = useMemo(() => {
    const own = (templatesQ.data ?? []).filter((t) => t.isActive);
    const fromPartner = partnerTemplate(
      partners.find((p) => p.id === h.partnerId),
      h.docType,
      accountList,
    );
    return [...(fromPartner ? [fromPartner] : []), ...own];
  }, [templatesQ.data, partners, h.partnerId, h.docType, accountList]);

  // ---------- Mentés ----------

  const savePayload = async (postIt: boolean) => {
    const p = prepare(state);
    const body = { ...p.payload, post: postIt };
    try {
      const saved = draftId
        ? await patch<DocumentDto>(`/api/companies/${companyId}/documents/${draftId}`, body)
        : await post<DocumentDto>(`/api/companies/${companyId}/documents`, body);
      if (h.docType) writeSetting("lastDocType", h.docType);
      initialJson.current = JSON.stringify(state);
      await invalidate();
      return saved;
    } catch (err) {
      if (err instanceof ApiError) {
        setServerErrors(mapLineErrors(err.fields, p.rowKeys));
        setFormError(err.message);
      } else setFormError("Váratlan hiba történt. Kérjük, próbálja újra.");
      return null;
    }
  };

  const saveDraft = async () => {
    if (!h.docType || !h.accountingDate) {
      setServerErrors({
        ...(!h.docType ? { docType: "Válassza ki a bizonylat típusát." } : {}),
        ...(!h.accountingDate ? { accountingDate: "Könyvelés dátuma: kötelező mező." } : {}),
      });
      setFormError("A piszkozathoz a típus és a könyvelés dátuma kell.");
      return;
    }
    setBusy(true);
    const saved = await savePayload(false);
    setBusy(false);
    if (saved) {
      toast("success", "A piszkozat mentése sikerült.");
      if (!draftId) navigate(`/konyveles/${saved.id}`, { replace: true });
    }
  };

  const openPreview = () => {
    setAttempted(true);
    setAttempts((n) => n + 1);
    if (Object.keys(v.errors).length > 0) {
      setFormError("A bizonylat még nem könyvelhető. Kérjük, javítsa a megjelölt hibákat.");
      return;
    }
    setFormError(null);
    setPreviewOpen(true);
  };

  const confirmPost = async () => {
    setBusy(true);
    const saved = await savePayload(true);
    setBusy(false);
    if (!saved) {
      setPreviewOpen(false);
      return;
    }
    setPreviewOpen(false);
    toast("success", `Könyvelve: ${saved.serialNumber}`);
    navigate(`/konyveles/${saved.id}`, { replace: Boolean(draftId) });
  };

  const previewData: PreviewData | null =
    previewOpen && h.docType
      ? {
          docType: h.docType,
          partnerName: partners.find((p) => p.id === h.partnerId)?.name ?? null,
          externalNumber: h.externalNumber,
          description: h.description,
          issueDate: h.issueDate,
          fulfillmentDate: h.fulfillmentDate,
          accountingDate: h.accountingDate,
          dueDate: h.dueDate,
          lines: v.lines,
          balance: v.balance,
          deadline,
          correctsSerial: reference?.serialNumber ?? null,
        }
      : null;

  // ---------- Billentyűzet: Enter a következő mezőre ----------

  const onFormKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    submitOnCtrlEnter(e);
    if (e.defaultPrevented || e.key !== "Enter" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target as HTMLElement;
    const isField = t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit"].includes(t.type));
    if (!isField) return;
    e.preventDefault();
    const fields = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])"),
    ).filter((el) => el.offsetParent !== null);
    const next = fields[fields.indexOf(t) + 1];
    const tbody = tbodyRef.current;
    if (tbody?.contains(t) && (!next || !tbody.contains(next))) {
      addRow();
      return;
    }
    next?.focus();
  };

  const title = draftId ? "Piszkozat szerkesztése" : h.docType === "HELY" ? "Helyesbítő bizonylat" : "Új bizonylat";
  const lineErr = (row: Row, field: "accountId" | "amount" | "description") => errors[`line:${row.key}:${field}`];

  return (
    <>
      <PageHeader
        title={title}
        description="Bizonylat nélkül nem lehet könyvelni (Szt. 165. §). Könyvelés előtt előnézet készül."
        actions={
          <Tooltip content="Kontírozási sablon – Alt+L">
            <button type="button" className="btn" aria-keyshortcuts="Alt+L" onClick={() => setTemplateOpen(true)}>
              Sablon <Kbd>Alt+L</Kbd>
            </button>
          </Tooltip>
        }
      />

      {reference && (
        <section className="card card-muted" aria-labelledby="eredeti">
          <h2 id="eredeti">
            Helyesbített bizonylat: <span className="mono">{reference.serialNumber}</span>
          </h2>
          <p className="muted">
            {reference.description} · könyvelve {formatDateHu(reference.accountingDate)}. A helyesbítő bizonylaton csak a <strong>különbözetet</strong>{" "}
            rögzítse (pl. utólagos engedménynél a csökkenést fordított oldalon).
          </p>
          <ul className="plain-list mono small">
            {reference.lines.map((l) => (
              <li key={l.id}>
                {l.accountNumber} {l.side === "D" ? "T" : "K"} {formatHuf(l.amount)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <form
        className="form entry-form"
        noValidate
        onKeyDown={onFormKeyDown}
        onSubmit={(e) => {
          e.preventDefault();
          openPreview();
        }}
      >
        {(formError || (attempted && Object.keys(errors).length > 0)) && (
          <ErrorSummary message={formError ?? "A bizonylat még nem könyvelhető. Kérjük, javítsa a megjelölt hibákat."} fields={errors} attempt={attempts} />
        )}

        <section className="card stack" aria-labelledby="fejadatok">
          <h2 id="fejadatok" className="sr-only">
            Bizonylat adatai
          </h2>
          <div className="form-row">
            <Field label="Bizonylat típusa" required error={errors.docType} help="bizonylat">
              {(p) => (
                <select
                  {...p}
                  value={h.docType}
                  disabled={h.docType === "HELY"}
                  onChange={(e) => setHeader("docType", e.target.value as DocumentType)}
                >
                  <option value="">Válasszon…</option>
                  {ENTERABLE_DOCUMENT_TYPES.filter((t) => DOCUMENT_TYPES[t].selectable || t === h.docType).map((t) => (
                    <option key={t} value={t}>
                      {DOCUMENT_TYPES[t].label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Partner" required={type?.requiresPartner} error={errors.partnerId}>
              {(p) => (
                <PartnerPicker
                  partners={partners}
                  value={h.partnerId}
                  kind={type?.partnerKind}
                  controlProps={p}
                  onChange={(partner) => update((s) => withPartner(s, partner, touched.dueDate))}
                />
              )}
            </Field>
          </div>
          <div className="form-row">
            <Field label={type?.externalNumberLabel ?? "Külső bizonylatszám"} required={type?.requiresExternalNumber} error={errors.externalNumber}>
              {(p) => <input {...p} type="text" autoComplete="off" value={h.externalNumber} onChange={(e) => setHeader("externalNumber", e.target.value)} />}
            </Field>
            <Field label="A gazdasági művelet leírása" required error={errors.description} hint="Pl. „Irodatakarítás, 2026. március”.">
              {(p) => <input {...p} type="text" autoComplete="off" value={h.description} onChange={(e) => setHeader("description", e.target.value)} />}
            </Field>
          </div>
          <div className="form-row form-row-4">
            <Field label="Kelt" required error={errors.issueDate} help="kelt">
              {(p) => <DateInput controlProps={p} value={h.issueDate} defaultYear={defaultYear} onChange={setIssueDate} />}
            </Field>
            <Field label="Teljesítés" required={type?.requiresFulfillmentDate} error={errors.fulfillmentDate} help="teljesites">
              {(p) => (
                <DateInput
                  controlProps={p}
                  value={h.fulfillmentDate}
                  defaultYear={defaultYear}
                  onChange={(iso) => {
                    setTouched((t) => ({ ...t, fulfillmentDate: true }));
                    setHeader("fulfillmentDate", iso);
                  }}
                />
              )}
            </Field>
            <Field label="Könyvelés dátuma" required error={errors.accountingDate} help="konyvelesDatuma">
              {(p) => (
                <DateInput
                  controlProps={p}
                  value={h.accountingDate}
                  defaultYear={defaultYear}
                  onChange={(iso) => {
                    setTouched((t) => ({ ...t, accountingDate: true }));
                    setHeader("accountingDate", iso);
                  }}
                />
              )}
            </Field>
            <Field label="Fizetési határidő" error={errors.dueDate}>
              {(p) => (
                <DateInput
                  controlProps={p}
                  value={h.dueDate}
                  defaultYear={defaultYear}
                  onChange={(iso) => {
                    setTouched((t) => ({ ...t, dueDate: true }));
                    setHeader("dueDate", iso);
                  }}
                />
              )}
            </Field>
          </div>
          {deadline && (
            <p className={deadline.status === "OVERDUE" ? "alert alert-warning" : deadline.status === "DUE_SOON" ? "alert alert-info" : "muted small"}>
              {deadlineText(deadline)} – {deadline.rule}
            </p>
          )}

          <details>
            <summary>Deviza, utalványozó, ellenőrző</summary>
            <div className="form-row form-row-4">
              <Field label="Pénznem" error={errors.currency} hint="A könyvelés mindig forintban történik.">
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    className="input-narrow"
                    maxLength={3}
                    value={h.currency}
                    onChange={(e) => setHeader("currency", e.target.value.toUpperCase())}
                  />
                )}
              </Field>
              {h.currency !== "HUF" && (
                <>
                  <Field label={`Devizaösszeg (${h.currency})`} error={errors.fxAmount}>
                    {(p) => <AmountInput controlProps={p} value={h.fxAmount} onChange={(t) => setHeader("fxAmount", t)} />}
                  </Field>
                  <Field label="Alkalmazott árfolyam (Ft)" error={errors.fxRate}>
                    {(p) => <input {...p} type="text" inputMode="decimal" value={h.fxRate} onChange={(e) => setHeader("fxRate", e.target.value)} />}
                  </Field>
                  <Field label="Árfolyam forrása">
                    {(p) => (
                      <select {...p} value={h.fxRateSource} onChange={(e) => setHeader("fxRateSource", e.target.value as Header["fxRateSource"])}>
                        <option value="">Válasszon…</option>
                        {FX_RATE_SOURCES.map((s) => (
                          <option key={s} value={s}>
                            {FX_RATE_SOURCE_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                </>
              )}
            </div>
            <div className="form-row">
              <Field label="Utalványozó" hint="Aki a gazdasági műveletet elrendelte (Szt. 167. § (1) c)).">
                {(p) => <input {...p} type="text" value={h.authorizedBy} onChange={(e) => setHeader("authorizedBy", e.target.value)} />}
              </Field>
              <Field label="Ellenőrző">
                {(p) => <input {...p} type="text" value={h.checkedBy} onChange={(e) => setHeader("checkedBy", e.target.value)} />}
              </Field>
            </div>
          </details>
        </section>

        {offerSettlement && ((openQ.data?.items.length ?? 0) > 0 || state.plan.length > 0) && (
          <SettlementSection
            items={openQ.data?.items ?? []}
            plan={state.plan}
            errors={errors}
            onChange={(plan) =>
              update((s) => {
                const next = { ...s, plan };
                // Első kijelöléskor, ha még nincs számla a sorokon, a sorok is kitöltődnek.
                const empty = s.rows.every((r) => !r.accountId && !r.debit && !r.credit);
                return s.plan.length === 0 && plan.length > 0 && empty ? { ...next, rows: rowsFromPlan(next, openMap, accountList) } : next;
              })
            }
            onFillRows={() => update((s) => ({ ...s, rows: rowsFromPlan(s, openMap, accountList) }))}
          />
        )}

        <section className="card" aria-labelledby="tetelek">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 id="tetelek" style={{ margin: 0 }}>
              Tételsorok (kontírozás) <HelpTip term="tartozikKovetel" />
            </h2>
            <span className="muted small">
              <Kbd>Enter</Kbd> következő mező · <Kbd>=</Kbd> különbözet · <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> előnézet
            </span>
          </div>
          {errors.lines && (
            <p className="error" role="alert">
              {errors.lines}
            </p>
          )}
          <div className="table-wrap">
            <table className="lines-table">
              <caption className="sr-only">Tételsorok</caption>
              <thead>
                <tr>
                  <th scope="col" className="col-no">
                    #
                  </th>
                  <th scope="col">Számla</th>
                  <th scope="col" className="num">
                    Tartozik
                  </th>
                  <th scope="col" className="num">
                    Követel
                  </th>
                  <th scope="col">Tételszöveg</th>
                  <th scope="col">
                    <span className="sr-only">Művelet</span>
                  </th>
                </tr>
              </thead>
              <tbody ref={tbodyRef}>
                {state.rows.map((row, i) => {
                  const accErr = lineErr(row, "accountId");
                  const amtErr = lineErr(row, "amount");
                  const ctl = (field: string, label: string, err: string | undefined, errId: string) => ({
                    id: `line-${row.key}-${field}`,
                    "aria-label": `${i + 1}. sor: ${label}`,
                    "aria-invalid": Boolean(err),
                    "aria-describedby": err ? errId : undefined,
                    "aria-required": undefined,
                  });
                  const accErrId = `line-${row.key}-account-err`;
                  const amtErrId = `line-${row.key}-amount-err`;
                  return (
                    <tr key={row.key} data-row-key={row.key}>
                      <td className="col-no muted">{i + 1}.</td>
                      <td className="col-account">
                        <AccountPicker accounts={accountList} value={row.accountId} onChange={(id) => setRow(row.key, { accountId: id })} controlProps={ctl("account", "számla", accErr, accErrId)} />
                        {accErr && (
                          <div className="error" id={accErrId}>
                            {accErr}
                          </div>
                        )}
                      </td>
                      <td className="col-amount">
                        <AmountInput
                          value={row.debit}
                          onChange={(t) => setRow(row.key, t.trim() ? { debit: t, credit: "" } : { debit: t })}
                          onFillDifference={() => fillDifference(row, "D")}
                          controlProps={ctl("debit", "tartozik összeg", amtErr, amtErrId)}
                        />
                      </td>
                      <td className="col-amount">
                        <AmountInput
                          value={row.credit}
                          onChange={(t) => setRow(row.key, t.trim() ? { credit: t, debit: "" } : { credit: t })}
                          onFillDifference={() => fillDifference(row, "C")}
                          controlProps={ctl("credit", "követel összeg", amtErr, amtErrId)}
                        />
                        {amtErr && (
                          <div className="error" id={amtErrId}>
                            {amtErr}
                          </div>
                        )}
                      </td>
                      <td>
                        <input
                          type="text"
                          aria-label={`${i + 1}. sor: tételszöveg`}
                          value={row.description}
                          onChange={(e) => setRow(row.key, { description: e.target.value })}
                        />
                      </td>
                      <td>
                        <button type="button" className="btn btn-small btn-icon" aria-label={`${i + 1}. sor törlése`} onClick={() => removeRow(row.key)}>
                          <span aria-hidden="true">×</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
            <button type="button" className="btn btn-small" onClick={() => addRow()}>
              + Új sor
            </button>
            <div className={`balance-bar ${balanceMsg ? "is-unbalanced" : v.balance.debit > 0 ? "is-balanced" : ""}`} role="status" aria-live="polite">
              <span>
                Tartozik <strong>{formatHuf(v.balance.debit)}</strong>
              </span>
              <span>
                Követel <strong>{formatHuf(v.balance.credit)}</strong>
              </span>
              {balanceMsg ? (
                <strong className="balance-diff">
                  <span aria-hidden="true">✗ </span>
                  {balanceMsg}
                </strong>
              ) : v.balance.debit > 0 ? (
                <strong className="balance-ok">
                  <span aria-hidden="true">✓ </span>A tartozik és követel oldal egyezik.
                </strong>
              ) : null}
            </div>
          </div>
        </section>

        <div className="form-actions">
          <Tooltip content="Előnézet, majd könyvelés – Ctrl+Enter">
            <button type="submit" className="btn btn-primary" aria-keyshortcuts="Control+Enter" disabled={busy || !ws.can("ledger:post")}>
              Előnézet és könyvelés
            </button>
          </Tooltip>
          <button type="button" className="btn" disabled={busy || !ws.can("ledger:post")} onClick={saveDraft}>
            Mentés piszkozatként
          </button>
          {draftId && (
            <ConfirmDialog
              trigger={
                <button type="button" className="btn btn-danger">
                  Piszkozat törlése
                </button>
              }
              title="Piszkozat törlése"
              description={<p>A piszkozat véglegesen törlődik. Könyvelt bizonylatot nem érint; a törlés az audit naplóba kerül.</p>}
              confirmLabel="Törlés"
              onConfirm={async () => {
                try {
                  await del(`/api/companies/${companyId}/documents/${draftId}`);
                  initialJson.current = JSON.stringify(state);
                  await invalidate();
                  toast("success", "A piszkozat törölve.");
                  navigate("/konyveles");
                } catch (err) {
                  toast("error", err instanceof Error ? err.message : "Váratlan hiba történt.");
                }
              }}
            />
          )}
        </div>
      </form>

      <PreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        data={previewData}
        accounts={accounts}
        busy={busy}
        error={null}
        onConfirm={confirmPost}
      />
      <TemplateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        templates={templates}
        accounts={accounts}
        onApply={(t, amount, kind, rate) => {
          update((s) => withTemplate(s, t, amount, kind, rate));
          toast("success", `Sablon alkalmazva: ${t.name}`);
        }}
      />
    </>
  );
}

