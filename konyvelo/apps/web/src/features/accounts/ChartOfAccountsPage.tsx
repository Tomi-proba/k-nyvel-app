import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";
import {
  BALANCE_SHEET_LINES,
  INCOME_STATEMENT_LINES,
  ACCOUNT_NATURE_LABELS,
  ACCOUNT_NATURES,
  NORMAL_SIDE_LABELS,
  SUBLEDGER_LABELS,
  SUBLEDGERS,
  searchAccounts,
  type AccountNature,
  type NormalSide,
  type Subledger,
} from "@konyvelo/domain";
import { accountCreateSchema, accountUpdateSchema, type AccountDto } from "@konyvelo/shared";
import { useWorkspace } from "../../app/workspace";
import { del, patch, post } from "../../lib/api";
import { submitOnCtrlEnter, useZodForm } from "../../lib/form";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { ErrorSummary, Field } from "../../ui/Field";
import { ErrorBox, Loading, PageHeader } from "../../ui/Page";
import { useToast } from "../../ui/Toasts";
import { HelpTip } from "../../ui/Tooltip";
import { accountsKey, useAccounts } from "./useAccounts";

type FormValues = {
  number: string;
  name: string;
  nature: AccountNature | "";
  normalSide: NormalSide | "";
  subledger: Subledger | "";
  description: string;
  isActive: boolean;
  bsLineDebit: string;
  bsLineCredit: string;
  isLine: string;
};

/** Melyik kimutatásba kerülhet a számla (Szt. 160. § (2)–(5)). */
function reportKind(number: string): "BS" | "IS" | "NONE" {
  if (!/^\d/.test(number) || number.startsWith("49")) return "NONE";
  const c = number[0]!;
  if ("1234".includes(c)) return "BS";
  if ("589".includes(c)) return "IS";
  return "NONE";
}

const lineOptionLabel = (l: { code: string; label: string; ofWhich?: boolean }) => {
  const depth = l.code.split(".").length - 1;
  return `${"\u00a0\u00a0".repeat(depth)}${l.code} ${l.label}`;
};
const BS_OPTIONS = BALANCE_SHEET_LINES;
const IS_OPTIONS = INCOME_STATEMENT_LINES.filter((l) => !l.formula);

/** Hiányzik-e a kimutatássor egy könyvelhető, aktív számlánál? */
export function missingMapping(a: AccountDto): boolean {
  if (!a.isActive || a.hasChildren) return false;
  const kind = reportKind(a.number);
  if (kind === "BS") return !a.bsLineDebit || !a.bsLineCredit;
  if (kind === "IS") return !a.isLine && !a.number.startsWith("59");
  return false;
}

/** Új számla, illetve meglévő szerkesztése párbeszédablakban. */
function AccountDialog({
  account,
  open,
  onOpenChange,
}: {
  account: AccountDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const ws = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const companyId = ws.company!.id;
  const editing = account !== null;
  const initial: FormValues = {
    number: account?.number ?? "",
    name: account?.name ?? "",
    nature: account?.nature ?? "",
    normalSide: account?.normalSide ?? "",
    subledger: account?.subledger ?? "",
    description: account?.description ?? "",
    isActive: account?.isActive ?? true,
    bsLineDebit: account?.bsLineDebit ?? "",
    bsLineCredit: account?.bsLineCredit ?? "",
    isLine: account?.isLine ?? "",
  };
  const toPayload = (v: FormValues) => {
    const base = {
      name: v.name,
      description: v.description,
      ...(v.nature ? { nature: v.nature } : {}),
      ...(v.normalSide ? { normalSide: v.normalSide } : {}),
      ...(v.subledger ? { subledger: v.subledger } : {}),
      // Új számlánál az üres mező öröklést jelent (a szülőtől), szerkesztésnél törlést.
      ...(editing || v.bsLineDebit ? { bsLineDebit: v.bsLineDebit || null } : {}),
      ...(editing || v.bsLineCredit ? { bsLineCredit: v.bsLineCredit || null } : {}),
      ...(editing || v.isLine ? { isLine: v.isLine || null } : {}),
    };
    return editing ? { ...base, isActive: v.isActive } : { ...base, number: v.number };
  };
  const form = useZodForm(editing ? accountUpdateSchema : accountCreateSchema, initial, toPayload);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" aria-describedby={undefined}>
          <Dialog.Title asChild>
            <h2>{editing ? `${account.number} számla szerkesztése` : "Új főkönyvi számla"}</h2>
          </Dialog.Title>
          <form
            className="form"
            noValidate
            onKeyDown={submitOnCtrlEnter}
            onSubmit={(e) => {
              e.preventDefault();
              void form
                .submit(async (data) => {
                  if (editing) await patch(`/api/companies/${companyId}/accounts/${account.id}`, data);
                  else await post(`/api/companies/${companyId}/accounts`, data);
                })
                .then(async (ok) => {
                  if (!ok) return;
                  await queryClient.invalidateQueries({ queryKey: accountsKey(companyId) });
                  toast("success", editing ? "A számla módosítása sikerült." : `A(z) ${form.values.number} számla létrejött.`);
                  onOpenChange(false);
                });
            }}
          >
            <ErrorSummary message={form.formError} />
            <div className="form-row">
              <Field
                label="Számlaszám"
                error={form.errors.number}
                hint={editing ? "A számlaszám nem módosítható." : "1–8 számjegy; a jelleg és az analitika a szülőszámlától öröklődik."}
                required={!editing}
              >
                {(p) => (
                  <input
                    {...p}
                    inputMode="numeric"
                    autoFocus={!editing}
                    readOnly={editing}
                    value={form.values.number}
                    onChange={(e) => form.set("number", e.target.value)}
                    onBlur={() => form.blur("number")}
                  />
                )}
              </Field>
              <Field label="Megnevezés" error={form.errors.name} required>
                {(p) => (
                  <input {...p} autoFocus={editing} value={form.values.name} onChange={(e) => form.set("name", e.target.value)} onBlur={() => form.blur("name")} />
                )}
              </Field>
            </div>
            <div className="form-row">
              <Field label="Jelleg" error={form.errors.nature} help="szamlaJelleg">
                {(p) => (
                  <select {...p} value={form.values.nature} onChange={(e) => form.set("nature", e.target.value as FormValues["nature"])}>
                    {!editing && <option value="">Automatikus (szülő vagy számlaosztály szerint)</option>}
                    {ACCOUNT_NATURES.map((n) => (
                      <option key={n} value={n}>
                        {ACCOUNT_NATURE_LABELS[n]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Szokásos egyenleg" error={form.errors.normalSide} help="szokasosEgyenleg">
                {(p) => (
                  <select {...p} value={form.values.normalSide} onChange={(e) => form.set("normalSide", e.target.value as FormValues["normalSide"])}>
                    {!editing && <option value="">Automatikus</option>}
                    <option value="D">{NORMAL_SIDE_LABELS.D}</option>
                    <option value="C">{NORMAL_SIDE_LABELS.C}</option>
                  </select>
                )}
              </Field>
              <Field label="Analitika" error={form.errors.subledger} help="analitika">
                {(p) => (
                  <select {...p} value={form.values.subledger} onChange={(e) => form.set("subledger", e.target.value as FormValues["subledger"])}>
                    {!editing && <option value="">Automatikus</option>}
                    {SUBLEDGERS.map((s) => (
                      <option key={s} value={s}>
                        {SUBLEDGER_LABELS[s]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            {reportKind(form.values.number) === "BS" && (
              <div className="form-row">
                <Field label="Mérlegsor tartozik egyenlegnél" error={form.errors.bsLineDebit} help="kimutatasSor">
                  {(p) => (
                    <select {...p} value={form.values.bsLineDebit} onChange={(e) => form.set("bsLineDebit", e.target.value)}>
                      <option value="">{editing ? "Nincs hozzárendelve" : "Öröklés a szülőszámlától"}</option>
                      {BS_OPTIONS.map((l) => (
                        <option key={l.code} value={l.code}>
                          {lineOptionLabel(l)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Mérlegsor követel egyenlegnél" error={form.errors.bsLineCredit}>
                  {(p) => (
                    <select {...p} value={form.values.bsLineCredit} onChange={(e) => form.set("bsLineCredit", e.target.value)}>
                      <option value="">{editing ? "Nincs hozzárendelve" : "Öröklés a szülőszámlától"}</option>
                      {BS_OPTIONS.map((l) => (
                        <option key={l.code} value={l.code}>
                          {lineOptionLabel(l)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
            )}
            {reportKind(form.values.number) === "IS" && (
              <Field label="Eredménykimutatás-sor" error={form.errors.isLine} help="kimutatasSor">
                {(p) => (
                  <select {...p} value={form.values.isLine} onChange={(e) => form.set("isLine", e.target.value)}>
                    <option value="">{editing ? "Nincs hozzárendelve" : "Öröklés a szülőszámlától"}</option>
                    {IS_OPTIONS.map((l) => (
                      <option key={l.code} value={l.code}>
                        {lineOptionLabel(l)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            <Field label="Leírás (mit könyvelünk ide)" error={form.errors.description} hint="A rögzítéskor súgóként jelenik meg.">
              {(p) => <textarea {...p} rows={3} value={form.values.description} onChange={(e) => form.set("description", e.target.value)} />}
            </Field>
            {editing && (
              <div className="checkbox-row">
                <input
                  type="checkbox"
                  id="account-active"
                  checked={form.values.isActive}
                  onChange={(e) => form.set("isActive", e.target.checked)}
                />
                <label htmlFor="account-active">Aktív (inaktív számlára nem lehet új tételt könyvelni)</label>
              </div>
            )}
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="btn">
                  Mégse
                </button>
              </Dialog.Close>
              <button type="submit" className="btn btn-primary" disabled={form.submitting}>
                {editing ? "Mentés" : "Létrehozás"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ChartOfAccountsPage() {
  const ws = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const q = useAccounts();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [showInactive, setShowInactive] = useState(true);
  const [dialog, setDialog] = useState<{ account: AccountDto | null } | null>(null);
  const canManage = ws.can("accounts:manage");
  const companyId = ws.company?.id ?? "";

  const rows = useMemo(() => {
    const all = (q.data ?? []).filter((a) => showInactive || a.isActive);
    return deferredSearch.trim() ? searchAccounts(all, deferredSearch, 500) : all;
  }, [q.data, deferredSearch, showInactive]);

  const unmapped = useMemo(() => (q.data ?? []).filter(missingMapping), [q.data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: accountsKey(companyId) });

  return (
    <>
      <PageHeader
        title="Számlatükör"
        description={
          <span className="row">
            A cég főkönyvi számlái az egységes számlakeret szerint. <HelpTip term="szamlatukor" />
          </span>
        }
        actions={
          canManage && (
            <button type="button" className="btn btn-primary" onClick={() => setDialog({ account: null })}>
              Új számla
            </button>
          )
        }
      />
      {!canManage && <div className="alert alert-info">A számlatükröt Adminisztrátor vagy Vezető könyvelő módosíthatja.</div>}
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}

      {q.data && q.data.length === 0 && (
        <div className="card">
          <p>A cégnek még nincs számlatükre.</p>
          {canManage && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                try {
                  const r = await post<{ count: number }>(`/api/companies/${companyId}/accounts/load-default`);
                  await refresh();
                  toast("success", `Az alapértelmezett számlatükör betöltve (${r.count} számla).`);
                } catch (err) {
                  toast("error", err instanceof Error ? err.message : "Váratlan hiba történt.");
                }
              }}
            >
              Alapértelmezett számlatükör betöltése
            </button>
          )}
        </div>
      )}

      {q.data && q.data.length > 0 && (
        <>
          {unmapped.length > 0 && (
            <div className="alert alert-info" role="status">
              <strong>{unmapped.length} könyvelhető számla nincs kimutatássorhoz rendelve</strong>, ezért nem jelenne meg a mérlegben, illetve az
              eredménykimutatásban: {unmapped.slice(0, 8).map((a) => a.number).join(", ")}
              {unmapped.length > 8 ? "…" : ""}. A Szerkesztés gombbal pótolható.
            </div>
          )}
          <div className="toolbar" role="search">
            <Field label="Keresés számra vagy névre" hint="Pl. 38 vagy „szállító”">
              {(p) => <input {...p} type="search" value={search} onChange={(e) => setSearch(e.target.value)} />}
            </Field>
            <div className="checkbox-row">
              <input type="checkbox" id="show-inactive" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              <label htmlFor="show-inactive">Inaktív számlák is</label>
            </div>
            <span className="muted" aria-live="polite">
              {rows.length} számla
            </span>
          </div>

          <div className="card table-wrap">
            <table>
              <caption className="sr-only">Főkönyvi számlák</caption>
              <thead>
                <tr>
                  <th scope="col">Számlaszám</th>
                  <th scope="col">Megnevezés</th>
                  <th scope="col">
                    <span className="row">
                      Analitika <HelpTip term="analitika" />
                    </span>
                  </th>
                  <th scope="col">Egyenleg</th>
                  <th scope="col">
                    <span className="row">
                      Kimutatássor <HelpTip term="kimutatasSor" />
                    </span>
                  </th>
                  <th scope="col">Állapot</th>
                  {canManage && (
                    <th scope="col">
                      <span className="sr-only">Műveletek</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr
                    key={a.id}
                    className={[a.level === 0 ? "account-row-class" : a.hasChildren ? "account-row-group" : "", a.isActive ? "" : "account-row-inactive"].join(" ")}
                  >
                    <td className="mono" style={{ paddingLeft: 10 + (search ? 0 : a.level * 16) }}>
                      {a.number}
                    </td>
                    <td>
                      {a.name}
                      {a.description && <div className="muted" style={{ fontSize: "0.85rem", fontWeight: 400 }}>{a.description}</div>}
                    </td>
                    <td>{a.subledger === "NONE" ? "" : SUBLEDGER_LABELS[a.subledger]}</td>
                    <td>{NORMAL_SIDE_LABELS[a.normalSide]}</td>
                    <td className="mono">
                      {a.isLine ?? (a.bsLineDebit === a.bsLineCredit ? a.bsLineDebit : [a.bsLineDebit, a.bsLineCredit].filter(Boolean).join(" / "))}
                      {missingMapping(a) && <span className="badge badge-warning">Hiányzik</span>}
                    </td>
                    <td>
                      {!a.isActive ? (
                        <span className="badge">Inaktív</span>
                      ) : a.hasChildren ? (
                        <span className="badge" title="Gyűjtőszámla: alszámláira lehet könyvelni">
                          Gyűjtő
                        </span>
                      ) : (
                        <span className="badge badge-success">Könyvelhető</span>
                      )}
                    </td>
                    {canManage && (
                      <td>
                        <div className="row" style={{ flexWrap: "nowrap" }}>
                          <button type="button" className="btn btn-small" aria-label={`Szerkesztés: ${a.number} ${a.name}`} onClick={() => setDialog({ account: a })}>
                            Szerkesztés
                          </button>
                          {!a.hasChildren && (
                            <ConfirmDialog
                              trigger={
                                <button type="button" className="btn btn-small btn-danger" aria-label={`Törlés: ${a.number} ${a.name}`}>
                                  Törlés
                                </button>
                              }
                              title={`A(z) ${a.number} számla törlése`}
                              description={
                                <p>
                                  <strong>
                                    {a.number} – {a.name}
                                  </strong>{" "}
                                  véglegesen törlődik a számlatükörből. Használatban lévő számla nem törölhető; ilyenkor inaktiválja.
                                </p>
                              }
                              confirmLabel="Törlés"
                              onConfirm={async () => {
                                try {
                                  await del(`/api/companies/${companyId}/accounts/${a.id}`);
                                  await refresh();
                                  toast("success", `A(z) ${a.number} számla törölve.`);
                                } catch (err) {
                                  toast("error", err instanceof Error ? err.message : "Váratlan hiba történt.");
                                }
                              }}
                            />
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {dialog && ws.company && (
        <AccountDialog key={dialog.account?.id ?? "new"} account={dialog.account} open onOpenChange={(o) => !o && setDialog(null)} />
      )}
    </>
  );
}
