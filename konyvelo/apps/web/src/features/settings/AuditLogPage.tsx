import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { auditActionLabel, type AuditEntryDto, type AuditVerifyResponse } from "@konyvelo/shared";
import { useWorkspace } from "../../app/workspace";
import { get } from "../../lib/api";
import { formatDateTimeHu } from "../../lib/format";
import { ErrorBox, Loading, PageHeader } from "../../ui/Page";
import { HelpTip } from "../../ui/Tooltip";

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** A változás olvasható összefoglalója: mező: régi → új */
function Changes({ before, after }: { before: unknown; after: unknown }) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
  if (keys.length === 0) return <span className="muted">–</span>;
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {keys.map((k) => (
        <li key={k}>
          <span className="mono">{k}</span>: {k in b ? <>{formatValue(b[k])} → </> : null}
          {k in a ? formatValue(a[k]) : <em>törölve</em>}
        </li>
      ))}
    </ul>
  );
}

export function AuditLogPage() {
  const ws = useWorkspace();
  const companyId = ws.company?.id ?? "";
  const q = useInfiniteQuery({
    queryKey: ["audit-log", companyId],
    queryFn: ({ pageParam }) =>
      get<{ entries: AuditEntryDto[]; nextBefore: string | null }>(
        `/api/companies/${companyId}/audit-log?limit=50${pageParam ? `&before=${pageParam}` : ""}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
    enabled: Boolean(companyId) && ws.can("audit:read"),
  });
  const verify = useMutation({ mutationFn: () => get<AuditVerifyResponse>(`/api/companies/${companyId}/audit-log/verify`) });

  if (!ws.can("audit:read")) {
    return <div className="alert alert-info">Az audit naplót Adminisztrátor és Vezető könyvelő láthatja.</div>;
  }

  const entries = q.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <>
      <PageHeader
        title="Audit napló"
        description={
          <span className="row">
            Ki, mikor, mit módosított. A napló nem törölhető és nem írható át. <HelpTip term="auditNaplo" />
          </span>
        }
        actions={
          <button type="button" className="btn" onClick={() => verify.mutate()} disabled={verify.isPending}>
            {verify.isPending ? "Ellenőrzés…" : "Sértetlenség ellenőrzése"}
          </button>
        }
      />
      <div aria-live="polite">
        {verify.data?.ok === true && (
          <div className="alert alert-success">A napló sértetlen: mind a {verify.data.count} bejegyzés ellenőrzőkódja egyezik.</div>
        )}
        {verify.data?.ok === false && (
          <div className="alert alert-error" role="alert">
            Figyelem: a napló sérült a(z) {verify.data.brokenAtId}. bejegyzésnél (
            {verify.data.reason === "HASH_MISMATCH" ? "a bejegyzés tartalmát utólag megváltoztatták" : "bejegyzés hiányzik a láncból"}). Kérjük,
            értesítse a rendszergazdát.
          </div>
        )}
        {verify.error && <ErrorBox error={verify.error} />}
      </div>

      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && (
        <div className="card table-wrap">
          <table>
            <caption className="sr-only">Audit napló bejegyzései, a legújabbal kezdve</caption>
            <thead>
              <tr>
                <th scope="col">Időpont</th>
                <th scope="col">Felhasználó</th>
                <th scope="col">Művelet</th>
                <th scope="col">Változás</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{formatDateTimeHu(e.at)}</td>
                  <td>{e.userName ?? "–"}</td>
                  <td>{auditActionLabel(e.action)}</td>
                  <td>
                    <Changes before={e.before} after={e.after} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {q.hasNextPage && (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                Korábbi bejegyzések
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
