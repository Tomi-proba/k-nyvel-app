import { formatHuf, parseHufInput } from "@konyvelo/domain";
import {
  companyCreateSchema,
  FX_RATE_SOURCE_LABELS,
  FX_RATE_SOURCES,
  REPORT_TYPE_LABELS,
  REPORT_TYPES,
  type CompanyCreateInput,
  type CompanyDto,
} from "@konyvelo/shared";
import { submitOnCtrlEnter, useZodForm } from "../../lib/form";
import { ErrorSummary, Field } from "../../ui/Field";

type Values = {
  name: string;
  shortName: string;
  taxNumber: string;
  communityVatNumber: string;
  registrationNumber: string;
  addressPostalCode: string;
  addressCity: string;
  addressLine: string;
  representativeName: string;
  reportType: CompanyCreateInput["reportType"];
  significantErrorThreshold: string;
  fxRateSource: CompanyCreateInput["fxRateSource"];
};

function initialValues(c?: CompanyDto): Values {
  return {
    name: c?.name ?? "",
    shortName: c?.shortName ?? "",
    taxNumber: c?.taxNumber ?? "",
    communityVatNumber: c?.communityVatNumber ?? "",
    registrationNumber: c?.registrationNumber ?? "",
    addressPostalCode: c?.addressPostalCode ?? "",
    addressCity: c?.addressCity ?? "",
    addressLine: c?.addressLine ?? "",
    representativeName: c?.representativeName ?? "",
    reportType: c?.reportType ?? "SIMPLIFIED_ANNUAL",
    significantErrorThreshold:
      c?.significantErrorThreshold != null ? formatHuf(c.significantErrorThreshold, { withUnit: false }) : "",
    fxRateSource: c?.fxRateSource ?? "MNB",
  };
}

function toPayload(v: Values) {
  const threshold = v.significantErrorThreshold.trim();
  const parsed = threshold === "" ? null : parseHufInput(threshold);
  return {
    ...v,
    // Hibás összegnél NaN-t adunk át, így a séma érthető hibát jelez.
    significantErrorThreshold: parsed === null ? null : parsed.ok ? parsed.value : Number.NaN,
  };
}

/** Cégadatok űrlapja – létrehozáshoz és szerkesztéshez is. */
export function CompanyForm({
  company,
  readOnly,
  submitLabel,
  onSubmit,
}: {
  company?: CompanyDto;
  readOnly?: boolean;
  submitLabel: string;
  onSubmit: (data: CompanyCreateInput) => Promise<unknown>;
}) {
  const form = useZodForm(companyCreateSchema, initialValues(company), toPayload);
  const text = (key: keyof Values, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) =>
    function Input(p: object) {
      return (
        <input
          {...p}
          {...extra}
          readOnly={readOnly}
          value={form.values[key]}
          onChange={(e) => form.set(key, e.target.value as never)}
          onBlur={() => form.blur(key)}
        />
      );
    };

  return (
    <form
      className="form"
      noValidate
      onKeyDown={submitOnCtrlEnter}
      onSubmit={(e) => {
        e.preventDefault();
        void form.submit(onSubmit);
      }}
    >
      <ErrorSummary message={form.formError} fields={form.formError ? form.errors : undefined} />

      <fieldset className="card" disabled={readOnly}>
        <legend>
          <strong>Alapadatok</strong>
        </legend>
        <div className="form">
          <Field label="Cégnév" error={form.errors.name} required>
            {text("name", { autoComplete: "organization", autoFocus: !company })}
          </Field>
          <div className="form-row">
            <Field label="Rövid név" error={form.errors.shortName} hint="A fejlécben és a listákban ez látszik." required>
              {text("shortName")}
            </Field>
            <Field label="Adószám" error={form.errors.taxNumber} help="adoszam" hint="Pl. 12345678-1-12" required>
              {text("taxNumber", { inputMode: "numeric" })}
            </Field>
          </div>
          <div className="form-row">
            <Field label="Közösségi adószám" error={form.errors.communityVatNumber} hint="Pl. HU12345678">
              {text("communityVatNumber")}
            </Field>
            <Field label="Cégjegyzékszám" error={form.errors.registrationNumber} hint="Pl. 01-09-123456">
              {text("registrationNumber")}
            </Field>
          </div>
        </div>
      </fieldset>

      <fieldset className="card" disabled={readOnly}>
        <legend>
          <strong>Székhely és képviselő</strong>
        </legend>
        <div className="form">
          <div className="form-row">
            <Field label="Irányítószám" error={form.errors.addressPostalCode}>
              {text("addressPostalCode", { inputMode: "numeric", autoComplete: "postal-code" })}
            </Field>
            <Field label="Település" error={form.errors.addressCity}>
              {text("addressCity", { autoComplete: "address-level2" })}
            </Field>
          </div>
          <Field label="Utca, házszám" error={form.errors.addressLine}>
            {text("addressLine", { autoComplete: "street-address" })}
          </Field>
          <Field label="Képviseletre jogosult neve" error={form.errors.representativeName} hint="A kimutatások aláírási blokkjában jelenik meg.">
            {text("representativeName")}
          </Field>
        </div>
      </fieldset>

      <fieldset className="card" disabled={readOnly}>
        <legend>
          <strong>Számviteli beállítások</strong>
        </legend>
        <div className="form">
          <Field label="A könyvvezetés pénzneme" help="konyvPenzneme">
            {(p) => <input {...p} value="Forint (HUF)" readOnly />}
          </Field>
          <Field label="Beszámolóforma" error={form.errors.reportType} help="beszamoloForma" required>
            {(p) => (
              <select {...p} value={form.values.reportType} onChange={(e) => form.set("reportType", e.target.value as Values["reportType"])}>
                {REPORT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {REPORT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <p className="muted" style={{ margin: 0 }}>
            Mérleg: „A” változat · Eredménykimutatás: összköltség-eljárás
          </p>
          <Field
            label="Jelentős összegű hiba értékhatára (Ft)"
            error={form.errors.significantErrorThreshold}
            help="jelentosHiba"
            hint="A számviteli politika szerinti összeg. Üresen hagyva a törvényi minimum érvényes (mérlegfőösszeg 2%-a, legalább 1 millió Ft)."
          >
            {text("significantErrorThreshold", { inputMode: "decimal" })}
          </Field>
          <Field label="Árfolyamforrás devizás tételekhez" error={form.errors.fxRateSource} help="arfolyamForras" required>
            {(p) => (
              <select {...p} value={form.values.fxRateSource} onChange={(e) => form.set("fxRateSource", e.target.value as Values["fxRateSource"])}>
                {FX_RATE_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {FX_RATE_SOURCE_LABELS[s]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </fieldset>

      {!readOnly && (
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={form.submitting}>
            {submitLabel}
          </button>
          <span className="muted">
            vagy <kbd>Ctrl</kbd>+<kbd>Enter</kbd>
          </span>
        </div>
      )}
    </form>
  );
}
