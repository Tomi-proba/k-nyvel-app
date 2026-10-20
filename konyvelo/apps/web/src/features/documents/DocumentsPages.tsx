import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { DOCUMENT_TYPES, formatHuf, isDocumentType, type DocumentType } from "@konyvelo/domain";
import { ENTERABLE_DOCUMENT_TYPES, type DocumentListResponse } from "@konyvelo/shared";
import { NEW_ENTRY_PATH } from "../../app/AppLayout";
import { NEW_ENTRY_SHORTCUT_TEXT } from "../../app/shortcuts";
import { useWorkspace } from "../../app/workspace";
import { get } from "../../lib/api";
import { formatDateHu, fiscalYearLabel } from "../../lib/format";
import { readSetting } from "../../lib/storage";
import { Field } from "../../ui/Field";
import { ErrorBox, Loading, PageHeader } from "../../ui/Page";
import { Tooltip } from "../../ui/Tooltip";
import { DocumentView } from "./DocumentView";
import { EntryForm } from "./EntryForm";
import { entryFromDocument, newEntry } from "./entry-model";
import { deadlineText, documentsKey, useDocument } from "./queries";
import { StatusBadge } from "./StatusBadge";

const PAGE_SIZE = 50;

/** A szűrők az URL-ben vannak, így a Kezdőlap teendői közvetlenül ide mutathatnak. */
const STATUS_PARAM: Record<string, string> = { piszkozat: "DRAFT", konyvelt: "POSTED", sztornozott: "REVERSED" };

export function DocumentsPage() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const companyId = ws.company?.id;
  const allapot = params.get("allapot") ?? "";
  const late = params.get("hatarido") === "keso";
  const tipus = params.get("tipus") ?? "";
  const [search, setSearch] = useState(params.get("q") ?? "");
  const q = useDeferredValue(search);
  const page = Math.max(Number(params.get("oldal")) || 1, 1);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "oldal") next.delete("oldal");
    setParams(next, { replace: true });
  };

  const apiParams = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE),
    ...(ws.fiscalYear && !late && allapot !== "piszkozat" ? { fiscalYearId: ws.fiscalYear.id } : {}),
    ...(STATUS_PARAM[allapot] ? { status: STATUS_PARAM[allapot] } : {}),
    ...(late ? { late: "1" } : {}),
    ...(tipus ? { type: tipus } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
  });
  const list = useQuery({
    queryKey: [...documentsKey(companyId), apiParams.toString()],
    queryFn: () => get<DocumentListResponse>(`/api/companies/${companyId}/documents?${apiParams}`),
    enabled: Boolean(companyId),
    placeholderData: (prev) => prev,
  });

  if (!ws.company) {
    return (
      <>
        <PageHeader title="Könyvelés" />
        <div className="alert alert-info">Előbb hozzon létre egy céget.</div>
      </>
    );
  }

  const total = list.data?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <>
      <PageHeader
        title="Könyvelés"
        description={
          late
            ? "Határidőn túl könyvelt bizonylatok (Szt. 165. § (3))."
            : allapot === "piszkozat"
              ? "Piszkozatban maradt bizonylatok – minden üzleti évből."
              : `Bizonylatok${ws.fiscalYear ? ` – ${fiscalYearLabel(ws.fiscalYear)}. üzleti év` : ""}.`
        }
        actions={
          ws.can("ledger:post") && (
            <Tooltip content={<>Új bizonylat – {NEW_ENTRY_SHORTCUT_TEXT}</>}>
              <Link to={NEW_ENTRY_PATH} className="btn btn-primary" aria-keyshortcuts="Alt+N F2 N">
                Új bizonylat
              </Link>
            </Tooltip>
          )
        }
      />
      <div className="toolbar" role="search">
        <Field label="Keresés (sorszám, számlaszám, leírás, partner)">
          {(p) => (
            <input
              {...p}
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setParam("q", e.target.value.trim());
              }}
            />
          )}
        </Field>
        <Field label="Típus">
          {(p) => (
            <select {...p} value={tipus} onChange={(e) => setParam("tipus", e.target.value)}>
              <option value="">Mind</option>
              {(Object.keys(DOCUMENT_TYPES) as DocumentType[]).map((t) => (
                <option key={t} value={t}>
                  {DOCUMENT_TYPES[t].label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Állapot">
          {(p) => (
            <select
              {...p}
              value={late ? "keso" : allapot}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                next.delete("oldal");
                next.delete("allapot");
                next.delete("hatarido");
                if (e.target.value === "keso") next.set("hatarido", "keso");
                else if (e.target.value) next.set("allapot", e.target.value);
                setParams(next, { replace: true });
              }}
            >
              <option value="">Mind</option>
              <option value="piszkozat">Piszkozat</option>
              <option value="konyvelt">Könyvelt</option>
              <option value="sztornozott">Sztornózott</option>
              <option value="keso">Határidőn túl könyvelt</option>
            </select>
          )}
        </Field>
        {list.data && (
          <span className="muted" aria-live="polite">
            {total} bizonylat
          </span>
        )}
      </div>
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      {list.data && list.data.items.length === 0 && (
        <p className="muted">
          Nincs a feltételeknek megfelelő bizonylat.{" "}
          {ws.can("ledger:post") && (
            <>
              Új bizonylat: <Link to={NEW_ENTRY_PATH}>rögzítés</Link> ({NEW_ENTRY_SHORTCUT_TEXT}).
            </>
          )}
        </p>
      )}
      {list.data && list.data.items.length > 0 && (
        <>
          <div className="card table-wrap">
            <table>
              <caption className="sr-only">Bizonylatok</caption>
              <thead>
                <tr>
                  <th scope="col">Sorszám</th>
                  <th scope="col">Típus</th>
                  <th scope="col">Könyvelés dátuma</th>
                  <th scope="col">Partner</th>
                  <th scope="col">Leírás</th>
                  <th scope="col" className="num">
                    Összeg
                  </th>
                  <th scope="col">Állapot</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((d) => (
                  <tr key={d.id} className="clickable" onClick={() => navigate(`/konyveles/${d.id}`)}>
                    <td className="mono nowrap">
                      <Link to={`/konyveles/${d.id}`} onClick={(e) => e.stopPropagation()}>
                        {d.serialNumber ?? "Piszkozat"}
                      </Link>
                    </td>
                    <td>{DOCUMENT_TYPES[d.docType].label}</td>
                    <td>{formatDateHu(d.accountingDate)}</td>
                    <td>{d.partnerName ?? ""}</td>
                    <td>
                      {d.description ?? <span className="muted">(nincs leírás)</span>}
                      {d.externalNumber && <div className="muted small mono">{d.externalNumber}</div>}
                    </td>
                    <td className="num">{formatHuf(d.total)}</td>
                    <td>
                      <StatusBadge status={d.status} reversed={d.reversed} />
                      {(d.deadline.status === "OVERDUE" || d.deadline.status === "LATE" || d.deadline.status === "DUE_SOON") && (
                        <div className="small deadline-note">{deadlineText(d.deadline)}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > PAGE_SIZE && (
            <nav className="row pager" aria-label="Lapozás">
              <button type="button" className="btn btn-small" disabled={page <= 1} onClick={() => setParam("oldal", String(page - 1))}>
                ← Előző
              </button>
              <span className="muted">
                {from}–{to} / {total}
              </span>
              <button type="button" className="btn btn-small" disabled={to >= total} onClick={() => setParam("oldal", String(page + 1))}>
                Következő →
              </button>
            </nav>
          )}
        </>
      )}
    </>
  );
}

/** Új bizonylat; ?masolat=<id> másolatként, ?helyesbit=<id> helyesbítő bizonylatként, ?tipus=SZSZ típussal. */
export function NewDocumentPage() {
  const ws = useWorkspace();
  const [params] = useSearchParams();
  const copyId = params.get("masolat");
  const correctId = params.get("helyesbit");
  const source = useDocument(copyId ?? correctId);
  const typeParam = params.get("tipus");

  const initial = useMemo(() => {
    if (source.data) return entryFromDocument(source.data, correctId ? "correct" : "copy", ws.fiscalYear);
    const remembered = readSetting("lastDocType");
    const t = typeParam && isDocumentType(typeParam) ? typeParam : remembered && isDocumentType(remembered) ? remembered : "";
    return newEntry(ws.fiscalYear, t && ENTERABLE_DOCUMENT_TYPES.includes(t) && t !== "HELY" ? t : "");
    // Csak a forrás betöltésekor és a cím változásakor kell újraépíteni.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.data, correctId, typeParam, ws.fiscalYear?.id]);

  if (!ws.company) return <PageHeader title="Új bizonylat" description="Előbb hozzon létre egy céget." />;
  if (ws.fiscalYears.length === 0 && !ws.fiscalYearsLoading) {
    return (
      <>
        <PageHeader title="Új bizonylat" />
        <div className="alert alert-info">
          Könyvelni csak üzleti évbe lehet. <Link to="/beallitasok/uzleti-evek">Hozza létre az első üzleti évet.</Link>
        </div>
      </>
    );
  }
  if (!ws.can("ledger:post")) {
    return (
      <>
        <PageHeader title="Új bizonylat" />
        <div className="alert alert-info">A szerepköre csak megtekintésre jogosít; bizonylatot Könyvelő, Vezető könyvelő vagy Adminisztrátor rögzíthet.</div>
      </>
    );
  }
  if ((copyId || correctId) && source.isLoading) return <Loading />;
  if (source.error) return <ErrorBox error={source.error} />;
  const key = `${copyId ?? ""}|${correctId ?? ""}|${typeParam ?? ""}|${params.get("uj") ?? ""}`;
  return <EntryForm key={key} initial={initial} draftId={null} reference={correctId ? source.data : null} />;
}

/** Piszkozat: szerkesztés; könyvelt bizonylat: megtekintés. */
export function DocumentPage() {
  const ws = useWorkspace();
  const { documentId } = useParams();
  const q = useDocument(documentId);
  const reference = useDocument(q.data?.status === "DRAFT" ? (q.data.corrects?.id ?? null) : null);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const doc = q.data!;
  if (doc.status === "DRAFT" && ws.can("ledger:post")) {
    if (doc.corrects && reference.isLoading) return <Loading />;
    return <EntryForm key={doc.id + doc.updatedAt} initial={entryFromDocument(doc, "edit", ws.fiscalYear)} draftId={doc.id} reference={reference.data ?? null} />;
  }
  return <DocumentView doc={doc} />;
}
