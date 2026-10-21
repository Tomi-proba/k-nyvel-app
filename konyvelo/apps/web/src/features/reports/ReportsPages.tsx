import { useQuery } from "@tanstack/react-query";
import { Fragment, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { formatHuf, toThousandHuf, todayIso } from "@konyvelo/domain";
import {
  INTERNAL_STATEMENT_FOOTER,
  INTERNAL_STATEMENT_HEADER,
  NOT_AUDITED_NOTICE,
  type JournalDto,
  type LedgerDto,
  type ReportCompany,
  type StatementDto,
  type TrialBalanceDto,
} from "@konyvelo/shared";
import { useWorkspace } from "../../app/workspace";
import { get } from "../../lib/api";
import { exportCsv, exportXlsx, ftValue, type ExportSpec } from "../../lib/report-export";
import { formatDateHu } from "../../lib/format";
import { AccountPicker } from "../../ui/AccountPicker";
import { DateInput } from "../../ui/DateInput";
import { Field } from "../../ui/Field";
import { ErrorBox, Loading, PageHeader } from "../../ui/Page";
import { PartnerPicker } from "../../ui/PartnerPicker";
import { useAccounts } from "../accounts/useAccounts";
import { usePartners } from "../partners/usePartners";
import { SubNav } from "../subledger/SubledgerPages";

const TABS = [
  { to: "/kimutatasok", label: "Főkönyvi kivonat", end: true },
  { to: "/kimutatasok/naplo", label: "Naplófőkönyv" },
  { to: "/kimutatasok/karton", label: "Karton" },
  { to: "/kimutatasok/merleg", label: "Mérleg" },
  { to: "/kimutatasok/eredmeny", label: "Eredménykimutatás" },
];

/** Alapértelmezett időszak: a kiválasztott üzleti év eleje – ma (vagy az év vége, ha már elmúlt). */
function useDefaultPeriod() {
  const fy = useWorkspace().fiscalYear;
  const today = todayIso();
  const to = fy ? (today > fy.endDate ? fy.endDate : today < fy.startDate ? fy.startDate : today) : today;
  return { from: fy?.startDate ?? `${today.slice(0, 4)}-01-01`, to };
}

function useReport<T>(path: string | null) {
  const companyId = useWorkspace().company?.id;
  return useQuery({
    queryKey: ["reports", companyId, path],
    queryFn: () => get<T>(`/api/companies/${companyId}/reports/${path}`),
    enabled: Boolean(companyId && path),
  });
}

const hu = (filler: number) => (filler === 0 ? "" : formatHuf(filler, { withUnit: false }));

function Actions({ spec }: { spec: () => ExportSpec | null }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="row no-print">
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={async () => {
          const sp = spec();
          if (!sp) return;
          setBusy(true);
          try {
            await exportXlsx(sp);
          } finally {
            setBusy(false);
          }
        }}
      >
        Excel (.xlsx)
      </button>
      <button
        type="button"
        className="btn"
        onClick={() => {
          const sp = spec();
          if (sp) exportCsv(sp);
        }}
      >
        CSV
      </button>
      <button type="button" className="btn" onClick={() => window.print()}>
        Nyomtatás / PDF
      </button>
    </div>
  );
}

/** A kimutatás fejléce: a cég adatai és a kimutatás címe (nyomtatásban is). */
function ReportHeading({ company, title, period, notice }: { company: ReportCompany; title: string; period: string; notice?: ReactNode }) {
  return (
    <header className="report-heading">
      {notice}
      <div className="report-company">
        <strong>{company.name}</strong>
        <span>
          Adószám: {company.taxNumber}
          {company.registrationNumber && ` · Cégjegyzékszám: ${company.registrationNumber}`}
        </span>
        {company.address && <span>{company.address}</span>}
      </div>
      <h2 className="report-title">{title}</h2>
      <p className="report-period">{period}</p>
    </header>
  );
}

function Shell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <>
      <div className="no-print">
        <SubNav label="Kimutatások almenü" items={TABS} />
      </div>
      <div className="no-print">
        <PageHeader title={title} description={description} />
      </div>
      {children}
    </>
  );
}

// ---------- Főkönyvi kivonat ----------

export function TrialBalancePage() {
  const def = useDefaultPeriod();
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const q = useReport<TrialBalanceDto>(from && to ? `trial-balance?from=${from}&to=${to}` : null);
  const d = q.data;
  const cols = ["opening", "period", "cumulative", "closing"] as const;
  const spec = (): ExportSpec | null => {
    if (!d) return null;
    const pair = (x: { debit: number; credit: number }) => [ftValue(x.debit), ftValue(x.credit)];
    return {
      fileName: `fokonyvi-kivonat_${from}_${to}`,
      title: "Főkönyvi kivonat",
      company: d.company,
      period: `${formatDateHu(d.from)} – ${formatDateHu(d.to)} · összegek Ft-ban`,
      landscape: true,
      columns: [
        { header: "Számla", width: 10 },
        { header: "Megnevezés", width: 40 },
        ...["Nyitó", "Időszaki", "Halmozott", "Záró"].flatMap((h) => [
          { header: `${h} T`, numeric: true, width: 15 },
          { header: `${h} K`, numeric: true, width: 15 },
        ]),
      ],
      rows: [
        ...d.classTotals.flatMap((ct) => [
          ...d.rows.filter((r) => r.accountClass === ct.accountClass).map((r) => ({ cells: [r.number, r.name, ...cols.flatMap((k) => pair(r[k]))] })),
          { cells: [`${ct.accountClass}.`, `${ct.accountClass}. számlaosztály összesen`, ...cols.flatMap((k) => pair(ct[k]))], kind: "subtotal" as const },
        ]),
        ...(d.unclosedPriorResult
          ? [{ cells: ["", "Korábbi évek le nem zárt eredménye", ...pair(d.unclosedPriorResult), 0, 0, 0, 0, ...pair(d.unclosedPriorResult)] }]
          : []),
        { cells: ["", "Összesen", ...cols.flatMap((k) => pair(d.totals[k]))], kind: "total" as const },
      ],
    };
  };
  const cells = (x: Record<(typeof cols)[number], { debit: number; credit: number }>) =>
    cols.flatMap((k) => [
      <td key={`${k}d`} className="num">
        {hu(x[k].debit)}
      </td>,
      <td key={`${k}c`} className="num">
        {hu(x[k].credit)}
      </td>,
    ]);
  return (
    <Shell title="Főkönyvi kivonat" description="Számlánként nyitó egyenleg, időszaki és halmozott forgalom, záró egyenleg (Szt. 164. § (2)).">
      <div className="toolbar no-print">
        <Field label="Időszak kezdete">{(p) => <DateInput controlProps={p} value={from} onChange={setFrom} />}</Field>
        <Field label="Időszak vége">{(p) => <DateInput controlProps={p} value={to} onChange={setTo} />}</Field>
        <Actions spec={spec} />
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {d && (
        <div className="card report">
          <ReportHeading company={d.company} title="Főkönyvi kivonat" period={`${formatDateHu(d.from)} – ${formatDateHu(d.to)} · összegek Ft-ban`} />
          <div className="table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th scope="col" rowSpan={2}>
                    Számla
                  </th>
                  <th scope="colgroup" colSpan={2} className="num">
                    Nyitó egyenleg
                  </th>
                  <th scope="colgroup" colSpan={2} className="num">
                    Időszaki forgalom
                  </th>
                  <th scope="colgroup" colSpan={2} className="num">
                    Halmozott forgalom
                  </th>
                  <th scope="colgroup" colSpan={2} className="num">
                    Záró egyenleg
                  </th>
                </tr>
                <tr>
                  {cols.flatMap((k) => [
                    <th key={`${k}d`} scope="col" className="num">
                      Tartozik
                    </th>,
                    <th key={`${k}c`} scope="col" className="num">
                      Követel
                    </th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {d.classTotals.map((ct) => (
                  <ClassRows key={ct.accountClass} ct={ct} rows={d.rows.filter((r) => r.accountClass === ct.accountClass)} cells={cells} />
                ))}
                {d.unclosedPriorResult && (
                  <tr>
                    <td>
                      Korábbi évek le nem zárt eredménye <span className="muted small">(az évzárás után az eredménytartalékon)</span>
                    </td>
                    {cells({ opening: d.unclosedPriorResult, period: { debit: 0, credit: 0 }, cumulative: { debit: 0, credit: 0 }, closing: d.unclosedPriorResult })}
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Összesen</th>
                  {cells(d.totals)}
                </tr>
              </tfoot>
            </table>
          </div>
          {cols.some((k) => d.totals[k].debit !== d.totals[k].credit) ? (
            <p className="error">A tartozik és követel összesen nem egyezik – kérjük, jelezze a hibát.</p>
          ) : (
            <p className="balance-ok small">Ellenőrzés: minden oszlopban Σ tartozik = Σ követel.</p>
          )}
        </div>
      )}
    </Shell>
  );
}

function ClassRows({
  ct,
  rows,
  cells,
}: {
  ct: TrialBalanceDto["classTotals"][number];
  rows: TrialBalanceDto["rows"];
  cells: (x: TrialBalanceDto["totals"]) => ReactNode[];
}) {
  return (
    <>
      {rows.map((r) => (
        <tr key={r.accountId}>
          <td>
            <Link to={`/kimutatasok/karton?szamla=${r.accountId}`} className="mono">
              {r.number}
            </Link>{" "}
            {r.name}
          </td>
          {cells(r)}
        </tr>
      ))}
      <tr className="report-subtotal">
        <th scope="row">
          {ct.accountClass}. számlaosztály összesen <span className="muted small">({ct.label})</span>
        </th>
        {cells(ct)}
      </tr>
    </>
  );
}

// ---------- Naplófőkönyv ----------

export function JournalPage() {
  const def = useDefaultPeriod();
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const q = useReport<JournalDto>(from && to ? `journal?from=${from}&to=${to}` : null);
  const d = q.data;
  const spec = (): ExportSpec | null =>
    d ? {
      fileName: `naplofokonyv_${from}_${to}`,
      title: "Naplófőkönyv",
      company: d.company,
      period: `${formatDateHu(d.from)} – ${formatDateHu(d.to)} · összegek Ft-ban`,
      landscape: true,
      columns: [
        { header: "Dátum", width: 12 },
        { header: "Bizonylat", width: 18 },
        { header: "Partner", width: 24 },
        { header: "Szöveg", width: 36 },
        { header: "Számla", width: 9 },
        { header: "Számla neve", width: 30 },
        { header: "Tartozik", numeric: true },
        { header: "Követel", numeric: true },
      ],
      rows: [
        ...d.rows.map((r) => ({ cells: [formatDateHu(r.date), r.serialNumber, r.partnerName, r.description, r.accountNumber, r.accountName, r.debit ? ftValue(r.debit) : null, r.credit ? ftValue(r.credit) : null] })),
        { cells: ["", "", "", `Összesen (${d.rows.length} tétel)`, "", "", ftValue(d.totals.debit), ftValue(d.totals.credit)], kind: "total" as const },
      ],
    } : null;
  return (
    <Shell title="Naplófőkönyv" description="A könyvelt tételek időrendben, számlával, tartozik és követel oldallal (Szt. 169. § (1)).">
      <div className="toolbar no-print">
        <Field label="Időszak kezdete">{(p) => <DateInput controlProps={p} value={from} onChange={setFrom} />}</Field>
        <Field label="Időszak vége">{(p) => <DateInput controlProps={p} value={to} onChange={setTo} />}</Field>
        <Actions spec={spec} />
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {d && (
        <div className="card report">
          <ReportHeading company={d.company} title="Naplófőkönyv" period={`${formatDateHu(d.from)} – ${formatDateHu(d.to)} · összegek Ft-ban`} />
          {d.truncated && <p className="alert alert-warning">Az időszakban túl sok tétel van; csak az első 20 000 látszik. Válasszon rövidebb időszakot.</p>}
          <div className="table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th scope="col">Dátum</th>
                  <th scope="col">Bizonylat</th>
                  <th scope="col">Szöveg</th>
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
                {d.rows.map((r, i) => (
                  <tr key={`${r.documentId}-${i}`}>
                    <td className="nowrap">{formatDateHu(r.date)}</td>
                    <td className="mono nowrap">
                      <Link to={`/konyveles/${r.documentId}`}>{r.serialNumber}</Link>
                    </td>
                    <td>
                      {r.description}
                      {r.partnerName && <div className="muted small">{r.partnerName}</div>}
                    </td>
                    <td>
                      <span className="mono">{r.accountNumber}</span> {r.accountName}
                    </td>
                    <td className="num">{hu(r.debit)}</td>
                    <td className="num">{hu(r.credit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={4}>
                    Összesen ({d.rows.length} tétel)
                  </th>
                  <td className="num">{formatHuf(d.totals.debit, { withUnit: false })}</td>
                  <td className="num">{formatHuf(d.totals.credit, { withUnit: false })}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </Shell>
  );
}

// ---------- Karton ----------

export function LedgerPage() {
  const def = useDefaultPeriod();
  const accounts = useAccounts();
  const partners = usePartners();
  const [search] = useSearchParams();
  const [accountId, setAccountId] = useState<string | null>(search.get("szamla"));
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const params = new URLSearchParams({ from, to, ...(accountId ? { accountId } : {}), ...(partnerId ? { partnerId } : {}) });
  const q = useReport<LedgerDto>((accountId || partnerId) && from && to ? `ledger?${params}` : null);
  const d = q.data;
  const subject = d ? [d.account && `${d.account.number} ${d.account.name}`, d.partner?.name].filter(Boolean).join(" · ") : "";
  const spec = (): ExportSpec | null =>
    d ? {
      fileName: `karton_${from}_${to}`,
      title: `Karton – ${subject}`,
      company: d.company,
      period: `${formatDateHu(d.from)} – ${formatDateHu(d.to)} · összegek Ft-ban`,
      columns: [
        { header: "Dátum", width: 12 },
        { header: "Bizonylat", width: 18 },
        { header: "Számla", width: 9 },
        { header: "Partner", width: 24 },
        { header: "Szöveg", width: 36 },
        { header: "Tartozik", numeric: true },
        { header: "Követel", numeric: true },
        { header: "Egyenleg", numeric: true },
      ],
      rows: [
        { cells: ["", "", "", "", "Nyitó egyenleg", null, null, ftValue(d.opening)], kind: "subtotal" as const },
        ...d.rows.map((r) => ({ cells: [formatDateHu(r.date), r.serialNumber, r.accountNumber, r.partnerName, r.description, r.debit ? ftValue(r.debit) : null, r.credit ? ftValue(r.credit) : null, ftValue(r.balance)] })),
        { cells: ["", "", "", "", "Forgalom és záró egyenleg", ftValue(d.totals.debit), ftValue(d.totals.credit), ftValue(d.closing)], kind: "total" as const },
      ],
    } : null;
  return (
    <Shell title="Karton" description="Egy számla vagy egy partner tételei futó egyenleggel (tartozik − követel).">
      <div className="toolbar no-print">
        <Field label="Számla">
          {(p) => <AccountPicker accounts={accounts.data ?? []} value={accountId} onChange={setAccountId} controlProps={p} />}
        </Field>
        <Field label="Partner">{(p) => <PartnerPicker partners={partners.data ?? []} value={partnerId} onChange={(x) => setPartnerId(x?.id ?? null)} controlProps={p} />}</Field>
        <Field label="Időszak kezdete">{(p) => <DateInput controlProps={p} value={from} onChange={setFrom} />}</Field>
        <Field label="Időszak vége">{(p) => <DateInput controlProps={p} value={to} onChange={setTo} />}</Field>
        <Actions spec={spec} />
      </div>
      {!accountId && !partnerId && <p className="muted">Válasszon számlát vagy partnert (vagy mindkettőt, pl. 454 + egy szállító).</p>}
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {d && (
        <div className="card report">
          <ReportHeading company={d.company} title={`Karton – ${subject}`} period={`${formatDateHu(d.from)} – ${formatDateHu(d.to)} · összegek Ft-ban`} />
          <div className="table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th scope="col">Dátum</th>
                  <th scope="col">Bizonylat</th>
                  <th scope="col">Szöveg</th>
                  <th scope="col" className="num">
                    Tartozik
                  </th>
                  <th scope="col" className="num">
                    Követel
                  </th>
                  <th scope="col" className="num">
                    Egyenleg
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="report-subtotal">
                  <td colSpan={5}>Nyitó egyenleg</td>
                  <td className="num">{formatHuf(d.opening, { withUnit: false })}</td>
                </tr>
                {d.rows.map((r, i) => (
                  <tr key={`${r.documentId}-${i}`}>
                    <td className="nowrap">{formatDateHu(r.date)}</td>
                    <td className="mono nowrap">
                      <Link to={`/konyveles/${r.documentId}`}>{r.serialNumber}</Link>
                    </td>
                    <td>
                      {r.description}
                      <div className="muted small">
                        {r.accountNumber}
                        {r.partnerName && ` · ${r.partnerName}`}
                      </div>
                    </td>
                    <td className="num">{hu(r.debit)}</td>
                    <td className="num">{hu(r.credit)}</td>
                    <td className="num">{formatHuf(r.balance, { withUnit: false })}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={3}>
                    Forgalom és záró egyenleg
                  </th>
                  <td className="num">{formatHuf(d.totals.debit, { withUnit: false })}</td>
                  <td className="num">{formatHuf(d.totals.credit, { withUnit: false })}</td>
                  <td className="num">
                    <strong>{formatHuf(d.closing, { withUnit: false })}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </Shell>
  );
}

// ---------- Mérleg és eredménykimutatás ----------

/**
 * Belső kimutatásként a fejlécben „Belső kimutatás – nem minősül közzétett
 * beszámolónak”. Közzétételi példánynál ez elmarad, helyette – ha a
 * beszámolót könyvvizsgáló nem ellenőrzi – az Szt. 154. § (3) szerinti
 * kötelező szöveg szerepel.
 */
function StatementView({ d, kind, unit, detailed, publication }: { d: StatementDto; kind: "BS" | "IS"; unit: "HUF" | "THOUSAND"; detailed: boolean; publication: boolean }) {
  const fmt = (v: number | null) => (v === null ? "–" : unit === "THOUSAND" ? toThousandHuf(v).toLocaleString("hu-HU") : formatHuf(v, { withUnit: false }));
  const lines = d.lines.filter((l) => (detailed ? true : l.simplified));
  const title = kind === "BS" ? "Mérleg („A” változat)" : "Eredménykimutatás (összköltség-eljárással)";
  const period = kind === "BS" ? `Fordulónap: ${formatDateHu(d.to)}` : `${formatDateHu(d.from)} – ${formatDateHu(d.to)}`;
  const unitLabel = unit === "THOUSAND" ? "ezer Ft" : "Ft";
  const totalRow = (label: string, cur: number, prev: number | null) => (
    <tr className="report-total">
      <th scope="row" colSpan={2}>
        {label}
      </th>
      <td className="num">{fmt(prev)}</td>
      <td className="num">{fmt(cur)}</td>
    </tr>
  );
  return (
    <div className="card report">
      <ReportHeading
        company={d.company}
        title={title}
        period={`${period} · adatok ${unitLabel}-ban`}
        notice={!publication && <p className="report-notice">{INTERNAL_STATEMENT_HEADER}</p>}
      />
      {publication && !d.company.audited && <p className="report-notice">{NOT_AUDITED_NOTICE}</p>}
      <div className="table-wrap">
        <table className="report-table statement-table">
          <thead>
            <tr>
              <th scope="col">Sor</th>
              <th scope="col">Megnevezés</th>
              <th scope="col" className="num">
                Előző év{d.previous ? ` (${formatDateHu(d.previous.to)})` : ""}
              </th>
              <th scope="col" className="num">
                Tárgyév
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <Fragment key={l.code}>
                <tr className={l.formula ? "report-total" : l.depth === 0 ? "report-subtotal" : undefined}>
                  <td className="mono nowrap">{l.code}</td>
                  <td style={{ paddingLeft: `${0.6 + (detailed ? l.depth : Math.min(l.depth, 1)) * 1.2}rem` }}>
                    {l.ofWhich ? <em>{l.label}</em> : l.label}
                  </td>
                  <td className="num">{fmt(l.previous)}</td>
                  <td className="num">{fmt(l.value)}</td>
                </tr>
                {kind === "BS" && l.code === "C" && d.totals && totalRow("ESZKÖZÖK (AKTÍVÁK) ÖSSZESEN", d.totals.assets, d.totals.previousAssets)}
              </Fragment>
            ))}
            {kind === "BS" && d.totals && totalRow("FORRÁSOK (PASSZÍVÁK) ÖSSZESEN", d.totals.sources, d.totals.previousSources)}
          </tbody>
        </table>
      </div>
      <footer className="report-footer">
        <p>{INTERNAL_STATEMENT_FOOTER}</p>
        <div className="signature">
          <span>Kelt: ……………………, ………… év …… hó …… nap</span>
          <span className="signature-line">
            {d.company.representativeName ?? "………………………………"}
            <br />a vállalkozás képviselője
          </span>
        </div>
      </footer>
    </div>
  );
}

function StatementPage({ kind }: { kind: "BS" | "IS" }) {
  const def = useDefaultPeriod();
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [unit, setUnit] = useState<"HUF" | "THOUSAND">("HUF");
  const [detailed, setDetailed] = useState(false);
  const [publication, setPublication] = useState(false);
  const path = kind === "BS" ? (to ? `balance-sheet?asOf=${to}` : null) : from && to ? `income-statement?from=${from}&to=${to}` : null;
  const q = useReport<StatementDto>(path);
  const d = q.data;
  const spec = (): ExportSpec | null => {
    if (!d) return null;
    const v = (x: number | null) => (x === null ? null : unit === "THOUSAND" ? toThousandHuf(x) : ftValue(x));
    const rows: ExportSpec["rows"] = [];
    for (const l of d.lines.filter((x) => detailed || x.simplified)) {
      rows.push({ cells: [l.code, `${"   ".repeat(detailed ? l.depth : Math.min(l.depth, 1))}${l.label}`, v(l.previous), v(l.value)], kind: l.formula ? "total" : l.depth === 0 ? "subtotal" : undefined });
      if (kind === "BS" && l.code === "C" && d.totals) rows.push({ cells: ["", "ESZKÖZÖK (AKTÍVÁK) ÖSSZESEN", v(d.totals.previousAssets), v(d.totals.assets)], kind: "total" });
    }
    if (kind === "BS" && d.totals) rows.push({ cells: ["", "FORRÁSOK (PASSZÍVÁK) ÖSSZESEN", v(d.totals.previousSources), v(d.totals.sources)], kind: "total" });
    return {
      fileName: `${kind === "BS" ? "merleg" : "eredmenykimutatas"}_${d.to}`,
      title: kind === "BS" ? "Mérleg („A” változat)" : "Eredménykimutatás (összköltség-eljárással)",
      company: d.company,
      period: `${kind === "BS" ? `Fordulónap: ${formatDateHu(d.to)}` : `${formatDateHu(d.from)} – ${formatDateHu(d.to)}`} · adatok ${unit === "THOUSAND" ? "ezer Ft" : "Ft"}-ban`,
      notice: publication ? (d.company.audited ? null : NOT_AUDITED_NOTICE) : INTERNAL_STATEMENT_HEADER,
      footer: INTERNAL_STATEMENT_FOOTER,
      signature: true,
      columns: [
        { header: "Sor", width: 9 },
        { header: "Megnevezés", width: 58 },
        { header: `Előző év${d.previous ? ` (${formatDateHu(d.previous.to)})` : ""}`, numeric: true, width: 18 },
        { header: "Tárgyév", numeric: true, width: 18 },
      ],
      rows,
    };
  };
  const balanced = !d?.totals || d.totals.assets === d.totals.sources;
  return (
    <Shell
      title={kind === "BS" ? "Mérleg" : "Eredménykimutatás"}
      description={
        kind === "BS"
          ? "Egyszerűsített éves beszámoló mérlege, „A” változat (Szt. 1. számú melléklet), tárgyév és előző év."
          : "Összköltség-eljárással (Szt. 2. számú melléklet); az előző év oszlopa az egy évvel korábbi azonos időszak."
      }
    >
      <div className="toolbar no-print">
        {kind === "IS" && <Field label="Időszak kezdete">{(p) => <DateInput controlProps={p} value={from} onChange={setFrom} />}</Field>}
        <Field label={kind === "BS" ? "Fordulónap" : "Időszak vége"}>{(p) => <DateInput controlProps={p} value={to} onChange={setTo} />}</Field>
        <Field label="Pénzegység">
          {(p) => (
            <select {...p} value={unit} onChange={(e) => setUnit(e.target.value as "HUF" | "THOUSAND")}>
              <option value="HUF">Ft</option>
              <option value="THOUSAND">ezer Ft</option>
            </select>
          )}
        </Field>
        <label className="checkbox-row">
          <input type="checkbox" checked={detailed} onChange={(e) => setDetailed(e.target.checked)} /> Részletes sorok
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={publication} onChange={(e) => setPublication(e.target.checked)} /> Közzétételi példány
        </label>
        <Actions spec={spec} />
      </div>
      {publication && (
        <p className="muted small no-print">
          Közzétételi példány: a belső kimutatás felirata elmarad;{" "}
          {d?.company.audited
            ? "a cégadatok szerint a beszámolót könyvvizsgáló ellenőrzi."
            : "mivel a cégadatok szerint nincs könyvvizsgálat, az Szt. 154. § (3) szerinti szöveg szerepel rajta."}{" "}
          A hivatalos beszámolót az e-beszámoló felületen kell benyújtani.
        </p>
      )}
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {d && d.unmapped.length > 0 && (
        <div className="alert alert-warning no-print">
          <strong>Kimutatássor nélküli számlák</strong> – ezek egyenlege nem szerepel a kimutatásban
          {kind === "BS" && !balanced && ", ezért az eszközök és a források nem egyeznek"}:{" "}
          {d.unmapped.map((u) => `${u.number} ${u.name} (${formatHuf(u.amount)})`).join(", ")}.{" "}
          <Link to="/beallitasok/szamlatukor">Hozzárendelés a számlatükörben</Link>
        </div>
      )}
      {d && kind === "BS" && balanced && <p className="balance-ok small no-print">Ellenőrzés: eszközök összesen = források összesen.</p>}
      {d && <StatementView d={d} kind={kind} unit={unit} detailed={detailed} publication={publication} />}
    </Shell>
  );
}

export const BalanceSheetPage = () => <StatementPage kind="BS" />;
export const IncomeStatementPage = () => <StatementPage kind="IS" />;
