import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { addDays, formatHuf, todayIso } from "@konyvelo/domain";
import type { MoneyRegisterDto } from "@konyvelo/shared";
import { useWorkspace } from "../../app/workspace";
import { get } from "../../lib/api";
import { formatDateHu } from "../../lib/format";
import { AmountInput, amountFromText } from "../../ui/AmountInput";
import { DateInput } from "../../ui/DateInput";
import { Field } from "../../ui/Field";
import { ErrorBox, Loading, PageHeader } from "../../ui/Page";
import { useAccounts } from "../accounts/useAccounts";
import { SubNav } from "./SubledgerPages";

export const LEDGER_TABS = [
  { to: "/konyveles", label: "Bizonylatok", end: true },
  { to: "/konyveles/penzeszkozok", label: "Bank és pénztár" },
];

/** Bank- és pénztárnapló futó egyenleggel; banknál kivonat-egyeztetés, pénztárnál a szabályzat szerinti maximum (PLAN 4.7). */
export function MoneyPage() {
  const ws = useWorkspace();
  const [params, setParams] = useSearchParams();
  const accounts = useAccounts();
  const money = useMemo(
    () => (accounts.data ?? []).filter((a) => (a.subledger === "BANK" || a.subledger === "CASH") && !a.hasChildren && a.isActive),
    [accounts.data],
  );
  const accountId = params.get("szamla") ?? money[0]?.id ?? "";
  const [to, setTo] = useState(todayIso());
  const [from, setFrom] = useState(addDays(todayIso(), -30));
  const [statement, setStatement] = useState("");
  const companyId = ws.company?.id;
  const q = useQuery({
    queryKey: ["money", companyId, accountId, from, to],
    queryFn: () => get<MoneyRegisterDto>(`/api/companies/${companyId}/money/${accountId}?from=${from}&to=${to}`),
    enabled: Boolean(companyId && accountId && from && to),
  });
  const d = q.data;
  const stmt = amountFromText(statement);

  return (
    <>
      <SubNav label="Könyvelés almenü" items={LEDGER_TABS} />
      <PageHeader title="Bank és pénztár" description="A pénzeszközszámlák mozgásai futó egyenleggel; pénztárnál ez a pénztárjelentés." />
      <div className="toolbar">
        <Field label="Számla">
          {(p) => (
            <select
              {...p}
              value={accountId}
              onChange={(e) => {
                const n = new URLSearchParams(params);
                n.set("szamla", e.target.value);
                setParams(n, { replace: true });
              }}
            >
              {money.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.number} – {a.name} ({a.subledger === "BANK" ? "bank" : "pénztár"})
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Időszak kezdete">{(p) => <DateInput controlProps={p} value={from} onChange={setFrom} />}</Field>
        <Field label="Időszak vége">{(p) => <DateInput controlProps={p} value={to} onChange={setTo} />}</Field>
      </div>
      {(q.isLoading || accounts.isLoading) && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {d && (
        <>
          {d.subledger === "CASH" && d.days.some((x) => x.overLimit) && (
            <div className="alert alert-warning">
              A napi záróegyenleg {d.days.filter((x) => x.overLimit).length} napon meghaladta a pénzkezelési szabályzat szerinti maximumot (
              {formatHuf(d.limit ?? 0)}).
            </div>
          )}
          {d.subledger === "CASH" && d.limit == null && (
            <p className="muted small">
              A napi pénztár-záróegyenleg maximumát a <Link to="/beallitasok/ceg">Cégadatoknál</Link> adhatja meg (Szt. 14. § (8), pénzkezelési szabályzat).
            </p>
          )}
          <div className="card table-wrap">
            <table>
              <caption className="sr-only">Mozgások</caption>
              <thead>
                <tr>
                  <th scope="col">Dátum</th>
                  <th scope="col">Bizonylat</th>
                  <th scope="col">Partner</th>
                  <th scope="col">Leírás</th>
                  <th scope="col" className="num">
                    {d.subledger === "CASH" ? "Bevétel" : "Jóváírás"}
                  </th>
                  <th scope="col" className="num">
                    {d.subledger === "CASH" ? "Kiadás" : "Terhelés"}
                  </th>
                  <th scope="col" className="num">
                    Egyenleg
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{formatDateHu(d.from)}</td>
                  <td colSpan={5}>
                    <strong>Nyitó egyenleg</strong>
                  </td>
                  <td className="num">
                    <strong>{formatHuf(d.opening)}</strong>
                  </td>
                </tr>
                {d.rows.map((r) => (
                  <tr key={r.documentId}>
                    <td>{formatDateHu(r.date)}</td>
                    <td className="mono nowrap">
                      <Link to={`/konyveles/${r.documentId}`}>{r.serialNumber}</Link>
                    </td>
                    <td>{r.partnerName}</td>
                    <td>{r.description}</td>
                    <td className="num">{r.debit ? formatHuf(r.debit) : ""}</td>
                    <td className="num">{r.credit ? formatHuf(r.credit) : ""}</td>
                    <td className="num">{formatHuf(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={4}>
                    Záró egyenleg ({formatDateHu(d.to)})
                  </th>
                  <td className="num">{formatHuf(d.rows.reduce((s, r) => s + r.debit, 0))}</td>
                  <td className="num">{formatHuf(d.rows.reduce((s, r) => s + r.credit, 0))}</td>
                  <td className="num">
                    <strong>{formatHuf(d.closing)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {d.subledger === "BANK" && (
            <section className="card" aria-labelledby="kivonat">
              <h2 id="kivonat">Egyeztetés a bankkivonattal</h2>
              <div className="form-row">
                <Field label={`A kivonat záró egyenlege ${formatDateHu(d.to)}-i napra (Ft)`}>
                  {(p) => <AmountInput controlProps={p} value={statement} onChange={setStatement} />}
                </Field>
              </div>
              {typeof stmt === "number" && (
                <p role="status" className={stmt === d.closing ? "balance-ok" : "error"}>
                  {stmt === d.closing
                    ? "A könyvelt egyenleg egyezik a kivonattal."
                    : `Eltérés: ${formatHuf(d.closing - stmt)} – valószínűleg hiányzik vagy hibás egy banki tétel.`}
                </p>
              )}
            </section>
          )}
          {d.subledger === "CASH" && d.days.length > 0 && (
            <section className="card table-wrap" aria-labelledby="napi">
              <h2 id="napi">Napi záróegyenlegek</h2>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Nap</th>
                    <th scope="col" className="num">
                      Záróegyenleg
                    </th>
                    <th scope="col">Megjegyzés</th>
                  </tr>
                </thead>
                <tbody>
                  {d.days.map((x) => (
                    <tr key={x.date}>
                      <td>{formatDateHu(x.date)}</td>
                      <td className="num">{formatHuf(x.closing)}</td>
                      <td>{x.overLimit ? <span className="badge badge-warning">a maximum felett</span> : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </>
  );
}
