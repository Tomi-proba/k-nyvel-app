import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { formatDateHu, maxRegularEndDate, isValidIsoDate, compareDates } from "@konyvelo/domain";
import { fiscalYearCreateSchema, type FiscalYearDto } from "@konyvelo/shared";
import { fiscalYearsKey, useWorkspace } from "../../app/workspace";
import { get, post } from "../../lib/api";
import { fiscalYearLabel, periodLabel } from "../../lib/format";
import { submitOnCtrlEnter, useZodForm } from "../../lib/form";
import { DateInput } from "../../ui/DateInput";
import { ErrorSummary, Field } from "../../ui/Field";
import { PageHeader } from "../../ui/Page";
import { useToast } from "../../ui/Toasts";
import { HelpTip } from "../../ui/Tooltip";

const STATUS_LABELS: Record<FiscalYearDto["status"], string> = {
  OPEN: "Nyitott",
  CLOSING: "Zárás alatt",
  CLOSED: "Lezárt",
};

function NewFiscalYearForm({ companyId, onCreated }: { companyId: string; onCreated: (fy: FiscalYearDto) => void }) {
  const suggestion = useQuery({
    queryKey: ["fiscal-year-suggestion", companyId],
    queryFn: () => get<{ startDate: string; endDate: string }>(`/api/companies/${companyId}/fiscal-years/suggestion`),
  });
  const form = useZodForm(fiscalYearCreateSchema, { startDate: "", endDate: "", exceptionReason: "" });
  const { reset } = form;

  useEffect(() => {
    if (suggestion.data) reset({ ...suggestion.data, exceptionReason: "" });
  }, [suggestion.data, reset]);

  const { startDate, endDate } = form.values;
  const isLong =
    isValidIsoDate(startDate) && isValidIsoDate(endDate) && compareDates(endDate, maxRegularEndDate(startDate)) > 0;
  const year = Number(startDate.slice(0, 4)) || new Date().getFullYear();

  return (
    <form
      className="form card"
      noValidate
      aria-labelledby="uj-ev"
      onKeyDown={submitOnCtrlEnter}
      onSubmit={(e) => {
        e.preventDefault();
        void form.submit(async (data) => {
          const fy = await post<FiscalYearDto>(`/api/companies/${companyId}/fiscal-years`, data);
          onCreated(fy);
        });
      }}
    >
      <h2 id="uj-ev">Új üzleti év</h2>
      <p className="muted" style={{ margin: 0 }}>
        A dátumokat a rendszer az előző üzleti év alapján javasolja. A havi időszakok automatikusan létrejönnek.
      </p>
      <ErrorSummary message={form.formError} />
      <div className="form-row">
        <Field label="Kezdő nap" error={form.errors.startDate} help="uzletiEv" required>
          {(p) => <DateInput controlProps={p} value={startDate} defaultYear={year} onChange={(v) => form.set("startDate", v)} />}
        </Field>
        <Field label="Mérlegfordulónap (utolsó nap)" error={form.errors.endDate} help="merlegfordulonap" required>
          {(p) => <DateInput controlProps={p} value={endDate} defaultYear={year} onChange={(v) => form.set("endDate", v)} />}
        </Field>
      </div>
      {(isLong || form.errors.exceptionReason) && (
        <Field
          label="Indoklás (12 hónapnál hosszabb üzleti év)"
          error={form.errors.exceptionReason}
          help="kivetelesEv"
          hint="Pl. „Előtársasági időszak (Szt. 11. § (5))”"
          required
        >
          {(p) => (
            <input
              {...p}
              value={form.values.exceptionReason ?? ""}
              onChange={(e) => form.set("exceptionReason", e.target.value)}
            />
          )}
        </Field>
      )}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={form.submitting}>
          Üzleti év létrehozása
        </button>
      </div>
    </form>
  );
}

export function FiscalYearsPage() {
  const ws = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const company = ws.company;
  if (!company) return null;
  const canManage = ws.can("fiscalYear:manage");
  const years = [...ws.fiscalYears].reverse();

  return (
    <>
      <PageHeader
        title="Üzleti évek"
        description="Az üzleti évek folytonosak és nem fedhetik egymást (Szt. 11. §, 15. § (6))."
        actions={
          canManage &&
          !showForm && (
            <button type="button" className="btn btn-primary" onClick={() => setShowForm(true)}>
              Új üzleti év
            </button>
          )
        }
      />
      {canManage && (showForm || (!ws.fiscalYearsLoading && ws.fiscalYears.length === 0)) && (
        <NewFiscalYearForm
          companyId={company.id}
          onCreated={async (fy) => {
            await queryClient.invalidateQueries({ queryKey: fiscalYearsKey(company.id) });
            await queryClient.invalidateQueries({ queryKey: ["fiscal-year-suggestion", company.id] });
            ws.selectFiscalYear(fy.id);
            setShowForm(false);
            toast("success", `A(z) ${fiscalYearLabel(fy)} üzleti év létrejött ${fy.periods.length} havi időszakkal.`);
          }}
        />
      )}
      {!canManage && ws.fiscalYears.length === 0 && (
        <div className="alert alert-info">Még nincs üzleti év. Létrehozni Adminisztrátor vagy Vezető könyvelő tud.</div>
      )}

      {years.map((y) => (
        <section key={y.id} className="card" aria-labelledby={`fy-${y.id}`}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 id={`fy-${y.id}`} style={{ margin: 0 }}>
              {fiscalYearLabel(y)}
            </h2>
            <span className={`badge ${y.status === "OPEN" ? "badge-success" : "badge-warning"}`}>{STATUS_LABELS[y.status]}</span>
          </div>
          <p className="muted">
            {formatDateHu(y.startDate)} – {formatDateHu(y.endDate)}
            {y.exceptionReason && ` · Indoklás: ${y.exceptionReason}`}
          </p>
          <details>
            <summary>Havi időszakok ({y.periods.length})</summary>
            <p className="row muted">
              <HelpTip term="idoszak" /> Az időszakok lezárása a Zárás menüpontban lesz elérhető.
            </p>
            <div className="table-wrap">
              <table>
                <caption className="sr-only">{fiscalYearLabel(y)} havi időszakai</caption>
                <thead>
                  <tr>
                    <th scope="col">Időszak</th>
                    <th scope="col">Kezdete</th>
                    <th scope="col">Vége</th>
                    <th scope="col">Állapot</th>
                  </tr>
                </thead>
                <tbody>
                  {y.periods.map((p) => (
                    <tr key={p.id}>
                      <td>{periodLabel(p)}</td>
                      <td>{formatDateHu(p.startDate)}</td>
                      <td>{formatDateHu(p.endDate)}</td>
                      <td>{p.status === "OPEN" ? "Nyitott" : "Lezárt"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      ))}
    </>
  );
}
