import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { formatHuf, NAV_DIRECTION_LABELS, NAV_OPERATION_LABELS, todayIso, addDays, type NavDirection } from "@konyvelo/domain";
import {
  NAV_INVOICE_STATE_LABELS,
  type NavConnectionDto,
  type NavImportRunDto,
  type NavInvoiceDetailDto,
  type NavInvoiceListItemDto,
  type NavInvoiceState,
} from "@konyvelo/shared";
import { useWorkspace } from "../../app/workspace";
import { ApiError, del, get, post } from "../../lib/api";
import { formatDateHu, formatDateTimeHu } from "../../lib/format";
import { AccountPicker } from "../../ui/AccountPicker";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { DateInput } from "../../ui/DateInput";
import { ErrorSummary, Field } from "../../ui/Field";
import { ErrorBox, Loading, PageHeader } from "../../ui/Page";
import { PartnerPicker } from "../../ui/PartnerPicker";
import { useToast } from "../../ui/Toasts";
import { HelpTip } from "../../ui/Tooltip";
import { useAccounts } from "../accounts/useAccounts";
import { useTemplates } from "../documents/queries";
import { usePartners } from "../partners/usePartners";
import { LEDGER_TABS } from "../subledger/MoneyPage";
import { SubNav } from "../subledger/SubledgerPages";

/**
 * NAV Online Számla import (7. lépés). A NAV-ot az eÁFA kérdezi le a cég NAV-kapcsolatával; a
 * Könyvelőben nincs NAV-titok. A NAV-adat könyvelési javaslat: bizonylat csak jóváhagyással lesz.
 */

const navKey = (companyId: string | undefined) => ["nav", companyId] as const;

export function useNavConnection() {
  const companyId = useWorkspace().company?.id;
  return useQuery({
    queryKey: [...navKey(companyId), "connection"],
    queryFn: () => get<NavConnectionDto>(`/api/companies/${companyId}/nav/connection`),
    enabled: Boolean(companyId),
  });
}

const REMOTE_TONE: Record<string, "success" | "warning" | "error"> = {
  OK: "success",
  NOT_TESTED: "warning",
  UNREACHABLE: "warning",
  BROKEN: "error",
  NOT_CONFIGURED: "error",
  REVOKED: "error",
};

const ENV_LABELS = { TEST: "NAV teszt", PRODUCTION: "NAV éles" } as const;

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : "Váratlan hiba történt.";
}

// ---------- Beállítások → NAV-kapcsolat ----------

export function NavConnectionPage() {
  const ws = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const q = useNavConnection();
  const [code, setCode] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const canEdit = ws.can("company:update");
  const companyId = ws.company?.id;

  const link = useMutation({
    mutationFn: () => post<NavConnectionDto>(`/api/companies/${companyId}/nav/connection`, { code }),
    onSuccess: async (data) => {
      setCode("");
      setError(null);
      queryClient.setQueryData([...navKey(companyId), "connection"], data);
      await queryClient.invalidateQueries({ queryKey: ["todos"] });
      toast("success", "Az összekapcsolás sikerült.");
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e : null);
      setAttempt((a) => a + 1);
    },
  });

  const c = q.data;
  return (
    <>
      <PageHeader
        title="NAV-kapcsolat"
        description="A NAV Online Számla adatait a cég eÁFA-beli NAV-kapcsolatán keresztül kérdezzük le. A Könyvelő nem tárol NAV-jelszót vagy -kulcsot."
      />
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {c && !c.available && (
        <div className="alert alert-info">
          A NAV-import ezen a telepítésen nincs bekapcsolva. Az üzemeltető tudja beállítani (az eÁFA NAV-átjárójának címe és a közös
          titok).
        </div>
      )}
      {c && c.available && !c.linked && (
        <section className="card stack" aria-labelledby="nav-link">
          <h2 id="nav-link">
            Összekapcsolás az eÁFA-val <HelpTip term="kapcsolodasiKod" />
          </h2>
          <ol className="stack">
            <li>
              A cég eÁFA-felületén: <strong>Ügyfél → Könyvelő-hozzáférés → Kapcsolódási kód készítése</strong> (ehhez a cégnek
              beállított NAV-kapcsolat kell; eÁFA-előfizetés nem).
            </li>
            <li>Írja be ide a kódot. A kód egyszer használható, és 24 órán belül lejár.</li>
          </ol>
          <p className="muted">A cég adószámát a program küldi az eÁFA-nak ellenőrzésre; az adószám önmagában soha nem elég az összekapcsoláshoz.</p>
          {canEdit ? (
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                link.mutate();
              }}
            >
              <ErrorSummary message={error?.message} fields={error?.fields} attempt={attempt} />
              <Field label="Kapcsolódási kód" error={error?.fields.code} hint="Például: ABCD-EFGH-JKMN-PQRS" required>
                {(p) => <input {...p} className="mono" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />}
              </Field>
              <div className="row">
                <button className="btn btn-primary" disabled={link.isPending || !code.trim()}>
                  Összekapcsolás
                </button>
              </div>
            </form>
          ) : (
            <p className="muted">Az összekapcsolást Adminisztrátor vagy Vezető könyvelő végezheti.</p>
          )}
        </section>
      )}
      {c && c.linked && <LinkedConnection connection={c} canEdit={canEdit} />}
    </>
  );
}

function LinkedConnection({ connection: c, canEdit }: { connection: NavConnectionDto; canEdit: boolean }) {
  const ws = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const companyId = ws.company?.id;
  return (
    <section className="card stack" aria-labelledby="nav-linked">
      <h2 id="nav-linked">Összekapcsolva</h2>
      <dl className="stack" style={{ margin: 0 }}>
        <div>
          <dt>Cég az eÁFA-ban</dt>
          <dd>
            {c.eafaTaxpayerName} ({c.eafaTaxNumber})
          </dd>
        </div>
        <div>
          <dt>Környezet</dt>
          <dd>{c.environment ? ENV_LABELS[c.environment] : "–"}</dd>
        </div>
        <div>
          <dt>Összekapcsolta</dt>
          <dd>
            {c.linkedByName ?? "–"}
            {c.linkedAt && `, ${formatDateTimeHu(c.linkedAt)}`}
          </dd>
        </div>
      </dl>
      {c.remote && (
        <div className={`alert alert-${REMOTE_TONE[c.remote.state] ?? "info"}`} role="status">
          <strong>{c.remote.state === "OK" ? "A cég NAV-kapcsolata működik." : c.remote.title}</strong>
          {c.remote.action && <div>{c.remote.action}</div>}
        </div>
      )}
      {c.navCallsEnabled === false && (
        <div className="alert alert-info">
          Az eÁFA-ban a NAV-hívások most ki vannak kapcsolva (főkapcsoló), ezért az import nem fordul a NAV-hoz. Bekapcsolni az eÁFA
          üzemeltetője tudja.
        </div>
      )}
      {c.environment === "PRODUCTION" && c.productionEnabled === false && (
        <div className="alert alert-info">Az éles NAV-kapcsolatot az eÁFA üzemeltetője még nem engedélyezte.</div>
      )}
      {canEdit && (
        <div className="row">
          <ConfirmDialog
            trigger={
              <button type="button" className="btn">
                Kapcsolat bontása
              </button>
            }
            title="Bontja a NAV-kapcsolatot?"
            description={
              <p>
                A bontás után a Könyvelő nem kérdezheti le a cég NAV-adatait. A már importált számlák és bizonylatok megmaradnak. Újra
                összekapcsolni egy új kapcsolódási kóddal lehet.
              </p>
            }
            confirmLabel="Bontás"
            onConfirm={async () => {
              const data = await del<NavConnectionDto>(`/api/companies/${companyId}/nav/connection`);
              queryClient.setQueryData([...navKey(companyId), "connection"], data);
              await queryClient.invalidateQueries({ queryKey: ["todos"] });
              toast("success", "A kapcsolatot bontottuk.");
            }}
          />
        </div>
      )}
    </section>
  );
}

// ---------- Könyvelés → NAV-import ----------

const STATE_FILTERS: Array<{ value: NavInvoiceState | ""; label: string }> = [
  { value: "NEW", label: "Jóváhagyásra vár" },
  { value: "DRAFT", label: "Piszkozat" },
  { value: "POSTED", label: "Könyvelve" },
  { value: "IGNORED", label: "Figyelmen kívül hagyva" },
  { value: "", label: "Mind" },
];

export function NavImportPage() {
  const ws = useWorkspace();
  const companyId = ws.company?.id;
  const connection = useNavConnection();
  const [params, setParams] = useSearchParams();
  const state = (params.get("allapot") ?? "NEW") as NavInvoiceState | "";

  const invoices = useQuery({
    queryKey: [...navKey(companyId), "invoices", state],
    queryFn: () => get<NavInvoiceListItemDto[]>(`/api/companies/${companyId}/nav/invoices${state ? `?state=${state}` : ""}`),
    enabled: Boolean(companyId && connection.data?.linked),
  });

  return (
    <>
      <SubNav label="Könyvelés almenü" items={LEDGER_TABS} />
      <PageHeader
        title="NAV-import"
        description="A NAV Online Számla rendszerébe beküldött számlák. A NAV-adat könyvelési javaslat: bizonylat csak az Ön jóváhagyásával lesz belőle."
      />
      {connection.isLoading && <Loading />}
      {connection.error && <ErrorBox error={connection.error} />}
      {connection.data && !connection.data.linked && (
        <div className="alert alert-info">
          A cég még nincs összekapcsolva az eÁFA NAV-kapcsolatával. <Link to="/beallitasok/nav-kapcsolat">Beállítások → NAV-kapcsolat</Link>
        </div>
      )}
      {connection.data?.linked && (
        <>
          {connection.data.remote && !["OK", "NOT_TESTED"].includes(connection.data.remote.state) && (
            <div className="alert alert-error" role="alert">
              <strong>{connection.data.remote.title}</strong> {connection.data.remote.action}
            </div>
          )}
          {ws.can("ledger:post") && <ImportForm />}
          <ImportRuns />
          <section className="card" aria-labelledby="nav-invoices">
            <h2 id="nav-invoices">Számlák</h2>
            <div className="toolbar">
              <Field label="Állapot">
                {(p) => (
                  <select
                    {...p}
                    value={state}
                    onChange={(e) => {
                      const n = new URLSearchParams(params);
                      n.set("allapot", e.target.value);
                      setParams(n, { replace: true });
                    }}
                  >
                    {STATE_FILTERS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            {invoices.isLoading && <Loading />}
            {invoices.error && <ErrorBox error={invoices.error} />}
            {invoices.data && invoices.data.length === 0 && <p className="muted">Nincs ilyen számla.</p>}
            {invoices.data && invoices.data.length > 0 && <InvoiceTable items={invoices.data} />}
          </section>
        </>
      )}
    </>
  );
}

function InvoiceTable({ items }: { items: NavInvoiceListItemDto[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Számlaszám</th>
            <th scope="col">Irány</th>
            <th scope="col">Kelt</th>
            <th scope="col">Partner</th>
            <th scope="col" className="num">
              Nettó
            </th>
            <th scope="col" className="num">
              Áfa
            </th>
            <th scope="col">Állapot</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td>
                <Link to={`/konyveles/nav-import/${i.id}`}>{i.invoiceNumber}</Link>
                {i.operation !== "CREATE" && <div className="muted small">{NAV_OPERATION_LABELS[i.operation]}</div>}
              </td>
              <td>{i.direction === "INBOUND" ? "Bejövő" : "Kimenő"}</td>
              <td>{formatDateHu(i.issueDate)}</td>
              <td>{i.partnerName ?? i.partnerTaxNumber ?? "–"}</td>
              <td className="num">{i.netAmountHuf === null ? "–" : formatHuf(i.netAmountHuf)}</td>
              <td className="num">{i.vatAmountHuf === null ? "–" : formatHuf(i.vatAmountHuf)}</td>
              <td>
                {NAV_INVOICE_STATE_LABELS[i.state]}
                {i.documentSerialNumber && (
                  <div className="small">
                    <Link to={`/konyveles/${i.documentId}`}>{i.documentSerialNumber}</Link>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImportForm() {
  const ws = useWorkspace();
  const companyId = ws.company?.id;
  const queryClient = useQueryClient();
  const today = todayIso();
  const [direction, setDirection] = useState<NavDirection>("INBOUND");
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const start = useMutation({
    mutationFn: () => post<NavImportRunDto>(`/api/companies/${companyId}/nav/imports`, { direction, dateFrom: from, dateTo: to }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: [...navKey(companyId), "runs"] });
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e : null);
      setAttempt((a) => a + 1);
    },
  });
  return (
    <section className="card" aria-labelledby="nav-import-start">
      <h2 id="nav-import-start">
        Lekérdezés a NAV-tól <HelpTip term="navImport" />
      </h2>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          start.mutate();
        }}
      >
        <ErrorSummary message={error?.message} fields={error?.fields} attempt={attempt} />
        <div className="toolbar">
          <Field label="Irány">
            {(p) => (
              <select {...p} value={direction} onChange={(e) => setDirection(e.target.value as NavDirection)}>
                {(Object.keys(NAV_DIRECTION_LABELS) as NavDirection[]).map((d) => (
                  <option key={d} value={d}>
                    {NAV_DIRECTION_LABELS[d]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Kelt: ettől" error={error?.fields.dateFrom}>
            {(p) => <DateInput controlProps={p} value={from} onChange={setFrom} />}
          </Field>
          <Field label="Kelt: eddig" error={error?.fields.dateTo}>
            {(p) => <DateInput controlProps={p} value={to} onChange={setTo} />}
          </Field>
        </div>
        <p className="muted small">A NAV egyszerre legfeljebb 35 napot ad; a hosszabb időszakot a program részletekben kéri le. A már importált számlák nem duplázódnak.</p>
        <div className="row">
          <button className="btn btn-primary" disabled={start.isPending}>
            Lekérdezés indítása
          </button>
        </div>
      </form>
    </section>
  );
}

function ImportRuns() {
  const companyId = useWorkspace().company?.id;
  const queryClient = useQueryClient();
  const runs = useQuery({
    queryKey: [...navKey(companyId), "runs"],
    queryFn: async () => {
      const data = await get<NavImportRunDto[]>(`/api/companies/${companyId}/nav/imports`);
      // Ha egy import befejeződött, a számlalista és a Teendők is frissülnek.
      void queryClient.invalidateQueries({ queryKey: [...navKey(companyId), "invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["todos"] });
      return data;
    },
    enabled: Boolean(companyId),
    refetchInterval: (query) => (query.state.data?.some((r) => r.status === "RUNNING") ? 1500 : false),
  });
  if (!runs.data || runs.data.length === 0) return null;
  return (
    <section className="card" aria-labelledby="nav-runs">
      <h2 id="nav-runs">Legutóbbi lekérdezések</h2>
      <ul className="stack" aria-live="polite">
        {runs.data.slice(0, 5).map((r) => (
          <li key={r.id}>
            <strong>{r.direction === "INBOUND" ? "Bejövő" : "Kimenő"}</strong> {formatDateHu(r.dateFrom)}–{formatDateHu(r.dateTo)}:{" "}
            {r.status === "RUNNING" && `folyamatban (${r.windowsDone}/${r.windowsTotal} rész)…`}
            {r.status === "DONE" && `kész – ${r.foundCount} számla, ebből ${r.newCount} új.`}
            {r.status === "FAILED" && <span className="text-error">sikertelen: {r.errorMessage}</span>}
            <span className="muted small"> ({formatDateTimeHu(r.startedAt)})</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- Egy NAV-számla: javaslat és jóváhagyás ----------

export function NavInvoicePage() {
  const { invoiceId } = useParams();
  const ws = useWorkspace();
  const companyId = ws.company?.id;
  const queryClient = useQueryClient();
  const toast = useToast();
  const accounts = useAccounts();
  const partners = usePartners();
  const templates = useTemplates();
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [mainAccountId, setMainAccountId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string>("");
  const [accountingDate, setAccountingDate] = useState<string>("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [approved, setApproved] = useState<string | null>(null);

  const qs = new URLSearchParams();
  if (partnerId) qs.set("partnerId", partnerId);
  if (mainAccountId) qs.set("mainAccountId", mainAccountId);
  if (templateId) qs.set("templateId", templateId);
  const detailKey = [...navKey(companyId), "invoice", invoiceId, qs.toString()];
  const q = useQuery({
    queryKey: detailKey,
    queryFn: () => get<NavInvoiceDetailDto>(`/api/companies/${companyId}/nav/invoices/${invoiceId}${qs.size ? `?${qs}` : ""}`),
    enabled: Boolean(companyId && invoiceId),
    placeholderData: (prev) => prev,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: navKey(companyId) });
    await queryClient.invalidateQueries({ queryKey: ["todos"] });
  };
  const onError = (e: unknown) => {
    setError(e instanceof ApiError ? e : null);
    setAttempt((a) => a + 1);
    if (!(e instanceof ApiError)) toast("error", errorMessage(e));
  };
  const approve = useMutation({
    mutationFn: (opts: { post: boolean; createPartner?: boolean }) =>
      post<{ documentId: string; invoice: NavInvoiceDetailDto }>(`/api/companies/${companyId}/nav/invoices/${invoiceId}/approve`, {
        post: opts.post,
        createPartner: opts.createPartner ?? false,
        partnerId,
        mainAccountId,
        templateId: templateId || null,
        ...(accountingDate ? { accountingDate } : {}),
      }),
    onSuccess: async (res, opts) => {
      setError(null);
      setApproved(res.documentId);
      await refresh();
      toast("success", opts.post ? "A bizonylatot könyveltük." : "A bizonylat piszkozatként elkészült.");
    },
    onError,
  });
  const fetchData = useMutation({
    mutationFn: () => post<NavInvoiceDetailDto>(`/api/companies/${companyId}/nav/invoices/${invoiceId}/fetch-data`),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError,
  });
  const ignore = useMutation({
    mutationFn: () => post<NavInvoiceDetailDto>(`/api/companies/${companyId}/nav/invoices/${invoiceId}/ignore`, { reason }),
    onSuccess: async () => {
      setError(null);
      setReason("");
      await refresh();
    },
    onError,
  });
  const restore = useMutation({
    mutationFn: () => post<NavInvoiceDetailDto>(`/api/companies/${companyId}/nav/invoices/${invoiceId}/restore`),
    onSuccess: refresh,
    onError,
  });

  const d = q.data;
  const inbound = d?.direction === "INBOUND";
  const canPost = ws.can("ledger:post");
  const busy = approve.isPending || fetchData.isPending || ignore.isPending;
  return (
    <>
      <SubNav label="Könyvelés almenü" items={LEDGER_TABS} />
      <PageHeader title={d ? `NAV-számla: ${d.invoiceNumber}` : "NAV-számla"} description={<Link to="/konyveles/nav-import">Vissza a NAV-importhoz</Link>} />
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {d && (
        <div className="stack">
          <ErrorSummary message={error?.message} fields={error?.fields} attempt={attempt} />
          {approved && (
            <div className="alert alert-success" role="status">
              Elkészült a bizonylat. <Link to={`/konyveles/${approved}`}>Megnyitás</Link>
            </div>
          )}
          <section className="card" aria-labelledby="nav-head">
            <h2 id="nav-head">
              {NAV_OPERATION_LABELS[d.operation]} · {inbound ? "bejövő" : "kimenő"} · {NAV_INVOICE_STATE_LABELS[d.state]}
            </h2>
            <dl className="grid-2" style={{ margin: 0 }}>
              <div>
                <dt>{inbound ? "Szállító" : "Vevő"}</dt>
                <dd>
                  {d.partnerName ?? "–"} {d.partnerTaxNumber && <span className="muted">({d.partnerTaxNumber})</span>}
                </dd>
              </div>
              <div>
                <dt>Kelt / teljesítés / fizetési határidő</dt>
                <dd>
                  {formatDateHu(d.issueDate)} / {formatDateHu(d.deliveryDate)} / {formatDateHu(d.paymentDate)}
                </dd>
              </div>
              <div>
                <dt>Nettó / áfa (Ft)</dt>
                <dd>
                  {d.netAmountHuf === null ? "–" : formatHuf(d.netAmountHuf)} / {d.vatAmountHuf === null ? "–" : formatHuf(d.vatAmountHuf)}
                </dd>
              </div>
              {d.originalInvoiceNumber && (
                <div>
                  <dt>Eredeti számla</dt>
                  <dd>
                    {d.originalInvoiceNumber}
                    {d.original?.serialNumber && d.original.documentId && (
                      <>
                        {" "}
                        → <Link to={`/konyveles/${d.original.documentId}`}>{d.original.serialNumber}</Link>
                      </>
                    )}
                  </dd>
                </div>
              )}
              {d.documentSerialNumber && (
                <div>
                  <dt>Bizonylat</dt>
                  <dd>
                    <Link to={`/konyveles/${d.documentId}`}>{d.documentSerialNumber}</Link>
                  </dd>
                </div>
              )}
              {d.ignoredReason && (
                <div>
                  <dt>Figyelmen kívül hagyva</dt>
                  <dd>{d.ignoredReason}</dd>
                </div>
              )}
            </dl>
            {d.completenessIndicator === false && (
              <p className="muted small">
                Az adatszolgáltatás nem azonos a számlával <HelpTip term="adatszolgaltatas" />: a bizonylat az eredeti számla.
              </p>
            )}
          </section>

          <section className="card" aria-labelledby="nav-lines">
            <h2 id="nav-lines">Tételsorok a NAV-ban</h2>
            {d.lines ? (
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Megnevezés</th>
                    <th scope="col" className="num">
                      Mennyiség
                    </th>
                    <th scope="col" className="num">
                      Nettó
                    </th>
                    <th scope="col">Áfa</th>
                  </tr>
                </thead>
                <tbody>
                  {d.lines.map((l) => (
                    <tr key={l.lineNumber}>
                      <td>{l.lineNumber}</td>
                      <td>{l.description ?? "–"}</td>
                      <td className="num">
                        {l.quantity ?? "–"} {l.unitOfMeasure ?? ""}
                      </td>
                      <td className="num">{l.netAmountHuf === null ? "–" : formatHuf(l.netAmountHuf)}</td>
                      <td>{l.vatRate !== null ? `${Math.round(l.vatRate * 100)}%` : (l.vatCase ?? "–")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="row">
                <p className="muted">A tételsorokat kérésre töltjük le (egy lekérdezés a NAV-tól).</p>
                {canPost && (
                  <button type="button" className="btn" disabled={busy} onClick={() => fetchData.mutate()}>
                    Teljes számlaadat letöltése
                  </button>
                )}
              </div>
            )}
          </section>

          {d.state === "NEW" && canPost && (
            <section className="card stack" aria-labelledby="nav-proposal">
              <h2 id="nav-proposal">Könyvelési javaslat</h2>
              {d.proposal.warnings.map((w) => (
                <div key={w} className="alert alert-warning">
                  {w}
                </div>
              ))}
              {d.proposal.action === "REVERSE" ? (
                <p>
                  Az eredeti bizonylat ({d.proposal.originalSerialNumber ?? "–"}) sztornója, oka: „{d.proposal.reason}”. A sztornó azonnal
                  könyvelődik.
                </p>
              ) : (
                <>
                  <div className="grid-2">
                    <Field label={inbound ? "Szállító" : "Vevő"} error={error?.fields.partnerId}>
                      {(p) => (
                        <PartnerPicker
                          controlProps={p}
                          partners={partners.data ?? []}
                          kind={inbound ? "SUPPLIER" : "CUSTOMER"}
                          value={partnerId ?? d.partner?.id ?? null}
                          onChange={(x) => setPartnerId(x?.id ?? null)}
                        />
                      )}
                    </Field>
                    <Field label={inbound ? "Költségszámla" : "Árbevétel-számla"} error={error?.fields.mainAccountId}>
                      {(p) => (
                        <AccountPicker
                          controlProps={p}
                          accounts={accounts.data ?? []}
                          value={mainAccountId ?? (d.proposal.action === "DOCUMENT" ? d.proposal.lines : []).find((l) => l.role === "MAIN")?.accountId ?? null}
                          onChange={setMainAccountId}
                        />
                      )}
                    </Field>
                    <Field label="Kontírozási sablon (nem kötelező)">
                      {(p) => (
                        <select {...p} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                          <option value="">Partner alapértelmezése</option>
                          {(templates.data ?? [])
                            .filter((t) => t.isActive)
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                        </select>
                      )}
                    </Field>
                    <Field label="Könyvelés dátuma" hint={`Javaslat: ${formatDateHu(d.proposal.accountingDate)}`} error={error?.fields.accountingDate}>
                      {(p) => <DateInput controlProps={p} value={accountingDate || d.proposal.accountingDate} onChange={setAccountingDate} />}
                    </Field>
                  </div>
                  {!d.partner && !partnerId && d.newPartner && (
                    <div className="alert alert-info">
                      Ez a partner még nincs a rendszerben: {d.newPartner.name ?? "–"} ({d.newPartner.taxNumberFull ?? d.newPartner.taxNumberBase}).{" "}
                      <button type="button" className="btn btn-small" disabled={busy} onClick={() => approve.mutate({ post: false, createPartner: true })}>
                        Partner felvétele és átvétel piszkozatként
                      </button>
                    </div>
                  )}
                  <table className="table">
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
                      {d.proposal.lines.map((l, i) => (
                        <tr key={i}>
                          <td>{l.accountNumber ? `${l.accountNumber} – ${l.accountName}` : <span className="text-error">Válasszon számlát</span>}</td>
                          <td className="num">{l.side === "D" ? formatHuf(l.amount) : ""}</td>
                          <td className="num">{l.side === "C" ? formatHuf(l.amount) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              {d.proposal.blockers.map((b) => (
                <div key={b} className="alert alert-error">
                  {b}
                </div>
              ))}
              <div className="row">
                {d.proposal.action === "REVERSE" ? (
                  <button type="button" className="btn btn-primary" disabled={busy || d.proposal.blockers.length > 0} onClick={() => approve.mutate({ post: true })}>
                    Jóváhagyás: sztornó könyvelése
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn btn-primary" disabled={busy || d.proposal.blockers.length > 0} onClick={() => approve.mutate({ post: true })}>
                      Jóváhagyás és könyvelés
                    </button>
                    <button type="button" className="btn" disabled={busy || d.proposal.blockers.length > 0} onClick={() => approve.mutate({ post: false })}>
                      Átvétel piszkozatként
                    </button>
                  </>
                )}
              </div>
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  ignore.mutate();
                }}
              >
                <Field label="Figyelmen kívül hagyás oka" error={error?.fields.reason}>
                  {(p) => <input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
                </Field>
                <button className="btn" disabled={busy}>
                  Figyelmen kívül hagyás
                </button>
              </form>
            </section>
          )}
          {d.state === "IGNORED" && canPost && (
            <div className="row">
              <button type="button" className="btn" onClick={() => restore.mutate()}>
                Visszavétel a jóváhagyandók közé
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
