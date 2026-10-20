import { useCallback } from "react";
import { PARTNER_KIND_LABELS, PARTNER_KINDS, partnerCreateSchema, type AccountDto, type PartnerCreateInput, type PartnerDto, type PartnerKind } from "@konyvelo/shared";
import { submitOnCtrlEnter, useZodForm } from "../../lib/form";
import { AccountPicker } from "../../ui/AccountPicker";
import { ErrorSummary, Field } from "../../ui/Field";
import { HelpTip } from "../../ui/Tooltip";
import { useAccounts } from "../accounts/useAccounts";

type Values = {
  kind: PartnerKind;
  name: string;
  isPrivatePerson: boolean;
  taxNumber: string;
  communityVatNumber: string;
  country: string;
  postalCode: string;
  city: string;
  addressLine: string;
  bankAccount: string;
  email: string;
  phone: string;
  paymentTermsDays: string;
  defaultReceivableAccountId: string | null;
  defaultPayableAccountId: string | null;
  defaultExpenseAccountId: string | null;
  defaultRevenueAccountId: string | null;
  notes: string;
};

function initialValues(p?: PartnerDto): Values {
  return {
    kind: p?.kind ?? "SUPPLIER",
    name: p?.name ?? "",
    isPrivatePerson: p?.isPrivatePerson ?? false,
    taxNumber: p?.taxNumber ?? "",
    communityVatNumber: p?.communityVatNumber ?? "",
    country: p?.country ?? "HU",
    postalCode: p?.postalCode ?? "",
    city: p?.city ?? "",
    addressLine: p?.addressLine ?? "",
    bankAccount: p?.bankAccount ?? "",
    email: p?.email ?? "",
    phone: p?.phone ?? "",
    paymentTermsDays: p?.paymentTermsDays != null ? String(p.paymentTermsDays) : "",
    defaultReceivableAccountId: p?.defaultReceivableAccountId ?? null,
    defaultPayableAccountId: p?.defaultPayableAccountId ?? null,
    defaultExpenseAccountId: p?.defaultExpenseAccountId ?? null,
    defaultRevenueAccountId: p?.defaultRevenueAccountId ?? null,
    notes: p?.notes ?? "",
  };
}

function toPayload(v: Values) {
  const days = v.paymentTermsDays.trim();
  return {
    ...v,
    taxNumber: v.isPrivatePerson ? "" : v.taxNumber,
    paymentTermsDays: days === "" ? null : /^\d+$/.test(days) ? Number(days) : Number.NaN,
  };
}

const isCustomerAccount = (a: AccountDto) => a.subledger === "CUSTOMER";
const isSupplierAccount = (a: AccountDto) => a.subledger === "SUPPLIER";
const isExpenseAccount = (a: AccountDto) => [1, 2, 5, 8].includes(a.accountClass);
const isRevenueAccount = (a: AccountDto) => a.accountClass === 9;

/** Partner (vevő, szállító) adatai – létrehozáshoz és szerkesztéshez. */
export function PartnerForm({
  partner,
  readOnly,
  submitLabel,
  onSubmit,
}: {
  partner?: PartnerDto;
  readOnly?: boolean;
  submitLabel: string;
  onSubmit: (data: PartnerCreateInput) => Promise<unknown>;
}) {
  const accounts = useAccounts();
  const form = useZodForm(partnerCreateSchema, initialValues(partner), toPayload);
  const v = form.values;
  const isCustomer = v.kind === "CUSTOMER" || v.kind === "BOTH";
  const isSupplier = v.kind === "SUPPLIER" || v.kind === "BOTH";

  const input = useCallback(
    (key: keyof Values, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) =>
      (p: object) => (
        <input
          {...p}
          {...extra}
          value={String(form.values[key] ?? "")}
          onChange={(e) => form.set(key, e.target.value as never)}
          onBlur={() => form.blur(key)}
        />
      ),
    [form],
  );

  const accountField = (key: "defaultReceivableAccountId" | "defaultPayableAccountId" | "defaultExpenseAccountId" | "defaultRevenueAccountId", label: string, filter: (a: AccountDto) => boolean, hint: string) => (
    <Field label={label} error={form.errors[key]} hint={hint}>
      {(p) => <AccountPicker controlProps={p} accounts={accounts.data ?? []} value={v[key]} filter={filter} onChange={(id) => form.set(key, id)} />}
    </Field>
  );

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
          <div className="form-row">
            <Field label="Típus" error={form.errors.kind} required>
              {(p) => (
                <select {...p} value={v.kind} onChange={(e) => form.set("kind", e.target.value as PartnerKind)}>
                  {PARTNER_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {PARTNER_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Ország" error={form.errors.country} hint="Kétbetűs kód: HU, DE, AT…" required>
              {input("country", { maxLength: 2, autoComplete: "country" })}
            </Field>
          </div>
          <Field label="Név" error={form.errors.name} required>
            {input("name", { autoFocus: !partner, autoComplete: "organization" })}
          </Field>
          <div className="checkbox-row">
            <input
              type="checkbox"
              id="private-person"
              checked={v.isPrivatePerson}
              onChange={(e) => form.set("isPrivatePerson", e.target.checked)}
            />
            <label htmlFor="private-person">Magánszemély</label>
            <HelpTip term="maganszemely" />
          </div>
          {!v.isPrivatePerson && (
            <div className="form-row">
              <Field label="Adószám" error={form.errors.taxNumber} help="adoszam" hint="Magyar partnernél, pl. 12345678-1-12">
                {input("taxNumber", { inputMode: "numeric" })}
              </Field>
              <Field label="Közösségi adószám" error={form.errors.communityVatNumber} hint="Pl. HU12345678, DE123456789">
                {input("communityVatNumber")}
              </Field>
            </div>
          )}
        </div>
      </fieldset>

      <fieldset className="card" disabled={readOnly}>
        <legend>
          <strong>Cím és elérhetőség</strong>
        </legend>
        <div className="form">
          <div className="form-row">
            <Field label="Irányítószám" error={form.errors.postalCode}>
              {input("postalCode", { autoComplete: "postal-code" })}
            </Field>
            <Field label="Település" error={form.errors.city}>
              {input("city", { autoComplete: "address-level2" })}
            </Field>
          </div>
          <Field label="Utca, házszám" error={form.errors.addressLine}>
            {input("addressLine", { autoComplete: "street-address" })}
          </Field>
          <div className="form-row">
            <Field label="E-mail-cím" error={form.errors.email}>
              {input("email", { type: "email", autoComplete: "email" })}
            </Field>
            <Field label="Telefonszám" error={form.errors.phone}>
              {input("phone", { type: "tel", autoComplete: "tel" })}
            </Field>
          </div>
          <Field label="Bankszámlaszám" error={form.errors.bankAccount} hint="12345678-12345678(-12345678) vagy IBAN">
            {input("bankAccount")}
          </Field>
        </div>
      </fieldset>

      <fieldset className="card" disabled={readOnly}>
        <legend>
          <span className="row">
            <strong>Alapértelmezett kontírozás</strong> <HelpTip term="alapertelmezettKontirozas" />
          </span>
        </legend>
        <div className="form">
          <div className="form-row">
            {isCustomer && accountField("defaultReceivableAccountId", "Vevő számla", isCustomerAccount, "Vevőanalitikás számla, pl. 311.")}
            {isCustomer && accountField("defaultRevenueAccountId", "Árbevétel számla", isRevenueAccount, "9. számlaosztály, pl. 912.")}
          </div>
          <div className="form-row">
            {isSupplier && accountField("defaultPayableAccountId", "Szállító számla", isSupplierAccount, "Szállítóanalitikás számla, pl. 454.")}
            {isSupplier && accountField("defaultExpenseAccountId", "Költség- vagy eszközszámla", isExpenseAccount, "Pl. 511 vagy 522.")}
          </div>
          <Field label="Fizetési határidő (nap)" error={form.errors.paymentTermsDays} hint="A számla keltétől számítva; a lejárat javaslásához.">
            {input("paymentTermsDays", { inputMode: "numeric" })}
          </Field>
          <Field label="Megjegyzés" error={form.errors.notes}>
            {(p) => <textarea {...p} rows={2} value={v.notes} onChange={(e) => form.set("notes", e.target.value)} />}
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
