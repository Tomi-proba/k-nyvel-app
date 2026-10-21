import { useEffect, useId, useRef, type ReactNode } from "react";
import type { GlossaryKey } from "../help/glossary";
import { HelpTip } from "./Tooltip";

export type FieldControlProps = {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
  "aria-required": boolean | undefined;
};

/**
 * Űrlapmező címkével, súgóval, tipp-szöveggel és hibaüzenettel. A hiba a
 * mező alatt jelenik meg, és a mezőhöz van kötve (aria-describedby), így a
 * képernyőolvasó is felolvassa.
 */
export function Field({
  label,
  error,
  hint,
  help,
  required,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  help?: GlossaryKey;
  required?: boolean;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <div className="field-label-row">
        <label htmlFor={id}>
          {label}
          {required && (
            <span className="required-mark" aria-hidden="true">
              {" "}*
            </span>
          )}
        </label>
        {/* A súgógomb a címkén kívül van, hogy ne kerüljön bele a mező nevébe. */}
        {help && <HelpTip term={help} />}
      </div>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy, "aria-required": required || undefined })}
      {hint && (
        <div className="hint" id={hintId}>
          {hint}
        </div>
      )}
      {error && (
        <div className="error" id={errorId}>
          {error}
        </div>
      )}
    </div>
  );
}

/** Űrlap tetején megjelenő hibaösszesítő (fókuszt kap, a képernyőolvasó felolvassa). */
export function ErrorSummary({ message, fields }: { message?: string | null; fields?: Record<string, string> }) {
  const items = fields ? Object.values(fields) : [];
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef<{ message: string; items: string[] }>({ message: "", items: [] });
  const key = `${message ?? ""}|${items.join("|")}`;
  useEffect(() => {
    // Csak új hiba esetén kapjon fókuszt. Ha egy hiba a javítás (gépelés) miatt
    // eltűnik a listából, a kurzor maradjon a mezőben.
    const prev = shown.current;
    const isNew = (message ?? "") !== prev.message || items.some((m) => !prev.items.includes(m));
    shown.current = { message: message ?? "", items };
    if (isNew && key !== "|") ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!message && items.length === 0) return null;
  return (
    <div className="alert alert-error" role="alert" tabIndex={-1} ref={ref}>
      <strong>{message ?? "Kérjük, javítsa a megjelölt mezőket."}</strong>
      {items.length > 1 && (
        <ul>
          {items.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
