import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AMOUNT_BASE_LABELS, DOCUMENT_TYPES, normalizeForSearch } from "@konyvelo/domain";
import type { AccountDto } from "@konyvelo/shared";
import { AmountInput, amountFromText } from "../../ui/AmountInput";
import { Field } from "../../ui/Field";
import { Kbd } from "../../ui/Tooltip";
import type { ApplicableTemplate } from "./entry-model";

/**
 * Kontírozási sablon választása (Alt+L): keresés névre vagy rövid kódra,
 * nyilak + Enter, majd az összeg (bruttó vagy nettó) és az áfakulcs
 * megadása után Enterrel kitölti a tételsorokat.
 */
export function TemplateDialog({
  open,
  onOpenChange,
  templates,
  accounts,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: readonly ApplicableTemplate[];
  accounts: ReadonlyMap<string, AccountDto>;
  onApply: (t: ApplicableTemplate, amount: number | null, kind: "GROSS" | "NET", vatRate: number) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [chosen, setChosen] = useState<ApplicableTemplate | null>(null);
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"GROSS" | "NET">("GROSS");
  const [vatRate, setVatRate] = useState("27");
  const [error, setError] = useState<string | null>(null);
  const amountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setChosen(null);
      setAmount("");
      setKind("GROSS");
      setError(null);
    }
  }, [open]);

  const options = useMemo(() => {
    const q = normalizeForSearch(query.trim());
    return templates.filter((t) => !q || normalizeForSearch(t.name).includes(q) || normalizeForSearch(t.shortcut ?? "") === q || normalizeForSearch(t.shortcut ?? "").startsWith(q));
  }, [templates, query]);

  const choose = (t: ApplicableTemplate) => {
    setChosen(t);
    setVatRate(String(t.vatRate ?? 0));
    setTimeout(() => amountRef.current?.querySelector("input")?.focus(), 0);
  };

  const apply = () => {
    if (!chosen) return;
    const a = amountFromText(amount);
    if (a === undefined) return setError("Érvénytelen összeg (pl. 12 700).");
    const rate = Number(vatRate);
    if (!Number.isInteger(rate) || rate < 0 || rate > 100) return setError("Az áfakulcs 0 és 100 közötti egész szám.");
    onApply(chosen, a, kind, rate);
    onOpenChange(false);
  };

  const describe = (t: ApplicableTemplate) =>
    t.lines.map((l) => `${accounts.get(l.accountId)?.number ?? "?"} ${l.side === "D" ? "T" : "K"} ${AMOUNT_BASE_LABELS[l.base].toLowerCase()}`).join(" · ");

  const hasVat = chosen?.lines.some((l) => l.base === "VAT" || l.base === "NET");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog dialog-wide" aria-describedby={`${listId}-desc`}>
          <Dialog.Title asChild>
            <h2>Kontírozási sablon</h2>
          </Dialog.Title>
          <p className="muted" id={`${listId}-desc`}>
            Válasszon sablont (nyilak és <Kbd>Enter</Kbd>), adja meg az összeget, majd <Kbd>Enter</Kbd>: a rendszer kitölti a tételsorokat. Ez csak
            kontírozási segítség; az áfát nem tartjuk nyilván külön.
          </p>
          <div className="field">
            <label htmlFor={`${listId}-q`}>Sablon keresése</label>
            <input
              id={`${listId}-q`}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
              autoComplete="off"
              autoFocus
              placeholder="Név vagy rövid kód…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((i) => Math.min(options.length - 1, i + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(0, i - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const t = options[active];
                  if (t) choose(t);
                }
              }}
            />
          </div>
          <ul className="template-list" role="listbox" id={listId} aria-label="Sablonok">
            {options.length === 0 && (
              <li className="combobox-empty" role="presentation">
                Nincs ilyen sablon. Sablonokat a Beállítások → Sablonok oldalon vehet fel.
              </li>
            )}
            {options.map((t, i) => (
              <li
                key={t.id ?? "partner"}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={chosen ? chosen === t : i === active}
                className={(chosen ? chosen === t : i === active) ? "is-active" : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setActive(i);
                  choose(t);
                }}
              >
                <strong>{t.name}</strong>
                {t.shortcut && <span className="badge">{t.shortcut}</span>}
                {t.docType && <span className="muted"> · {DOCUMENT_TYPES[t.docType].label}</span>}
                <div className="muted mono small">{describe(t)}</div>
              </li>
            ))}
          </ul>
          {chosen && (
            <div
              className="form-row"
              ref={amountRef}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type !== "radio") {
                  e.preventDefault();
                  apply();
                }
              }}
            >
              <Field label={kind === "GROSS" ? "Bruttó összeg (Ft)" : "Nettó összeg (Ft)"} error={error ?? undefined} hint="Üresen hagyva csak a számlák töltődnek ki.">
                {(p) => <AmountInput controlProps={p} value={amount} onChange={setAmount} />}
              </Field>
              {hasVat && (
                <>
                  <fieldset className="radio-group">
                    <legend>Az összeg</legend>
                    <label>
                      <input type="radio" name="tpl-kind" checked={kind === "GROSS"} onChange={() => setKind("GROSS")} /> bruttó
                    </label>
                    <label>
                      <input type="radio" name="tpl-kind" checked={kind === "NET"} onChange={() => setKind("NET")} /> nettó
                    </label>
                  </fieldset>
                  <Field label="Áfakulcs (%)">
                    {(p) => <input {...p} type="text" inputMode="numeric" className="input-narrow" value={vatRate} onChange={(e) => setVatRate(e.target.value)} />}
                  </Field>
                </>
              )}
            </div>
          )}
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <button type="button" className="btn">
                Mégse
              </button>
            </Dialog.Close>
            <button type="button" className="btn btn-primary" disabled={!chosen} onClick={apply}>
              Kitöltés
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
