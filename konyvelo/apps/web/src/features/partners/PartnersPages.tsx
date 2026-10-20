import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { PARTNER_KIND_LABELS, PARTNER_STATUS_LABELS, type PartnerDto } from "@konyvelo/shared";
import { useWorkspace } from "../../app/workspace";
import { del, get, patch, post } from "../../lib/api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Field } from "../../ui/Field";
import { ErrorBox, Loading, PageHeader } from "../../ui/Page";
import { useToast } from "../../ui/Toasts";
import { PartnerForm } from "./PartnerForm";
import { PARTNER_TABS, PartnerOpenItems, SubNav } from "../subledger/SubledgerPages";

const partnersKey = (companyId: string | undefined) => ["partners", companyId] as const;

export function PartnersPage() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const companyId = ws.company?.id;
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const q = useDeferredValue(search);
  const params = new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), ...(kind ? { kind } : {}), ...(status ? { status } : {}) });
  const list = useQuery({
    queryKey: [...partnersKey(companyId), params.toString()],
    queryFn: () => get<PartnerDto[]>(`/api/companies/${companyId}/partners?${params}`),
    enabled: Boolean(companyId),
    placeholderData: (prev) => prev,
  });

  if (!ws.company) {
    return (
      <>
        <PageHeader title="Partnerek" />
        <div className="alert alert-info">Előbb hozzon létre egy céget.</div>
      </>
    );
  }

  return (
    <>
      <SubNav label="Partnerek almenü" items={PARTNER_TABS} />
      <PageHeader
        title="Partnerek"
        description="Vevők és szállítók; a nyitott tételek a partner adatlapján és a Nyitott tételek fülön láthatók."
        actions={
          ws.can("partners:manage") && (
            <Link to="/partnerek/uj" className="btn btn-primary">
              Új partner
            </Link>
          )
        }
      />
      <div className="toolbar" role="search">
        <Field label="Keresés névre vagy adószámra">
          {(p) => <input {...p} type="search" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} />}
        </Field>
        <Field label="Típus">
          {(p) => (
            <select {...p} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Mind</option>
              <option value="CUSTOMER">Vevők</option>
              <option value="SUPPLIER">Szállítók</option>
            </select>
          )}
        </Field>
        <Field label="Állapot">
          {(p) => (
            <select {...p} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ACTIVE">Aktív</option>
              <option value="INACTIVE">Inaktív</option>
              <option value="">Mind</option>
            </select>
          )}
        </Field>
        {list.data && (
          <span className="muted" aria-live="polite">
            {list.data.length} partner
          </span>
        )}
      </div>
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      {list.data && list.data.length === 0 && <p className="muted">Nincs a feltételeknek megfelelő partner.</p>}
      {list.data && list.data.length > 0 && (
        <div className="card table-wrap">
          <table>
            <caption className="sr-only">Partnerek</caption>
            <thead>
              <tr>
                <th scope="col">Név</th>
                <th scope="col">Adószám</th>
                <th scope="col">Típus</th>
                <th scope="col">Település</th>
                <th scope="col" className="num">
                  Fiz. határidő
                </th>
                <th scope="col">Állapot</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => navigate(`/partnerek/${p.id}`)}>
                  <td>
                    <Link to={`/partnerek/${p.id}`} onClick={(e) => e.stopPropagation()}>
                      {p.name}
                    </Link>
                  </td>
                  <td className="mono">{p.taxNumber ?? p.communityVatNumber ?? (p.isPrivatePerson ? "magánszemély" : "")}</td>
                  <td>{PARTNER_KIND_LABELS[p.kind]}</td>
                  <td>{p.city ?? ""}</td>
                  <td className="num">{p.paymentTermsDays != null ? `${p.paymentTermsDays} nap` : ""}</td>
                  <td>
                    <span className={`badge ${p.status === "ACTIVE" ? "badge-success" : ""}`}>{PARTNER_STATUS_LABELS[p.status]}</span>
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

export function NewPartnerPage() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const companyId = ws.company?.id;
  if (!companyId) return null;
  return (
    <>
      <PageHeader title="Új partner" />
      <PartnerForm
        submitLabel="Partner létrehozása"
        onSubmit={async (data) => {
          const created = await post<PartnerDto>(`/api/companies/${companyId}/partners`, data);
          await queryClient.invalidateQueries({ queryKey: partnersKey(companyId) });
          toast("success", `A(z) ${created.name} partner létrejött.`);
          navigate("/partnerek");
        }}
      />
    </>
  );
}

export function PartnerDetailPage() {
  const ws = useWorkspace();
  const { partnerId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const companyId = ws.company?.id;
  const q = useQuery({
    queryKey: [...partnersKey(companyId), "detail", partnerId],
    queryFn: () => get<PartnerDto>(`/api/companies/${companyId}/partners/${partnerId}`),
    enabled: Boolean(companyId && partnerId),
  });
  const canManage = ws.can("partners:manage");
  const p = q.data;

  const setStatus = async (status: "ACTIVE" | "INACTIVE") => {
    try {
      await patch(`/api/companies/${companyId}/partners/${partnerId}`, { status });
      await queryClient.invalidateQueries({ queryKey: partnersKey(companyId) });
      toast("success", status === "ACTIVE" ? "A partner újra aktív." : "A partner inaktív lett.");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Váratlan hiba történt.");
    }
  };

  return (
    <>
      <PageHeader
        title={p ? p.name : "Partner"}
        description={p ? `${PARTNER_KIND_LABELS[p.kind]} · ${PARTNER_STATUS_LABELS[p.status]}` : undefined}
        actions={
          p &&
          canManage && (
            <>
              {p.status === "ACTIVE" ? (
                <ConfirmDialog
                  danger={false}
                  trigger={
                    <button type="button" className="btn">
                      Inaktiválás
                    </button>
                  }
                  title="Partner inaktiválása"
                  description={<p>Az inaktív partner nem jelenik meg a rögzítéskor felajánlott partnerek között. Adatai és korábbi tételei megmaradnak; bármikor újra aktiválható.</p>}
                  confirmLabel="Inaktiválás"
                  onConfirm={() => setStatus("INACTIVE")}
                />
              ) : (
                <button type="button" className="btn" onClick={() => setStatus("ACTIVE")}>
                  Aktiválás
                </button>
              )}
              <ConfirmDialog
                trigger={
                  <button type="button" className="btn btn-danger">
                    Törlés
                  </button>
                }
                title="Partner törlése"
                description={
                  <p>
                    <strong>{p.name}</strong> véglegesen törlődik. Ha a partnerre már könyveltek, nem törölhető (a megőrzési kötelezettség miatt); ilyenkor
                    inaktiválja.
                  </p>
                }
                confirmLabel="Törlés"
                onConfirm={async () => {
                  try {
                    await del(`/api/companies/${companyId}/partners/${partnerId}`);
                    await queryClient.invalidateQueries({ queryKey: partnersKey(companyId) });
                    toast("success", `A(z) ${p.name} partner törölve.`);
                    navigate("/partnerek");
                  } catch (err) {
                    toast("error", err instanceof Error ? err.message : "Váratlan hiba történt.");
                  }
                }}
              />
            </>
          )
        }
      />
      <p>
        <Link to="/partnerek">← Vissza a partnerekhez</Link>
      </p>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {p && <PartnerOpenItems partnerId={p.id} />}
      {p && (
        <PartnerForm
          key={p.id}
          partner={p}
          readOnly={!canManage}
          submitLabel="Változások mentése"
          onSubmit={async (data) => {
            await patch(`/api/companies/${companyId}/partners/${p.id}`, data);
            await queryClient.invalidateQueries({ queryKey: partnersKey(companyId) });
            toast("success", "A partner adatainak mentése sikerült.");
          }}
        />
      )}
    </>
  );
}
