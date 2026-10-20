import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, NavLink, useSearchParams } from "react-router";
import { agingBucket, AGING_BUCKETS, AGING_LABELS, formatHuf, OPEN_ITEM_KIND_LABELS, SUBLEDGER_LABELS, todayIso } from "@konyvelo/domain";
import type { OpenItemDto, OpenItemsResponse, ReconciliationResponse, UnappliedDto } from "@konyvelo/shared";
import { useWorkspace } from "../../app/workspace";
import { ApiError, get, post } from "../../lib/api";
import { formatDateHu } from "../../lib/format";
import { AmountInput, amountFromText, amountText } from "../../ui/AmountInput";
import { DateInput } from "../../ui/DateInput";
import { Field } from "../../ui/Field";
import { ErrorBox, Loading, PageHeader } from "../../ui/Page";
import { useToast } from "../../ui/Toasts";
import { HelpTip } from "../../ui/Tooltip";
import { useInvalidateDocuments } from "../documents/queries";

export const openItemsKey = (companyId: string | undefined) => ["open-items", companyId] as const;

export function useOpenItems(params: { partnerId?: string | null; kind?: string; asOf?: string }, enabled = true) {
  const companyId = useWorkspace().company?.id;
  const qs = new URLSearchParams({
    ...(params.partnerId ? { partnerId: params.partnerId } : {}),
    ...(params.kind ? { kind: params.kind } : {}),
    ...(params.asOf ? { asOf: params.asOf } : {}),
  }).toString();
  return useQuery({
    queryKey: [...openItemsKey(companyId), qs],
    queryFn: () => get<OpenItemsResponse>(`/api/companies/${companyId}/open-items?${qs}`),
    enabled: Boolean(companyId) && enabled,
  });
}

export { useInvalidateDocuments as useInvalidateSubledger } from "../documents/queries";

/** Alnavigáció egy főmenüponton belül (pl. Partnerek | Nyitott tételek | Egyeztetés). */
export function SubNav({ label, items }: { label: string; items: Array<{ to: string; label: string; end?: boolean }> }) {
  return (
    <nav className="sub-nav" aria-label={label}>
      <ul>
        {items.map((i) => (
          <li key={i.to}>
            <NavLink to={i.to} end={i.end}>
              {i.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export const PARTNER_TABS = [
  { to: "/partnerek", label: "Partnerek", end: true },
  { to: "/partnerek/nyitott-tetelek", label: "Nyitott tételek" },
  { to: "/partnerek/egyeztetes", label: "Egyeztetés" },
];

const docLabel = (d: { serialNumber: string | null; externalNumber: string | null }) => d.serialNumber ?? "";

export function OpenItemsTable({ items, showPartner, asOf }: { items: OpenItemDto[]; showPartner?: boolean; asOf: string }) {
  if (items.length === 0) return <p className="muted">Nincs nyitott tétel.</p>;
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">Nyitott tételek</caption>
        <thead>
          <tr>
            <th scope="col">Bizonylat</th>
            {showPartner && <th scope="col">Partner</th>}
            <th scope="col">Számlaszám</th>
            <th scope="col">Fizetési határidő</th>
            <th scope="col" className="num">
              Eredeti
            </th>
            <th scope="col" className="num">
              Nyitott
            </th>
            <th scope="col">Állapot</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.lineId}>
              <td className="mono nowrap">
                <Link to={`/konyveles/${i.documentId}`}>{docLabel(i)}</Link>
              </td>
              {showPartner && <td>{i.partnerId ? <Link to={`/partnerek/${i.partnerId}`}>{i.partnerName}</Link> : ""}</td>}
              <td className="mono">{i.externalNumber}</td>
              <td>{formatDateHu(i.dueDate)}</td>
              <td className="num">{formatHuf(i.amount)}</td>
              <td className="num">
                <strong>{formatHuf(i.open)}</strong>
              </td>
              <td>
                {i.daysOverdue > 0 ? (
                  <span className="badge badge-warning">{i.daysOverdue} napja lejárt</span>
                ) : (
                  <span className="muted">{agingBucket(i.dueDate, asOf) === "NOT_DUE" ? "nem lejárt" : ""}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Párosítatlan fizetések (túlfizetés, előleg) – utólagos párosítással. */
export function UnappliedTable({ rows, items, canEdit }: { rows: UnappliedDto[]; items: OpenItemDto[]; canEdit: boolean }) {
  if (rows.length === 0) return null;
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">Párosítatlan fizetések</caption>
        <thead>
          <tr>
            <th scope="col">Bizonylat</th>
            <th scope="col">Partner</th>
            <th scope="col">Dátum</th>
            <th scope="col" className="num">
              Párosítatlan
            </th>
            <th scope="col">
              <span className="sr-only">Művelet</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.lineId}>
              <td className="mono nowrap">
                <Link to={`/konyveles/${u.documentId}`}>{u.serialNumber}</Link>
              </td>
              <td>{u.partnerName}</td>
              <td>{formatDateHu(u.accountingDate)}</td>
              <td className="num">{formatHuf(u.unapplied)}</td>
              <td>
                {canEdit && (
                  <PairDialog
                    payment={u}
                    items={items.filter((i) => i.partnerId === u.partnerId && i.accountId === u.accountId)}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PairDialog({ payment, items }: { payment: UnappliedDto; items: OpenItemDto[] }) {
  const ws = useWorkspace();
  const toast = useToast();
  const invalidate = useInvalidateDocuments();
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const item = items.find((i) => i.lineId === itemId);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setError(null);
        if (o) {
          const first = items[0];
          setItemId(first?.lineId ?? "");
          setAmount(first ? amountText(Math.min(first.open, payment.unapplied)) : "");
        }
      }}
    >
      <Dialog.Trigger asChild>
        <button type="button" className="btn btn-small" disabled={items.length === 0} aria-label={`Párosítás: ${payment.serialNumber}`}>
          Párosítás
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" aria-describedby={undefined}>
          <Dialog.Title asChild>
            <h2>Fizetés párosítása</h2>
          </Dialog.Title>
          <p>
            <span className="mono">{payment.serialNumber}</span> – párosítatlan: <strong>{formatHuf(payment.unapplied)}</strong>. A párosítás a könyvelést
            nem változtatja meg, csak azt rögzíti, melyik számlát egyenlíti ki.
          </p>
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
          <div className="form-row">
            <Field label="Nyitott tétel">
              {(p) => (
                <select
                  {...p}
                  value={itemId}
                  onChange={(e) => {
                    setItemId(e.target.value);
                    const it = items.find((i) => i.lineId === e.target.value);
                    if (it) setAmount(amountText(Math.min(it.open, payment.unapplied)));
                  }}
                >
                  {items.map((i) => (
                    <option key={i.lineId} value={i.lineId}>
                      {i.serialNumber} ({i.externalNumber}) – nyitott {formatHuf(i.open)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Összeg (Ft)">{(p) => <AmountInput controlProps={p} value={amount} onChange={setAmount} />}</Field>
          </div>
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <button type="button" className="btn">
                Mégse
              </button>
            </Dialog.Close>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!item}
              onClick={async () => {
                const a = amountFromText(amount);
                if (typeof a !== "number" || a <= 0) return setError("Adjon meg pozitív összeget.");
                try {
                  await post(`/api/companies/${ws.company!.id}/settlements`, { itemLineId: itemId, settlingLineId: payment.lineId, amount: a });
                  await invalidate();
                  toast("success", "A párosítás megtörtént.");
                  setOpen(false);
                } catch (err) {
                  setError(err instanceof ApiError ? (Object.values(err.fields)[0] ?? err.message) : "Váratlan hiba történt.");
                }
              }}
            >
              Párosítás
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Egy partner nyitott tételei és párosítatlan fizetései (a partner adatlapján). */
export function PartnerOpenItems({ partnerId }: { partnerId: string }) {
  const ws = useWorkspace();
  const q = useOpenItems({ partnerId });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const total = d.items.reduce((s, i) => s + (i.kind === "RECEIVABLE" ? i.open : -i.open), 0);
  return (
    <section className="card" aria-labelledby="partner-nyitott">
      <h2 id="partner-nyitott">
        Nyitott tételek <HelpTip term="analitika" />
      </h2>
      <OpenItemsTable items={d.items} asOf={d.asOf} />
      {d.items.length > 0 && (
        <p>
          Egyenleg: <strong>{formatHuf(Math.abs(total))}</strong> {total >= 0 ? "követelésünk" : "tartozásunk"}.
        </p>
      )}
      {d.unapplied.length > 0 && (
        <>
          <h3>Párosítatlan fizetések</h3>
          <UnappliedTable rows={d.unapplied} items={d.items} canEdit={ws.can("ledger:post")} />
        </>
      )}
    </section>
  );
}

export function OpenItemsPage() {
  const ws = useWorkspace();
  const [params, setParams] = useSearchParams();
  const kind = params.get("tipus") === "szallito" ? "PAYABLE" : params.get("tipus") === "vevo" ? "RECEIVABLE" : "";
  const overdueOnly = params.get("lejart") === "1";
  const [asOf, setAsOf] = useState(todayIso());
  const q = useOpenItems({ kind: kind || undefined, asOf }, Boolean(asOf));
  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };
  const items = (q.data?.items ?? []).filter((i) => !overdueOnly || i.daysOverdue > 0);
  const aging = (k: "RECEIVABLE" | "PAYABLE") =>
    AGING_BUCKETS.map((b) => items.filter((i) => i.kind === k && agingBucket(i.dueDate, asOf) === b).reduce((s, i) => s + i.open, 0));
  const kinds = (kind ? [kind] : ["RECEIVABLE", "PAYABLE"]) as Array<"RECEIVABLE" | "PAYABLE">;
  return (
    <>
      <SubNav label="Partnerek almenü" items={PARTNER_TABS} />
      <PageHeader title="Nyitott tételek" description="Vevőkövetelések és szállítói tartozások korosítva; a párosítatlan fizetések utólag párosíthatók." />
      <div className="toolbar">
        <Field label="Típus">
          {(p) => (
            <select {...p} value={params.get("tipus") ?? ""} onChange={(e) => setParam("tipus", e.target.value)}>
              <option value="">Vevők és szállítók</option>
              <option value="vevo">Vevők</option>
              <option value="szallito">Szállítók</option>
            </select>
          )}
        </Field>
        <Field label="Fordulónap" hint="Pl. leltárhoz a mérlegfordulónap.">
          {(p) => <DateInput controlProps={p} value={asOf} onChange={setAsOf} />}
        </Field>
        <label className="checkbox-row">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setParam("lejart", e.target.checked ? "1" : "")} /> Csak a lejártak
        </label>
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && (
        <>
          <section className="card table-wrap" aria-labelledby="korositas">
            <h2 id="korositas">Korosítás</h2>
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Típus</span>
                  </th>
                  {AGING_BUCKETS.map((b) => (
                    <th key={b} scope="col" className="num">
                      {AGING_LABELS[b]}
                    </th>
                  ))}
                  <th scope="col" className="num">
                    Összesen
                  </th>
                </tr>
              </thead>
              <tbody>
                {kinds.map((k) => {
                  const row = aging(k);
                  return (
                    <tr key={k}>
                      <th scope="row">{OPEN_ITEM_KIND_LABELS[k]}</th>
                      {row.map((v, i) => (
                        <td key={AGING_BUCKETS[i]} className="num">
                          {formatHuf(v)}
                        </td>
                      ))}
                      <td className="num">
                        <strong>{formatHuf(row.reduce((s, v) => s + v, 0))}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          <section className="card" aria-labelledby="tetelek-lista">
            <h2 id="tetelek-lista">Tételek ({items.length})</h2>
            <OpenItemsTable items={items} showPartner asOf={asOf} />
          </section>
          {q.data.unapplied.length > 0 && (
            <section className="card" aria-labelledby="parositatlan">
              <h2 id="parositatlan">Párosítatlan fizetések ({q.data.unapplied.length})</h2>
              <UnappliedTable rows={q.data.unapplied} items={q.data.items} canEdit={ws.can("ledger:post") && asOf === todayIso()} />
            </section>
          )}
        </>
      )}
    </>
  );
}

export function ReconciliationPage() {
  const ws = useWorkspace();
  const companyId = ws.company?.id;
  const [asOf, setAsOf] = useState(ws.fiscalYear && todayIso() > ws.fiscalYear.endDate ? ws.fiscalYear.endDate : todayIso());
  const q = useQuery({
    queryKey: ["reconciliation", companyId, asOf],
    queryFn: () => get<ReconciliationResponse>(`/api/companies/${companyId}/reconciliation?asOf=${asOf}`),
    enabled: Boolean(companyId && asOf),
  });
  return (
    <>
      <SubNav label="Partnerek almenü" items={PARTNER_TABS} />
      <PageHeader
        title="Főkönyv és analitika egyeztetése"
        description="A vevő- és szállítóanalitika összesen egyezzen a főkönyvi egyenleggel (Szt. 69. § (2), 161. § (3)). A bank- és pénztáregyenleget a kivonattal, illetve a pénztárjelentéssel vesse össze."
      />
      <div className="toolbar">
        <Field label="Fordulónap">{(p) => <DateInput controlProps={p} value={asOf} onChange={setAsOf} />}</Field>
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && (
        <div className="card table-wrap">
          <table>
            <caption className="sr-only">Egyeztetés</caption>
            <thead>
              <tr>
                <th scope="col">Számla</th>
                <th scope="col">Analitika</th>
                <th scope="col" className="num">
                  Főkönyv
                </th>
                <th scope="col" className="num">
                  Analitika szerint
                </th>
                <th scope="col">Eredmény</th>
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((r) => (
                <tr key={r.accountId}>
                  <td>
                    <span className="mono">{r.accountNumber}</span> {r.accountName}
                  </td>
                  <td>{SUBLEDGER_LABELS[r.subledger]}</td>
                  <td className="num">{formatHuf(r.ledger)}</td>
                  <td className="num">{r.subledgerBalance === null ? "—" : formatHuf(r.subledgerBalance)}</td>
                  <td>
                    {r.subledgerBalance === null ? (
                      r.subledger === "BANK" || r.subledger === "CASH" ? (
                        <Link to={`/konyveles/penzeszkozok?szamla=${r.accountId}`}>Bank/pénztár napló</Link>
                      ) : null
                    ) : r.difference === 0 ? (
                      <span className="badge badge-success">Egyezik</span>
                    ) : (
                      <span className="badge badge-warning">Eltérés: {formatHuf(r.difference)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
