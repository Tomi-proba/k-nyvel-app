import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { changePasswordSchema, loginSchema, PASSWORD_MIN_LENGTH, setupSchema } from "@konyvelo/shared";
import { post } from "../../lib/api";
import { submitOnCtrlEnter, useZodForm } from "../../lib/form";
import { ErrorSummary, Field } from "../../ui/Field";

function AuthShell({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  useEffect(() => {
    document.title = `${title} – Könyvelő`;
  }, [title]);
  return (
    <div className="auth-page">
      <main className="auth-card" id="tartalom">
        <p className="muted" style={{ margin: 0 }}>
          Könyvelő
        </p>
        <h1>{title}</h1>
        {intro && <p className="muted">{intro}</p>}
        {children}
      </main>
    </div>
  );
}

export function LoginPage() {
  const queryClient = useQueryClient();
  const form = useZodForm(loginSchema, { email: "", password: "" });
  return (
    <AuthShell title="Bejelentkezés">
      <form
        className="form"
        noValidate
        onKeyDown={submitOnCtrlEnter}
        onSubmit={(e) => {
          e.preventDefault();
          void form.submit(async (data) => {
            await post("/api/auth/login", data);
            await queryClient.invalidateQueries();
          });
        }}
      >
        <ErrorSummary message={form.formError} />
        <Field label="E-mail-cím" error={form.errors.email} required>
          {(p) => (
            <input
              {...p}
              type="email"
              autoComplete="username"
              autoFocus
              value={form.values.email}
              onChange={(e) => form.set("email", e.target.value)}
              onBlur={() => form.blur("email")}
            />
          )}
        </Field>
        <Field label="Jelszó" error={form.errors.password} required>
          {(p) => (
            <input
              {...p}
              type="password"
              autoComplete="current-password"
              value={form.values.password}
              onChange={(e) => form.set("password", e.target.value)}
            />
          )}
        </Field>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={form.submitting}>
            {form.submitting ? "Belépés…" : "Belépés"}
          </button>
        </div>
      </form>
    </AuthShell>
  );
}

export function SetupPage() {
  const queryClient = useQueryClient();
  const form = useZodForm(setupSchema, { name: "", email: "", password: "" });
  return (
    <AuthShell
      title="Első indítás"
      intro="Hozza létre az első felhasználót. Belépés után cégeket vehet fel, és további felhasználókat adhat hozzájuk."
    >
      <form
        className="form"
        noValidate
        onKeyDown={submitOnCtrlEnter}
        onSubmit={(e) => {
          e.preventDefault();
          void form.submit(async (data) => {
            await post("/api/setup", data);
            await queryClient.invalidateQueries();
          });
        }}
      >
        <ErrorSummary message={form.formError} />
        <Field label="Név" error={form.errors.name} required>
          {(p) => (
            <input {...p} autoComplete="name" autoFocus value={form.values.name} onChange={(e) => form.set("name", e.target.value)} onBlur={() => form.blur("name")} />
          )}
        </Field>
        <Field label="E-mail-cím" error={form.errors.email} required>
          {(p) => (
            <input {...p} type="email" autoComplete="username" value={form.values.email} onChange={(e) => form.set("email", e.target.value)} onBlur={() => form.blur("email")} />
          )}
        </Field>
        <Field label="Jelszó" error={form.errors.password} hint={`Legalább ${PASSWORD_MIN_LENGTH} karakter. Jól megjegyezhető, hosszú mondat is lehet.`} required>
          {(p) => (
            <input {...p} type="password" autoComplete="new-password" value={form.values.password} onChange={(e) => form.set("password", e.target.value)} onBlur={() => form.blur("password")} />
          )}
        </Field>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={form.submitting}>
            Létrehozás és belépés
          </button>
        </div>
      </form>
    </AuthShell>
  );
}

/** Jelszócsere; kötelező, ha a felhasználót más hozta létre kezdő jelszóval. */
export function ChangePasswordForm({ forced, onDone }: { forced?: boolean; onDone?: () => void }) {
  const queryClient = useQueryClient();
  const form = useZodForm(changePasswordSchema, { currentPassword: "", newPassword: "" });
  return (
    <form
      className="form"
      noValidate
      onKeyDown={submitOnCtrlEnter}
      onSubmit={(e) => {
        e.preventDefault();
        void form
          .submit(async (data) => {
            await post("/api/auth/password", data);
            await queryClient.invalidateQueries({ queryKey: ["me"] });
          })
          .then((ok) => {
            if (ok) {
              form.reset({ currentPassword: "", newPassword: "" });
              onDone?.();
            }
          });
      }}
    >
      <ErrorSummary message={form.formError} />
      <Field label={forced ? "Kezdő jelszó" : "Jelenlegi jelszó"} error={form.errors.currentPassword} required>
        {(p) => (
          <input {...p} type="password" autoComplete="current-password" autoFocus={forced} value={form.values.currentPassword} onChange={(e) => form.set("currentPassword", e.target.value)} />
        )}
      </Field>
      <Field label="Új jelszó" error={form.errors.newPassword} hint={`Legalább ${PASSWORD_MIN_LENGTH} karakter.`} required>
        {(p) => (
          <input {...p} type="password" autoComplete="new-password" value={form.values.newPassword} onChange={(e) => form.set("newPassword", e.target.value)} onBlur={() => form.blur("newPassword")} />
        )}
      </Field>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={form.submitting}>
          Jelszó cseréje
        </button>
      </div>
    </form>
  );
}

export function ForcedPasswordChangePage() {
  return (
    <AuthShell title="Jelszócsere szükséges" intro="Az első belépéskor kérjük, cserélje le a kapott kezdő jelszót egy saját jelszóra.">
      <ChangePasswordForm forced />
    </AuthShell>
  );
}
