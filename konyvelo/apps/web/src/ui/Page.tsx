import { useEffect, useRef, type ReactNode } from "react";

/**
 * Oldalfejléc. Beállítja a böngészőfül címét, és oldalváltáskor a fókuszt a
 * címsorra teszi, így a képernyőolvasó felolvassa, hová érkezett a felhasználó.
 */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${title} – Könyvelő`;
    ref.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <div className="page-header">
      <div>
        <h1 ref={ref} tabIndex={-1}>
          {title}
        </h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Loading({ label = "Betöltés…" }: { label?: string }) {
  return (
    <p className="muted" role="status">
      {label}
    </p>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "Váratlan hiba történt.";
  return (
    <div className="alert alert-error" role="alert">
      {message}
    </div>
  );
}
