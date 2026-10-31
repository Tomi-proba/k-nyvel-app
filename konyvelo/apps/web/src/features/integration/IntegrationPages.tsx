import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { formatDateHu, formatHuf } from "@konyvelo/domain";
import {
  APPROVAL_KIND_LABELS,
  INTEGRATION_ACCOUNT_KEYS,
  INTEGRATION_ACCOUNT_LABELS,
  POSTING_MODE_LABELS,
  POSTING_MODES,
  PURCHASE_DATE_RULE_LABELS,
  PURCHASE_DATE_RULES,
  RECONCILIATION_STATUS_LABELS,
  type ApprovalGroupDto,
  type ApprovalItemDto,
  type ApprovalResultDto,
  type DocumentIntegrationDto,
  type IntegrationSettingsInput,
  type IntegrationStatusDto,
  type PostingMode,
  type PurchaseDateRule,
  type ReconciliationDto,
  type ReconciliationResultDto,
  type ReconciliationStatus,
} from "@konyvelo/shared";
import { useWorkspace } from "../../app/workspace";
import { ApiError, get, post, put } from "../../lib/api";
import { formatDateTimeHu } from "../../lib/format";
import { AccountPicker } from "../../ui/AccountPicker";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Field } from "../../ui/Field";
import { ErrorBox, Loading, PageHeader } from "../../ui/Page";
import { useToast } from "../../ui/Toasts";
import { HelpTip } from "../../ui/Tooltip";
import { useAccounts } from "../accounts/useAccounts";
import { documentsKey, useInvalidateDocuments } from "../documents/queries";

/** Integráció a többi modullal (I2, TERV.md F14). */

export const integrationKey = (companyId: string | undefined) => ["integration", companyId] as const;

export function useIntegrationStatus() {
  const ws = useWorkspace();
  const companyId = ws.company?.id;
  return useQuery({
    queryKey: integrationKey(companyId),
    queryFn: () => get<IntegrationStatusDto>(`/api/companies/${companyId}/integration`),
    enabled: Boolean(companyId),
  });
}

// ---------- Beállítások → Integráció ----------

export function IntegrationSettingsPage() {
  const ws = useWorkspace();
  const toast = useToast();
  const queryClient = useQueryClient();
  const q = useIntegrationStatus();
  const accounts = useAccounts();
  const companyId = ws.company?.id;
  const canEdit = ws.can("company:update");
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [form, setForm] = useState<IntegrationSettingsInput | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (q.data) setForm({ postingMode: q.data.postingMode, purchaseDateRule: q.data.purchaseDateRule, accounts: { ...q.data.accounts } });
  }, [q.data]);

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: integrationKey(companyId) }), queryClient.invalidateQueries({ queryKey: ["todos"] })]);
  const newCode = useMutation({
    mutationFn: () => post<{ code: string; expiresAt: string }>(`/api/companies/${companyId}/integration/link-code`),
    onSuccess: async (c) => {
      setCode(c);
      await refresh();
    },
    onError: (e) => toast("error", e.message),
  });
  const save = useMutation({
    mutationFn: () => put(`/api/companies/${companyId}/integration/settings`, form),
    onSuccess: async () => {
      setErrors({});
      await refresh();
      toast("success", "Az integrációs beállítások mentve.");
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fields);
      toast("error", e.message);
    },
  });

  if (q.isLoading || !form) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const s = q.data!;

  return (
    <>
      <PageHeader
        title="Integráció"
        description="A Könyvelő a cég többi programjával (Készletfigyelő, eÁFA) az integrációs központon keresztül kapcsolódik. Kapcsolat nélkül is teljes értékűen működik."
      />
      {!s.hubConfigured && (
        <div className="alert alert-info">
          Az integrációs központ ezen a telepítésen nincs beállítva. Az üzemeltető tudja bekapcsolni (KOZPONT_URL és KOZPONT_TITOK; lásd ELESITES.md).
        </div>
      )}
      <section className="card stack" aria-labelledby="int-link">
        <h2 id="int-link">
          Összekapcsolás <HelpTip term="integracioKod" />
        </h2>
        {s.linked ? (
          <p>
            <span className="badge badge-success">Összekapcsolva</span> {s.linkedAt && `(${formatDateTimeHu(s.linkedAt)})`}
          </p>
        ) : (
          <>
            <ol className="stack">
              <li>Készítsen kapcsolódási kódot ezzel a gombbal. A kód egyszer használható, és 24 óra múlva lejár.</li>
              <li>Adja meg a kódot a közös felületen (amíg az nincs kész, az üzemeltetőnek) a cég összekapcsolásához.</li>
            </ol>
            <p className="muted">Az adószám önmagában soha nem elég az összekapcsoláshoz: a kód mindig kell.</p>
            {canEdit && s.hubConfigured && (
              <div className="row">
                <button type="button" className="btn btn-primary" disabled={newCode.isPending} onClick={() => newCode.mutate()}>
                  Kapcsolódási kód készítése
                </button>
              </div>
            )}
            {code && (
              <div className="alert alert-success" role="status">
                Kapcsolódási kód: <strong className="mono">{code.code}</strong> (érvényes: {formatDateTimeHu(code.expiresAt)}). Most másolja ki: később nem lehet újra
                megjeleníteni, csak újat készíteni.
              </div>
            )}
            {!code && s.activeCodeExpiresAt && <p className="muted">Van érvényes, még fel nem használt kód ({formatDateTimeHu(s.activeCodeExpiresAt)}-ig).</p>}
          </>
        )}
        {s.outbox.waiting > 0 && (
          <p className={s.outbox.lastError ? "alert alert-warning" : "muted"}>
            {s.outbox.waiting} esemény vár átadásra{s.outbox.oldest ? ` (a legrégebbi: ${formatDateTimeHu(s.outbox.oldest)})` : ""}.
            {s.outbox.lastError && ` Utolsó hiba: ${s.outbox.lastError}`} Az események nem vesznek el.
          </p>
        )}
      </section>

      {s.linked && (
        <form
          className="card stack"
          aria-labelledby="int-settings"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <h2 id="int-settings">Beérkező tételek</h2>
          <fieldset className="stack">
            <legend>Könyvelés módja</legend>
            {POSTING_MODES.map((m) => (
              <label key={m} className="row">
                <input type="radio" name="postingMode" value={m} checked={form.postingMode === m} disabled={!canEdit} onChange={() => setForm({ ...form, postingMode: m as PostingMode })} />
                {POSTING_MODE_LABELS[m]}
              </label>
            ))}
            {s.draftOnlyUntil && form.postingMode === "DRAFT_ONLY" && (
              <p className="muted small">
                Bevezető hónap: {formatDateHu(s.draftOnlyUntil)}-ig javasolt. Utána a program emlékeztet, de magától nem kapcsol át.
              </p>
            )}
            <p className="muted small">Az ELÁBÉ-tétel mindig piszkozat, és csak ember hagyhatja jóvá, a beállítástól függetlenül.</p>
          </fieldset>
          <Field label="Készlet-beszerzés könyvelési dátuma" hint="Amíg könyvelő meg nem erősíti, a jóváhagyó választ (mindkét dátum fel van kínálva).">
            {(p) => (
              <select {...p} value={form.purchaseDateRule} disabled={!canEdit} onChange={(e) => setForm({ ...form, purchaseDateRule: e.target.value as PurchaseDateRule })}>
                {PURCHASE_DATE_RULES.map((r) => (
                  <option key={r} value={r}>
                    {PURCHASE_DATE_RULE_LABELS[r]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <h3>Számla-hozzárendelés</h3>
          <p className="muted small">Ezekre a számlákra kerülnek a Készletből jött tételek. Ha egy hiányzik, a tétel piszkozat lesz, Teendővel.</p>
          <div className="grid-2">
            {INTEGRATION_ACCOUNT_KEYS.map((k) => (
              <Field key={k} label={`${INTEGRATION_ACCOUNT_LABELS[k].label} (${INTEGRATION_ACCOUNT_LABELS[k].number})`} error={errors[`accounts.${k}`]}>
                {(p) => (
                  <AccountPicker
                    accounts={accounts.data ?? []}
                    value={form.accounts[k]}
                    controlProps={p}
                    onChange={(id) => setForm({ ...form, accounts: { ...form.accounts, [k]: id } })}
                  />
                )}
              </Field>
            ))}
          </div>
          {canEdit && (
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={save.isPending}>
                Mentés
              </button>
              <ConfirmDialog
                trigger={
                  <button type="button" className="btn btn-danger">
                    Összekapcsolás bontása
                  </button>
                }
                title="Összekapcsolás bontása"
                description={
                  <p>
                    A Könyvelő ezután nem küld és nem fogad eseményt. A már létrejött bizonylatok megmaradnak. Újra összekapcsolni új kóddal lehet.
                  </p>
                }
                confirmLabel="Bontás"
                onConfirm={async () => {
                  try {
                    await post(`/api/companies/${companyId}/integration/unlink`);
                    await refresh();
                    toast("success", "Az összekapcsolás bontva.");
                  } catch (e) {
                    toast("error", e instanceof Error ? e.message : "Váratlan hiba történt.");
                  }
                }}
              />
            </div>
          )}
        </form>
      )}
      {s.linked && companyId && <ReconciliationCard companyId={companyId} />}
    </>
  );
}

// ---------- Egyeztetés (TERV.md F16) ----------

const reconciliationKey = (companyId: string) => ["integration", companyId, "reconciliation"] as const;

const STATUS_BADGE: Record<ReconciliationStatus, string> = {
  RENDBEN: "badge-success",
  FUGGO: "",
  REGOTA_FUGG: "badge-warning",
  ELTERES: "badge-danger",
  NYITO_ELFOGADASRA_VAR: "badge-warning",
  NEM_FUTOTT: "badge-warning",
};

/**
 * A központ egyeztetésének legutóbbi eredménye: ellenőrzésenként állapot, magyarázat és az érintett tételek.
 * „Ellenőrzés most”, és a nyitó különbség elfogadása (adminisztrátor, vezető könyvelő; indoklással).
 */
function ReconciliationCard({ companyId }: { companyId: string }) {
  const ws = useWorkspace();
  const toast = useToast();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: reconciliationKey(companyId), queryFn: () => get<ReconciliationDto>(`/api/companies/${companyId}/integration/reconciliation`) });
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: reconciliationKey(companyId) }), queryClient.invalidateQueries({ queryKey: ["todos"] })]);
  const run = useMutation({
    mutationFn: () => post(`/api/companies/${companyId}/integration/reconciliation/run`),
    onSuccess: async () => {
      await refresh();
      toast("success", "Az egyeztetés lefutott.");
    },
    onError: (e) => toast("error", e.message),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { report, canAcceptBaseline, hubConfigured } = q.data!;
  return (
    <section className="card stack" id="egyeztetes" aria-labelledby="int-reconcile">
      <h2 id="int-reconcile">Egyeztetés a Készlettel</h2>
      <p className="muted small">
        Éjszakánként (és kérésre) a központ összeveti a két program számait: a készletértéket a készletszámlával, az ELÁBÉ-t, a párosított tételek összegét, a
        kifizetettséget, az átadásokat és a kapcsolatokat. Az eltérést kimutatja és megmagyarázza; a könyvelést magától soha nem javítja.
      </p>
      {!report ? (
        <p className="muted">Még nem volt egyeztetés.</p>
      ) : (
        <>
          <p className="muted small">
            Legutóbbi ellenőrzés: {formatDateTimeHu(report.at)} · készletérték napja: {formatDateHu(report.asOf)} · ELÁBÉ-időszak: {formatDateHu(report.from)} – {formatDateHu(report.to)}
          </p>
          <ul className="reconcile-list">
            {report.results.map((r) => (
              <li key={r.check} className="reconcile-item">
                <details open={r.status !== "RENDBEN"}>
                  <summary>
                    <span className={`badge ${STATUS_BADGE[r.status]}`}>{RECONCILIATION_STATUS_LABELS[r.status]}</span>
                    <strong>{r.title}</strong>
                  </summary>
                  {r.detail && <p className="reconcile-detail small">{r.detail}</p>}
                  {r.items.length > 0 && (
                    <ul className="small">
                      {r.items.map((i, n) => (
                        <li key={n}>{i.documentId ? <Link to={`/konyveles/${i.documentId}`}>{i.label}</Link> : i.label}</li>
                      ))}
                    </ul>
                  )}
                  {r.check === "E1" && r.baselineProposal !== null && (
                    <BaselineForm companyId={companyId} runId={report.runId} result={r} canAccept={canAcceptBaseline} onDone={refresh} />
                  )}
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
      {hubConfigured && ws.can("ledger:post") && (
        <div className="row">
          <button type="button" className="btn" disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? "Ellenőrzés folyamatban…" : "Ellenőrzés most"}
          </button>
        </div>
      )}
    </section>
  );
}

/** A nyitó (kiinduló) különbség elfogadása: pontosan a javasolt összeg, indoklással; a központ naplózza. */
function BaselineForm({ companyId, runId, result, canAccept, onDone }: { companyId: string; runId: string; result: ReconciliationResultDto; canAccept: boolean; onDone: () => Promise<unknown> }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const amount = result.baselineProposal!;
  if (!canAccept) {
    return <p className="muted small">A kiinduló különbséget az adminisztrátor vagy a vezető könyvelő fogadhatja el, indoklással.</p>;
  }
  return (
    <div className="stack">
      <Field label="Indoklás" hint="Miért rendben ez a különbség? (pl. nyitó készlet az összekapcsolás előttről, a leltár szerint)" error={error}>
        {(p) => <textarea {...p} rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <div className="row">
        <ConfirmDialog
          trigger={
            <button type="button" className="btn btn-primary" disabled={reason.trim().length < 10}>
              Elfogadom kiinduló különbségnek: {formatHuf(amount)}
            </button>
          }
          title="Nyitó különbség elfogadása"
          description={
            <p>
              A készletérték és a készletszámla közti {formatHuf(amount)} különbséget kiinduló különbségnek fogadja el. Ezután az egyeztetés csak a változást figyeli. Az
              elfogadás a nevével és az indoklással naplózva lesz; később csak újabb indoklással módosítható.
            </p>
          }
          confirmLabel="Elfogadom"
          danger={false}
          onConfirm={async () => {
            try {
              await post(`/api/companies/${companyId}/integration/reconciliation/baseline`, { runId, amount, reason: reason.trim() });
              setError(undefined);
              setReason("");
              await onDone();
              toast("success", "A nyitó különbség elfogadva.");
            } catch (e) {
              if (e instanceof ApiError) setError(e.fields.reason);
              toast("error", e instanceof Error ? e.message : "Váratlan hiba történt.");
            }
          }}
        />
      </div>
    </div>
  );
}

// ---------- Csoportos jóváhagyás (F14.8) ----------

export function ApprovalsPage() {
  const ws = useWorkspace();
  const toast = useToast();
  const invalidate = useInvalidateDocuments();
  const queryClient = useQueryClient();
  const companyId = ws.company?.id;
  const q = useQuery({
    queryKey: [...documentsKey(companyId), "approvals"],
    queryFn: () => get<ApprovalGroupDto[]>(`/api/companies/${companyId}/integration/approvals`),
    enabled: Boolean(companyId) && ws.can("ledger:post"),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [purchaseDate, setPurchaseDate] = useState<"" | "RECEIVED" | "INVOICE">("");
  const [result, setResult] = useState<ApprovalResultDto | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [batchId, setBatchId] = useState(() => crypto.randomUUID());

  const items = useMemo(() => (q.data ?? []).flatMap((g) => g.items), [q.data]);
  const chosen = items.filter((i) => selected.has(i.documentId) && i.complete);
  const needsDate = chosen.some((i) => i.dateChoice);
  const approve = useMutation({
    mutationFn: () => post<ApprovalResultDto>(`/api/companies/${companyId}/integration/approvals`, { batchId, documentIds: chosen.map((i) => i.documentId), ...(purchaseDate ? { purchaseDate } : {}) }),
    onSuccess: async (r) => {
      setResult(r);
      setSelected(new Set());
      setConfirmOpen(false);
      setBatchId(crypto.randomUUID());
      await Promise.all([invalidate(), queryClient.invalidateQueries({ queryKey: ["todos"] })]);
      const ok = r.results.filter((x) => x.ok).length;
      toast(ok === r.results.length ? "success" : "error", `${ok} tétel könyvelve${ok < r.results.length ? `, ${r.results.length - ok} nem` : ""}.`);
    },
    onError: (e) => toast("error", e.message),
  });

  if (!ws.can("ledger:post")) return <div className="alert alert-info">A jóváhagyáshoz könyvelési jog kell.</div>;
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const groups = q.data!;

  // Számlánkénti összesítés a megerősítéshez.
  const byAccount = new Map<string, { debit: number; credit: number }>();
  for (const i of chosen) {
    for (const l of i.lines) {
      const k = l.accountNumber ?? "?";
      const v = byAccount.get(k) ?? { debit: 0, credit: 0 };
      if (l.side === "D") v.debit += l.amount;
      if (l.side === "C") v.credit += l.amount;
      byAccount.set(k, v);
    }
  }
  // Több tétel egyszerre (a csoport összes hiánytalan tétele): egy lépésben, a legfrissebb állapotból.
  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  return (
    <>
      <PageHeader
        title="Jóváhagyás: a Készletből érkezett tételek"
        description="Napra és fajtára csoportosítva. Csak a hiánytalan tételek jelölhetők ki; a könyvelés mindig az Ön kattintására történik, és az Ön nevével kerül az audit naplóba."
      />
      <p>
        <Link to="/">← Vissza a Kezdőlapra</Link>
      </p>
      {result && (
        <section className="card" aria-labelledby="eredmeny">
          <h2 id="eredmeny">Az utolsó jóváhagyás eredménye</h2>
          <ul className="plain-list stack">
            {result.results.map((r) => (
              <li key={r.documentId}>
                {r.ok ? <span className="badge badge-success">Könyvelve</span> : <span className="badge badge-warning">Nem könyvelve</span>}{" "}
                <Link to={`/konyveles/${r.documentId}`}>{r.serialNumber ?? "bizonylat"}</Link> {r.message && <span className="muted">– {r.message}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {groups.length === 0 && <p className="muted">Nincs jóváhagyásra váró tétel.</p>}
      {groups.map((g) => (
        <ApprovalGroup key={`${g.kind}-${g.date}`} group={g} selected={selected} onToggle={toggle} />
      ))}
      {groups.length > 0 && (
        <div className="form-actions">
          {needsDate && (
            <Field label="Könyvelés dátuma a kijelölt beszerzéseknél" required hint="Ahol a bevételezés és a számla dátuma eltér, Önnek kell választania.">
              {(p) => (
                <select {...p} value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value as typeof purchaseDate)}>
                  <option value="">Válasszon…</option>
                  <option value="RECEIVED">A bevételezés dátuma</option>
                  <option value="INVOICE">A szállítói számla dátuma</option>
                </select>
              )}
            </Field>
          )}
          <AlertDialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialog.Trigger asChild>
              <button type="button" className="btn btn-primary" disabled={chosen.length === 0 || (needsDate && !purchaseDate)}>
                A kijelölt {chosen.length} tétel könyvelése
              </button>
            </AlertDialog.Trigger>
            <AlertDialog.Portal>
              <AlertDialog.Overlay className="dialog-overlay" />
              <AlertDialog.Content className="dialog dialog-wide">
                <AlertDialog.Title asChild>
                  <h2>{chosen.length} tétel könyvelése</h2>
                </AlertDialog.Title>
                <AlertDialog.Description asChild>
                  <div className="stack">
                    <p>
                      Összesen <strong>{formatHuf(chosen.reduce((s, i) => s + i.total, 0))}</strong>. A tételek az Ön nevével, egyenként könyvelődnek; ha egy közben
                      hibássá vált, az kimarad, a többi könyvelődik.
                    </p>
                    <div className="table-wrap">
                      <table>
                        <caption>Számlánkénti összesítés</caption>
                        <thead>
                          <tr>
                            <th scope="col">Számla</th>
                            <th scope="col" className="num">
                              Tartozik
                            </th>
                            <th scope="col" className="num">
                              Követel
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...byAccount].map(([k, v]) => (
                            <tr key={k}>
                              <td className="mono">{k}</td>
                              <td className="num">{v.debit ? formatHuf(v.debit) : ""}</td>
                              <td className="num">{v.credit ? formatHuf(v.credit) : ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </AlertDialog.Description>
                <div className="dialog-actions">
                  <AlertDialog.Cancel asChild>
                    <button type="button" className="btn">
                      Mégse
                    </button>
                  </AlertDialog.Cancel>
                  <button type="button" className="btn btn-primary" disabled={approve.isPending} onClick={() => approve.mutate()}>
                    Könyvelés
                  </button>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          </AlertDialog.Root>
        </div>
      )}
    </>
  );
}

function ApprovalGroup({ group, selected, onToggle }: { group: ApprovalGroupDto; selected: Set<string>; onToggle: (ids: string[], on: boolean) => void }) {
  const id = `csoport-${group.kind}-${group.date}`;
  const complete = group.items.filter((i) => i.complete);
  const allOn = complete.length > 0 && complete.every((i) => selected.has(i.documentId));
  return (
    <section className="card" aria-labelledby={id}>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <h2 id={id} style={{ margin: 0 }}>
          {APPROVAL_KIND_LABELS[group.kind]} – {formatDateHu(group.date)}
        </h2>
        <span className="muted">
          {group.items.length} tétel, ebből {group.completeCount} hiánytalan · {formatHuf(group.total)}
        </span>
      </div>
      {complete.length > 0 && (
        <label className="row">
          <input type="checkbox" checked={allOn} onChange={(e) => onToggle(complete.map((i) => i.documentId), e.target.checked)} />A csoport összes hiánytalan
          tételének kijelölése
        </label>
      )}
      <div className="table-wrap">
        <table>
          <caption className="sr-only">
            {APPROVAL_KIND_LABELS[group.kind]} tételei, {formatDateHu(group.date)}
          </caption>
          <thead>
            <tr>
              <th scope="col">Kijelölés</th>
              <th scope="col">Partner / leírás</th>
              <th scope="col">Kontírozás</th>
              <th scope="col" className="num">
                Összeg
              </th>
              <th scope="col">Állapot</th>
            </tr>
          </thead>
          <tbody>
            {group.items.map((i) => (
              <ApprovalRow key={i.documentId} item={i} checked={selected.has(i.documentId)} onToggle={onToggle} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ApprovalRow({ item, checked, onToggle }: { item: ApprovalItemDto; checked: boolean; onToggle: (ids: string[], on: boolean) => void }) {
  const label = `${item.partnerName ?? item.description ?? "Tétel"}${item.externalNumber ? ` (${item.externalNumber})` : ""}`;
  return (
    <tr>
      <td>
        <input type="checkbox" aria-label={`Kijelölés: ${label}`} checked={checked} disabled={!item.complete} onChange={(e) => onToggle([item.documentId], e.target.checked)} />
      </td>
      <td>
        <Link to={`/konyveles/${item.documentId}`}>{label}</Link>
        {item.partnerName && item.description && <div className="muted small">{item.description}</div>}
      </td>
      <td className="small">
        {item.lines.map((l, n) => (
          <div key={n}>
            <span className="mono">{l.accountNumber ?? "?"}</span> {l.side === "D" ? "T" : "K"} {formatHuf(l.amount)}
          </div>
        ))}
      </td>
      <td className="num">{formatHuf(item.total)}</td>
      <td>
        {item.complete ? (
          <span className="badge badge-success">Hiánytalan</span>
        ) : (
          <>
            <span className="badge badge-warning">Hiányos</span>
            <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {item.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </>
        )}
        {item.dateChoice && (
          <div className="muted small">
            Dátumválasztás: bevételezés {item.dateChoice.receivedDate ? formatDateHu(item.dateChoice.receivedDate) : "–"} / számla{" "}
            {item.dateChoice.invoiceDate ? formatDateHu(item.dateChoice.invoiceDate) : "–"}
          </div>
        )}
      </td>
    </tr>
  );
}

// ---------- A bizonylat oldalán: honnan jött, mi lett belőle ----------

export function DocumentIntegrationPanel({ documentId, posted }: { documentId: string; posted: boolean }) {
  const ws = useWorkspace();
  const toast = useToast();
  const invalidate = useInvalidateDocuments();
  const queryClient = useQueryClient();
  const companyId = ws.company?.id;
  const key = [...documentsKey(companyId), "integration", documentId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => get<DocumentIntegrationDto>(`/api/companies/${companyId}/documents/${documentId}/integration`),
    enabled: Boolean(companyId),
  });
  const refresh = async () => {
    await Promise.all([invalidate(), queryClient.invalidateQueries({ queryKey: key }), queryClient.invalidateQueries({ queryKey: ["todos"] })]);
  };
  if (!q.data) return null;
  const d = q.data;
  if (!d.sources.length && !d.targets?.length && !d.reversal && !(posted && d.stockLines.length)) return null;
  const canPost = ws.can("ledger:post");

  return (
    <section className="card stack" aria-labelledby={`int-${documentId}`}>
      <h2 id={`int-${documentId}`}>
        Kapcsolat a többi programmal <HelpTip term="integracio" />
      </h2>
      {d.sources.map((s, i) => (
        <p key={i}>
          Honnan jött: a(z) <strong>{s.moduleLabel}</strong> {s.label ? `„${s.label}”` : "tételéből"}{" "}
          {s.url ? (
            <a href={s.url} target="_blank" rel="noreferrer">
              (megnyitás a(z) {s.moduleLabel} programban)
            </a>
          ) : null}
          <span className="muted small"> · {formatDateTimeHu(s.at)}</span>
        </p>
      ))}
      {d.isCogs && !posted && (
        <div className="alert alert-info">ELÁBÉ-tétel: a Készlet költségszámítása szerint. Csak ember hagyhatja jóvá, a szokásos előnézettel.</div>
      )}
      {d.dateChoice && canPost && (
        <div className="alert alert-warning stack" role="group" aria-label="A könyvelés dátumának választása">
          <p style={{ margin: 0 }}>Válassza ki a könyvelés dátumát (a program nem választ Ön helyett):</p>
          <div className="row">
            {(["RECEIVED", "INVOICE"] as const).map((c) => {
              const date = c === "RECEIVED" ? d.dateChoice!.receivedDate : d.dateChoice!.invoiceDate;
              return (
                <button
                  key={c}
                  type="button"
                  className="btn"
                  disabled={!date}
                  onClick={async () => {
                    try {
                      await post(`/api/companies/${companyId}/documents/${documentId}/integration/date`, { choice: c });
                      await refresh();
                      toast("success", "A könyvelés dátuma beállítva.");
                    } catch (e) {
                      toast("error", e instanceof Error ? e.message : "Váratlan hiba történt.");
                    }
                  }}
                >
                  {c === "RECEIVED" ? "Bevételezés" : "Számla"}: {date ? formatDateHu(date) : "nincs"}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {d.reversal && posted && canPost && (
        <div className="alert alert-warning stack">
          <p style={{ margin: 0 }}>
            A forrást visszavonták{d.reversal.reason ? ` (${d.reversal.reason})` : ""}. Sztornó javasolt {formatDateHu(d.reversal.date)}-i dátummal.
          </p>
          <ConfirmDialog
            trigger={
              <button type="button" className="btn btn-danger">
                Sztornózás {formatDateHu(d.reversal.date)}-i dátummal
              </button>
            }
            title="Sztornó a forrás visszavonása miatt"
            description={<p>A rendszer azonnal könyvelt sztornó bizonylatot készít. Ha a dátum lezárt időszakba esik, a sztornó nem készül el; akkor a Sztornózás gombbal válasszon másik dátumot.</p>}
            confirmLabel="Sztornózás"
            onConfirm={async () => {
              try {
                await post(`/api/companies/${companyId}/documents/${documentId}/integration/reverse`, {});
                await refresh();
                toast("success", "A bizonylat sztornózva.");
              } catch (e) {
                toast("error", e instanceof Error ? e.message : "Váratlan hiba történt.");
              }
            }}
          />
        </div>
      )}
      {d.targets && d.targets.length > 0 && (
        <ul className="plain-list">
          {d.targets.map((t, i) => (
            <li key={i}>
              Mi lett belőle: <strong>{t.moduleLabel}</strong> – {t.url ? <a href={t.url} target="_blank" rel="noreferrer">{t.label ?? "megnyitás"}</a> : (t.label ?? "tétel")}
            </li>
          ))}
        </ul>
      )}
      {posted && d.stockLines.length > 0 && (
        <div className="table-wrap">
          <table>
            <caption>Termékek</caption>
            <thead>
              <tr>
                <th scope="col">Termék</th>
                <th scope="col" className="num">
                  Mennyiség
                </th>
                <th scope="col" className="num">
                  Nettó
                </th>
                <th scope="col" className="num">
                  Áfa
                </th>
              </tr>
            </thead>
            <tbody>
              {d.stockLines.map((s, i) => (
                <tr key={i}>
                  <td>{s.productName}</td>
                  <td className="num">
                    {String(s.quantity).replace(".", ",")} {s.unit ?? ""}
                  </td>
                  <td className="num">{formatHuf(s.netAmount)}</td>
                  <td className="num">
                    {formatHuf(s.vatAmount)}
                    {s.vatRate !== null && <span className="muted small"> ({s.vatRate}%)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------- Termékkérdés a rögzítéskor (KK3) ----------

type ProductDto = { productId: string; name: string; sku: string | null; unit: string | null; vatRate: number | null };
type StockRow = { productId: string; quantity: string; net: string; vatRate: number | null; vat: string; confirmVatDifference: boolean };

const toFiller = (s: string) => Math.round(Number(s.replace(/\s/g, "").replace(",", ".")) * 100);

/**
 * „Melyik termék, mennyi?” (KK3): ha a cég Készlete össze van kapcsolva (vannak ismert termékei), a vevő-
 * és szállítói számla piszkozatán megadható; a könyveléskor a termékek az eseménnyel mennek a Készletnek.
 */
export function StockLinesEditor({ documentId, docType }: { documentId: string; docType: string }) {
  const ws = useWorkspace();
  const toast = useToast();
  const queryClient = useQueryClient();
  const companyId = ws.company?.id;
  const [search, setSearch] = useState("");
  const products = useQuery({
    queryKey: [...integrationKey(companyId), "products", search],
    queryFn: () => get<ProductDto[]>(`/api/companies/${companyId}/integration/products${search ? `?q=${encodeURIComponent(search)}` : ""}`),
    enabled: Boolean(companyId),
  });
  const infoKey = [...documentsKey(companyId), "integration", documentId];
  const info = useQuery({ queryKey: infoKey, queryFn: () => get<DocumentIntegrationDto>(`/api/companies/${companyId}/documents/${documentId}/integration`), enabled: Boolean(companyId) });
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (info.data && rows === null) {
      setRows(
        info.data.stockLines.map((l) => ({
          productId: l.productId,
          quantity: String(l.quantity).replace(".", ","),
          net: (l.netAmount / 100).toFixed(2).replace(".", ","),
          vatRate: l.vatRate,
          vat: (l.vatAmount / 100).toFixed(2).replace(".", ","),
          confirmVatDifference: false,
        })),
      );
    }
  }, [info.data, rows]);

  if (!["SZSZ", "VSZ", "HELY"].includes(docType) || !ws.can("ledger:post")) return null;
  // Ha a cégnek nincs Készlete (nincs ismert terméke), nincs mit kérdezni.
  if (!search && (products.data?.length ?? 0) === 0 && (info.data?.stockLines.length ?? 0) === 0) return null;
  if (!rows) return null;
  const byId = new Map((products.data ?? []).map((p) => [p.productId, p]));

  const save = async () => {
    try {
      await put(`/api/companies/${companyId}/documents/${documentId}/integration/stock-lines`, {
        lines: rows.map((r) => ({ productId: r.productId, quantity: Number(r.quantity.replace(",", ".")), netAmount: toFiller(r.net), vatRate: r.vatRate, vatAmount: toFiller(r.vat), confirmVatDifference: r.confirmVatDifference })),
      });
      setErrors({});
      await queryClient.invalidateQueries({ queryKey: infoKey });
      toast("success", "A termékek mentve.");
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields);
      toast("error", e instanceof Error ? e.message : "Váratlan hiba történt.");
    }
  };
  const set = (i: number, patch: Partial<StockRow>) => setRows(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  return (
    <section className="card stack" aria-labelledby={`termekek-${documentId}`}>
      <h2 id={`termekek-${documentId}`}>Melyik termék, mennyi? (Készlet)</h2>
      <p className="muted small">Nem kötelező. Ha megadja, a könyveléskor a Készlet ebből rögzíti a mozgást; ha nem, a Készletben kérdés lesz róla.</p>
      <Field label="Termék keresése" hint="Név vagy cikkszám szerint.">
        {(p) => <input {...p} type="search" value={search} onChange={(e) => setSearch(e.target.value)} />}
      </Field>
      {rows.map((r, i) => {
        const product = byId.get(r.productId);
        return (
          <div key={i} className="form-row">
            <Field label={`${i + 1}. termék`} error={errors[`lines.${i}.productId`]}>
              {(p) => (
                <select
                  {...p}
                  value={r.productId}
                  onChange={(e) => {
                    const np = byId.get(e.target.value);
                    set(i, { productId: e.target.value, vatRate: np?.vatRate ?? null });
                  }}
                >
                  <option value="">Válasszon…</option>
                  {(products.data ?? []).map((pr) => (
                    <option key={pr.productId} value={pr.productId}>
                      {pr.name}
                      {pr.sku ? ` (${pr.sku})` : ""}
                    </option>
                  ))}
                  {r.productId && !product && <option value={r.productId}>{info.data?.stockLines.find((l) => l.productId === r.productId)?.productName ?? r.productId}</option>}
                </select>
              )}
            </Field>
            <Field label="Mennyiség">{(p) => <input {...p} inputMode="decimal" value={r.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />}</Field>
            <Field label="Nettó (Ft)">{(p) => <input {...p} inputMode="decimal" value={r.net} onChange={(e) => set(i, { net: e.target.value })} />}</Field>
            <Field label="Áfakulcs (%)" error={errors[`lines.${i}.vatRate`]}>
              {(p) => <input {...p} inputMode="decimal" value={r.vatRate ?? ""} onChange={(e) => set(i, { vatRate: e.target.value === "" ? null : Number(e.target.value), confirmVatDifference: false })} />}
            </Field>
            <Field label="Áfa (Ft)">{(p) => <input {...p} inputMode="decimal" value={r.vat} onChange={(e) => set(i, { vat: e.target.value })} />}</Field>
            {product && product.vatRate !== null && r.vatRate !== null && product.vatRate !== r.vatRate && (
              <label className="row small">
                <input type="checkbox" checked={r.confirmVatDifference} onChange={(e) => set(i, { confirmVatDifference: e.target.checked })} />
                Szándékosan tér el a termék áfakulcsától ({product.vatRate}%)
              </label>
            )}
            <button type="button" className="btn btn-small" aria-label={`${i + 1}. termék törlése`} onClick={() => setRows(rows.filter((_, n) => n !== i))}>
              Törlés
            </button>
          </div>
        );
      })}
      <div className="row">
        <button type="button" className="btn btn-small" onClick={() => setRows([...rows, { productId: "", quantity: "1", net: "0", vatRate: null, vat: "0", confirmVatDifference: false }])}>
          + Termék
        </button>
        <button type="button" className="btn btn-primary btn-small" onClick={save}>
          Termékek mentése
        </button>
      </div>
    </section>
  );
}
