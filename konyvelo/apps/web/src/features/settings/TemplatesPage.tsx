import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AMOUNT_BASE_LABELS, DOCUMENT_TYPES, type AmountBase, type LineSide } from "@konyvelo/domain";
import { AMOUNT_BASES, ENTERABLE_DOCUMENT_TYPES, type TemplateDto } from "@konyvelo/shared";
import { useWorkspace } from "../../app/workspace";
import { ApiError, del, patch, post } from "../../lib/api";
import { submitOnCtrlEnter } from "../../lib/form";
import { AccountPicker } from "../../ui/AccountPicker";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { ErrorSummary, Field } from "../../ui/Field";
import { ErrorBox, Loading, PageHeader } from "../../ui/Page";
import { useToast } from "../../ui/Toasts";
import { HelpTip } from "../../ui/Tooltip";
import { useAccounts } from "../accounts/useAccounts";
import { templatesKey, useTemplates } from "../documents/queries";

type LineForm = { key: number; accountId: string | null; side: LineSide; base: AmountBase };
type FormState = { name: string; shortcut: string; docType: string; description: string; vatRate: string; isActive: boolean; lines: LineForm[] };

let lineKey = 0;
const line = (over: Partial<LineForm> = {}): LineForm => ({ key: ++lineKey, accountId: null, side: "D", base: "NET", ...over });

const fromDto = (t: TemplateDto | null): FormState =>
  t
    ? {
        name: t.name,
        shortcut: t.shortcut ?? "",
        docType: t.docType ?? "",
        description: t.description ?? "",
        vatRate: t.vatRate == null ? "" : String(t.vatRate),
        isActive: t.isActive,
        lines: t.lines.map((l) => line(l)),
      }
    : { name: "", shortcut: "", docType: "", description: "", vatRate: "27", isActive: true, lines: [line(), line({ side: "C", base: "GROSS" })] };

/** Kontírozási sablonok kezelése (Beállítások → Sablonok). */
export function TemplatesPage() {
  const ws = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const companyId = ws.company?.id;
  const q = useTemplates();
  const accounts = useAccounts();
  const canEdit = ws.can("ledger:post");
  const byId = new Map((accounts.data ?? []).map((a) => [a.id, a]));
  const refresh = () => queryClient.invalidateQueries({ queryKey: templatesKey(companyId) });

  return (
    <>
      <PageHeader
        title="Kontírozási sablonok"
        description={
          <>
            Gyakori könyvelések mintái; rögzítéskor az <kbd>Alt+L</kbd> billentyűvel választhatók. <HelpTip term="kontirozasiSablon" />
          </>
        }
        actions={canEdit && <TemplateDialog template={null} onSaved={refresh} />}
      />
      {(q.isLoading || accounts.isLoading) && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && q.data.length === 0 && (
        <div className="card stack">
          <p>Még nincs sablon.</p>
          {canEdit && (
            <div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    const r = await post<{ count: number }>(`/api/companies/${companyId}/templates/load-default`);
                    await refresh();
                    toast("success", `${r.count} alapértelmezett sablon betöltve.`);
                  } catch (err) {
                    toast("error", err instanceof Error ? err.message : "Váratlan hiba történt.");
                  }
                }}
              >
                Alapértelmezett sablonok betöltése
              </button>
            </div>
          )}
        </div>
      )}
      {q.data && q.data.length > 0 && (
        <div className="card table-wrap">
          <table>
            <caption className="sr-only">Sablonok</caption>
            <thead>
              <tr>
                <th scope="col">Név</th>
                <th scope="col">Rövid kód</th>
                <th scope="col">Bizonylattípus</th>
                <th scope="col" className="num">
                  Áfakulcs
                </th>
                <th scope="col">Kontírozás</th>
                <th scope="col">
                  <span className="sr-only">Műveletek</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((t) => (
                <tr key={t.id} className={t.isActive ? undefined : "account-row-inactive"}>
                  <td>
                    {t.name}
                    {!t.isActive && <span className="badge">inaktív</span>}
                  </td>
                  <td className="mono">{t.shortcut}</td>
                  <td>{t.docType ? DOCUMENT_TYPES[t.docType].label : ""}</td>
                  <td className="num">{t.vatRate != null ? `${t.vatRate}%` : ""}</td>
                  <td className="mono small">
                    {t.lines.map((l) => `${byId.get(l.accountId)?.number ?? "?"} ${l.side === "D" ? "T" : "K"} ${AMOUNT_BASE_LABELS[l.base].toLowerCase()}`).join(" · ")}
                  </td>
                  <td>
                    {canEdit && (
                      <div className="row">
                        <TemplateDialog template={t} onSaved={refresh} />
                        <ConfirmDialog
                          trigger={
                            <button type="button" className="btn btn-small btn-danger" aria-label={`Törlés: ${t.name}`}>
                              Törlés
                            </button>
                          }
                          title="Sablon törlése"
                          description={<p>A(z) „{t.name}” sablon törlődik. A vele korábban rögzített bizonylatokat nem érinti.</p>}
                          confirmLabel="Törlés"
                          onConfirm={async () => {
                            await del(`/api/companies/${companyId}/templates/${t.id}`);
                            await refresh();
                            toast("success", "A sablon törölve.");
                          }}
                        />
                      </div>
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

function TemplateDialog({ template, onSaved }: { template: TemplateDto | null; onSaved: () => Promise<unknown> }) {
  const ws = useWorkspace();
  const toast = useToast();
  const accounts = useAccounts();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(fromDto(template));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setLine = (key: number, p: Partial<LineForm>) => setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) }));

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    const vatText = form.vatRate.trim();
    // Hibás szám esetén a szöveget küldjük, így a szerver magyar hibaüzenetet ad.
    const vat = vatText === "" ? null : Number.isFinite(Number(vatText)) ? Number(vatText) : vatText;
    const body = {
      name: form.name,
      shortcut: form.shortcut,
      docType: form.docType || null,
      description: form.description,
      vatRate: vat,
      isActive: form.isActive,
      lines: form.lines.map(({ accountId, side, base }) => ({ accountId: accountId ?? "", side, base })),
    };
    try {
      if (template) await patch(`/api/companies/${ws.company!.id}/templates/${template.id}`, body);
      else await post(`/api/companies/${ws.company!.id}/templates`, body);
      await onSaved();
      toast("success", template ? "A sablon mentése sikerült." : "A sablon létrejött.");
      setOpen(false);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setMessage(err.message);
      } else setMessage("Váratlan hiba történt.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setForm(fromDto(template));
          setErrors({});
          setMessage(null);
        }
      }}
    >
      <Dialog.Trigger asChild>
        {template ? (
          <button type="button" className="btn btn-small" aria-label={`Szerkesztés: ${template.name}`}>
            Szerkesztés
          </button>
        ) : (
          <button type="button" className="btn btn-primary">
            Új sablon
          </button>
        )}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog dialog-wide" aria-describedby={undefined}>
          <Dialog.Title asChild>
            <h2>{template ? "Sablon szerkesztése" : "Új kontírozási sablon"}</h2>
          </Dialog.Title>
          <form
            className="form"
            noValidate
            onKeyDown={submitOnCtrlEnter}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {message && <ErrorSummary message={message} fields={errors} />}
            <div className="form-row">
              <Field label="Név" required error={errors.name}>
                {(p) => <input {...p} type="text" value={form.name} onChange={(e) => set("name", e.target.value)} />}
              </Field>
              <Field label="Rövid kód" error={errors.shortcut} hint="Kereséshez, pl. TEL.">
                {(p) => <input {...p} type="text" className="input-narrow" value={form.shortcut} onChange={(e) => set("shortcut", e.target.value.toUpperCase())} />}
              </Field>
            </div>
            <div className="form-row">
              <Field label="Bizonylattípus" error={errors.docType}>
                {(p) => (
                  <select {...p} value={form.docType} onChange={(e) => set("docType", e.target.value)}>
                    <option value="">Bármelyik</option>
                    {ENTERABLE_DOCUMENT_TYPES.filter((t) => DOCUMENT_TYPES[t].selectable).map((t) => (
                      <option key={t} value={t}>
                        {DOCUMENT_TYPES[t].label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Áfakulcs (%)" error={errors.vatRate} hint="Üresen: nincs áfa-felbontás.">
                {(p) => <input {...p} type="text" inputMode="numeric" className="input-narrow" value={form.vatRate} onChange={(e) => set("vatRate", e.target.value)} />}
              </Field>
            </div>
            <Field label="Alapértelmezett leírás" error={errors.description}>
              {(p) => <input {...p} type="text" value={form.description} onChange={(e) => set("description", e.target.value)} />}
            </Field>
            <fieldset className="stack">
              <legend>Sorok</legend>
              {errors.lines && <p className="error">{errors.lines}</p>}
              {form.lines.map((l, i) => (
                <div key={l.key} className="form-row template-line">
                  <Field label={`${i + 1}. sor: számla`} error={errors[`lines.${i}.accountId`]}>
                    {(p) => <AccountPicker accounts={accounts.data ?? []} value={l.accountId} onChange={(id) => setLine(l.key, { accountId: id })} controlProps={p} />}
                  </Field>
                  <Field label="Oldal">
                    {(p) => (
                      <select {...p} value={l.side} onChange={(e) => setLine(l.key, { side: e.target.value as LineSide })}>
                        <option value="D">Tartozik</option>
                        <option value="C">Követel</option>
                      </select>
                    )}
                  </Field>
                  <Field label="Összeg">
                    {(p) => (
                      <select {...p} value={l.base} onChange={(e) => setLine(l.key, { base: e.target.value as AmountBase })}>
                        {AMOUNT_BASES.map((b) => (
                          <option key={b} value={b}>
                            {AMOUNT_BASE_LABELS[b]}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <button
                    type="button"
                    className="btn btn-small"
                    aria-label={`${i + 1}. sor törlése`}
                    disabled={form.lines.length <= 2}
                    onClick={() => set("lines", form.lines.filter((x) => x.key !== l.key))}
                  >
                    ×
                  </button>
                </div>
              ))}
              <div>
                <button type="button" className="btn btn-small" onClick={() => set("lines", [...form.lines, line()])}>
                  + Új sor
                </button>
              </div>
            </fieldset>
            <label className="checkbox-row">
              <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} /> Aktív (rögzítéskor választható)
            </label>
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="btn">
                  Mégse
                </button>
              </Dialog.Close>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                Mentés
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
