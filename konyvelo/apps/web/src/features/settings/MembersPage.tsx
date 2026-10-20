import { useQuery, useQueryClient } from "@tanstack/react-query";
import { memberAddSchema, PASSWORD_MIN_LENGTH, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, type MemberDto, type Role } from "@konyvelo/shared";
import { useWorkspace } from "../../app/workspace";
import { del, get, patch, post } from "../../lib/api";
import { formatDateHu } from "../../lib/format";
import { submitOnCtrlEnter, useZodForm } from "../../lib/form";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { ErrorSummary, Field } from "../../ui/Field";
import { ErrorBox, Loading, PageHeader } from "../../ui/Page";
import { useToast } from "../../ui/Toasts";
import { useAction } from "./SettingsPages";

function AddMemberForm({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const form = useZodForm(
    memberAddSchema,
    { email: "", name: "", role: "ACCOUNTANT" as Role, initialPassword: "" },
    (v) => ({ ...v, initialPassword: v.initialPassword === "" ? undefined : v.initialPassword }),
  );
  return (
    <form
      className="form card"
      noValidate
      aria-labelledby="uj-tag"
      onKeyDown={submitOnCtrlEnter}
      onSubmit={(e) => {
        e.preventDefault();
        void form
          .submit(async (data) => {
            await post(`/api/companies/${companyId}/members`, data);
          })
          .then(async (ok) => {
            if (!ok) return;
            await queryClient.invalidateQueries({ queryKey: ["members", companyId] });
            toast("success", `${form.values.email} hozzáadva a céghez.`);
            form.reset({ email: "", name: "", role: "ACCOUNTANT", initialPassword: "" });
          });
      }}
    >
      <h2 id="uj-tag">Felhasználó hozzáadása</h2>
      <p className="muted" style={{ margin: 0 }}>
        Ha az e-mail-címmel már van felhasználó a rendszerben, elég a szerepkört megadni. Új felhasználónál a név és a kezdő jelszó is kell.
      </p>
      <ErrorSummary message={form.formError} />
      <div className="form-row">
        <Field label="E-mail-cím" error={form.errors.email} required>
          {(p) => <input {...p} type="email" value={form.values.email} onChange={(e) => form.set("email", e.target.value)} onBlur={() => form.blur("email")} />}
        </Field>
        <Field label="Név" error={form.errors.name} hint="Új felhasználónál kötelező.">
          {(p) => <input {...p} value={form.values.name} onChange={(e) => form.set("name", e.target.value)} />}
        </Field>
      </div>
      <div className="form-row">
        <Field label="Szerepkör" error={form.errors.role} help="szerepkor" hint={ROLE_DESCRIPTIONS[form.values.role]} required>
          {(p) => (
            <select {...p} value={form.values.role} onChange={(e) => form.set("role", e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Kezdő jelszó" error={form.errors.initialPassword} help="kezdoJelszo" hint={`Új felhasználónál, legalább ${PASSWORD_MIN_LENGTH} karakter.`}>
          {(p) => (
            <input
              {...p}
              type="password"
              autoComplete="new-password"
              value={form.values.initialPassword}
              onChange={(e) => form.set("initialPassword", e.target.value)}
              onBlur={() => form.blur("initialPassword")}
            />
          )}
        </Field>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={form.submitting}>
          Hozzáadás
        </button>
      </div>
    </form>
  );
}

export function MembersPage() {
  const ws = useWorkspace();
  const companyId = ws.company?.id ?? "";
  const q = useQuery({
    queryKey: ["members", companyId],
    queryFn: () => get<MemberDto[]>(`/api/companies/${companyId}/members`),
    enabled: Boolean(companyId) && ws.can("members:manage"),
  });
  const changeRole = useAction(
    ({ userId, role }: { userId: string; role: Role }) => patch(`/api/companies/${companyId}/members/${userId}`, { role }),
    "A szerepkör módosítása sikerült.",
    [["members", companyId], ["me"]],
  );
  const remove = useAction(
    (userId: string) => del(`/api/companies/${companyId}/members/${userId}`),
    "A felhasználót eltávolítottuk a cégből.",
    [["members", companyId], ["me"]],
  );

  if (!ws.can("members:manage")) {
    return <div className="alert alert-info">A felhasználók kezeléséhez Adminisztrátor szerepkör szükséges.</div>;
  }

  return (
    <>
      <PageHeader title="Felhasználók" description={`A(z) ${ws.company?.shortName} cég felhasználói és szerepköreik.`} />
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && (
        <div className="card table-wrap">
          <table>
            <caption className="sr-only">A cég felhasználói</caption>
            <thead>
              <tr>
                <th scope="col">Név</th>
                <th scope="col">E-mail-cím</th>
                <th scope="col">Szerepkör</th>
                <th scope="col">Hozzáadva</th>
                <th scope="col">
                  <span className="sr-only">Műveletek</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((m) => {
                const isMe = m.userId === ws.me.user.id;
                return (
                  <tr key={m.userId}>
                    <td>
                      {m.name}
                      {isMe && <span className="muted"> (Ön)</span>}
                    </td>
                    <td>{m.email}</td>
                    <td>
                      <label className="sr-only" htmlFor={`role-${m.userId}`}>
                        {m.name} szerepköre
                      </label>
                      <select
                        id={`role-${m.userId}`}
                        className="input-compact"
                        value={m.role}
                        disabled={changeRole.isPending}
                        onChange={(e) => changeRole.mutate({ userId: m.userId, role: e.target.value as Role })}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{formatDateHu(m.createdAt.slice(0, 10))}</td>
                    <td>
                      <ConfirmDialog
                        trigger={
                          <button type="button" className="btn btn-small btn-danger" aria-label={`Eltávolítás: ${m.name}`}>
                            Eltávolítás
                          </button>
                        }
                        title="Felhasználó eltávolítása a cégből"
                        description={
                          <p>
                            <strong>{m.name}</strong> ({m.email}) a továbbiakban nem fér hozzá a(z) {ws.company?.shortName} cég adataihoz. A
                            felhasználó által korábban rögzített adatok és az audit napló bejegyzései megmaradnak.
                            {isMe && " Figyelem: saját magát távolítja el."}
                          </p>
                        }
                        confirmLabel="Eltávolítás"
                        onConfirm={() => remove.mutateAsync(m.userId).catch(() => {})}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <AddMemberForm companyId={companyId} />
    </>
  );
}
