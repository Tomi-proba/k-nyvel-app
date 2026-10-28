import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { DOCUMENT_TYPES, formatHuf } from "@konyvelo/domain";
import { FX_RATE_SOURCE_LABELS, type CompanyDto, type DocumentDto, type DocumentRef } from "@konyvelo/shared";
import { NEW_ENTRY_PATH } from "../../app/AppLayout";
import { useWorkspace } from "../../app/workspace";
import { ApiError, del, get, post } from "../../lib/api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { fiscalYearLabel, formatDateHu, formatDateTimeHu } from "../../lib/format";
import { DateInput } from "../../ui/DateInput";
import { Field } from "../../ui/Field";
import { PageHeader } from "../../ui/Page";
import { useToast } from "../../ui/Toasts";
import { HelpTip } from "../../ui/Tooltip";
import { AttachmentsSection } from "./AttachmentsSection";
import { StatusBadge } from "./StatusBadge";
import { deadlineText, useInvalidateDocuments } from "./queries";

const RefLink = ({ r }: { r: DocumentRef }) => (
  <Link to={`/konyveles/${r.id}`} className="mono">
    {r.serialNumber ?? "piszkozat"}
  </Link>
);

/** Könyvelt bizonylat megtekintése: adatok, kontírozás, kapcsolatok, sztornó és helyesbítés. */
export function DocumentView({ doc }: { doc: DocumentDto }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const type = DOCUMENT_TYPES[doc.docType];
  const canPost = ws.can("ledger:post");
  const posted = doc.status === "POSTED";
  const reversible = posted && doc.docType !== "SZT" && !doc.reversedBy;
  const affectsYear = ws.fiscalYears.find((y) => y.id === doc.affectsFiscalYearId);

  return (
    <>
      <PageHeader
        title={doc.serialNumber ? `${doc.serialNumber}` : "Piszkozat"}
        description={
          <>
            {type.label} · <StatusBadge status={doc.status} reversed={Boolean(doc.reversedBy)} />
          </>
        }
        actions={
          posted &&
          canPost && (
            <>
              {reversible && <ReverseDialog doc={doc} onDone={(id) => navigate(`/konyveles/${id}`)} />}
              {doc.docType !== "SZT" && (
                <Link to={`${NEW_ENTRY_PATH}?helyesbit=${doc.id}`} className="btn">
                  Helyesbítő bizonylat
                </Link>
              )}
              {doc.docType !== "SZT" && (
                <Link to={`${NEW_ENTRY_PATH}?masolat=${doc.id}`} className="btn">
                  Másolás új bizonylatba
                </Link>
              )}
              <Link to={NEW_ENTRY_PATH} className="btn btn-primary">
                Új bizonylat
              </Link>
            </>
          )
        }
      />
      <p>
        <Link to="/konyveles">← Vissza a bizonylatokhoz</Link>
      </p>

      {(doc.reverses || doc.reversedBy || doc.corrects || doc.correctedBy.length > 0 || affectsYear) && (
        <div className="alert alert-info stack">
          {doc.reverses && (
            <div>
              Ez a bizonylat sztornózza: <RefLink r={doc.reverses} /> <HelpTip term="sztorno" />
            </div>
          )}
          {doc.reversedBy && (
            <div>
              <strong>Sztornózva</strong> a következővel: <RefLink r={doc.reversedBy} />. Az eredeti tételek változatlanul láthatók.
            </div>
          )}
          {doc.corrects && (
            <div>
              Ez a bizonylat helyesbíti: <RefLink r={doc.corrects} /> <HelpTip term="helyesbito" />
            </div>
          )}
          {doc.correctedBy.length > 0 && (
            <div>
              Helyesbítve:{" "}
              {doc.correctedBy.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && ", "}
                  <RefLink r={r} />
                </span>
              ))}
            </div>
          )}
          {affectsYear && <div>Előző üzleti évet érintő hiba javítása (érintett év: {fiscalYearLabel(affectsYear)}).</div>}
        </div>
      )}

      <div className="grid-2">
        <section className="card" aria-labelledby="adatok">
          <h2 id="adatok">Bizonylat adatai</h2>
          <dl className="preview-grid">
            <dt>Típus</dt>
            <dd>{type.label}</dd>
            {doc.partnerName && (
              <>
                <dt>Partner</dt>
                <dd>{doc.partnerId ? <Link to={`/partnerek/${doc.partnerId}`}>{doc.partnerName}</Link> : doc.partnerName}</dd>
              </>
            )}
            {doc.externalNumber && (
              <>
                <dt>{type.externalNumberLabel}</dt>
                <dd className="mono">{doc.externalNumber}</dd>
              </>
            )}
            <dt>Leírás</dt>
            <dd>{doc.description}</dd>
            <dt>Kelt</dt>
            <dd>{formatDateHu(doc.issueDate)}</dd>
            {doc.fulfillmentDate && (
              <>
                <dt>Teljesítés</dt>
                <dd>{formatDateHu(doc.fulfillmentDate)}</dd>
              </>
            )}
            <dt>Könyvelés dátuma</dt>
            <dd>{formatDateHu(doc.accountingDate)}</dd>
            {doc.dueDate && (
              <>
                <dt>Fizetési határidő</dt>
                <dd>{formatDateHu(doc.dueDate)}</dd>
              </>
            )}
            {doc.currency !== "HUF" && (
              <>
                <dt>Deviza</dt>
                <dd>
                  {doc.fxAmount != null && formatHuf(doc.fxAmount, { withUnit: false })} {doc.currency} · árfolyam {String(doc.fxRate).replace(".", ",")} Ft
                  {doc.fxRateSource && ` (${FX_RATE_SOURCE_LABELS[doc.fxRateSource]})`}
                </dd>
              </>
            )}
            {doc.authorizedBy && (
              <>
                <dt>Utalványozó</dt>
                <dd>{doc.authorizedBy}</dd>
              </>
            )}
            {doc.checkedBy && (
              <>
                <dt>Ellenőrző</dt>
                <dd>{doc.checkedBy}</dd>
              </>
            )}
          </dl>
        </section>
        <section className="card" aria-labelledby="rogzites">
          <h2 id="rogzites">Rögzítés</h2>
          <dl className="preview-grid">
            <dt>Rögzítette</dt>
            <dd>
              {doc.createdByName} · {formatDateTimeHu(doc.createdAt)}
            </dd>
            {doc.postedAt && (
              <>
                <dt>Könyvelte</dt>
                <dd>
                  {doc.postedByName} · {formatDateTimeHu(doc.postedAt)}
                </dd>
              </>
            )}
            <dt>
              Rögzítési határidő <HelpTip term="rogzitesiHatarido" />
            </dt>
            <dd>
              {formatDateHu(doc.deadline.deadline)}
              {doc.status === "POSTED" &&
                (doc.deadline.status === "LATE" ? (
                  <span className="badge badge-warning">határidőn túl könyvelve</span>
                ) : (
                  <span className="muted"> – határidőn belül könyvelve</span>
                ))}
              {doc.status === "DRAFT" && <span className="muted"> – {deadlineText(doc.deadline)}</span>}
            </dd>
            {doc.contentHash && (
              <>
                <dt>Tartalmi lenyomat</dt>
                <dd className="mono small hash" title={doc.contentHash}>
                  {doc.contentHash.slice(0, 16)}…
                </dd>
              </>
            )}
          </dl>
        </section>
      </div>

      <AttachmentsSection documentId={doc.id} posted={posted} />

      {doc.settlements.length > 0 && (
        <section className="card" aria-labelledby="kiegyenlitesek">
          <h2 id="kiegyenlitesek">
            Kiegyenlítés <HelpTip term="kiegyenlites" />
          </h2>
          <ul className="plain-list stack">
            {doc.settlements.map((s) => (
              <li key={s.id} className="row">
                <span>
                  {s.role === "ITEM" ? "Kiegyenlítette:" : "Kiegyenlíti:"}{" "}
                  <Link to={`/konyveles/${s.otherDocumentId}`} className="mono">
                    {s.otherSerialNumber}
                  </Link>
                  {s.otherExternalNumber && <span className="muted"> ({s.otherExternalNumber})</span>} – <strong>{formatHuf(s.amount)}</strong>
                  {s.source === "REVERSAL" && <span className="muted"> (sztornó)</span>}
                </span>
                {canPost && s.source !== "REVERSAL" && <UnpairButton id={s.id} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" aria-labelledby="kontirozas">
        <h2 id="kontirozas">Kontírozás</h2>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Tételsorok</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Számla</th>
                <th scope="col" className="num">
                  Tartozik
                </th>
                <th scope="col" className="num">
                  Követel
                </th>
                <th scope="col">Tételszöveg</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l) => (
                <tr key={l.id}>
                  <td className="muted">{l.lineNo}.</td>
                  <td>
                    <span className="mono">{l.accountNumber}</span> {l.accountName}
                  </td>
                  <td className="num">{l.side === "D" ? formatHuf(l.amount) : ""}</td>
                  <td className="num">{l.side === "C" ? formatHuf(l.amount) : ""}</td>
                  <td>{l.description}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>
                  Összesen
                </th>
                <td className="num">
                  <strong>{formatHuf(doc.totalDebit)}</strong>
                </td>
                <td className="num">
                  <strong>{formatHuf(doc.totalCredit)}</strong>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </>
  );
}

/** Párosítás bontása (a könyvelést nem érinti; a tétel újra nyitott lesz). */
function UnpairButton({ id }: { id: string }) {
  const ws = useWorkspace();
  const toast = useToast();
  const invalidate = useInvalidateDocuments();
  return (
    <ConfirmDialog
      danger={false}
      trigger={
        <button type="button" className="btn btn-small">
          Párosítás bontása
        </button>
      }
      title="Párosítás bontása"
      description={<p>A tétel újra nyitott, a fizetés újra párosítatlan lesz. A könyvelést nem változtatja meg; a bontás az audit naplóba kerül.</p>}
      confirmLabel="Bontás"
      onConfirm={async () => {
        try {
          await del(`/api/companies/${ws.company!.id}/settlements/${id}`);
          await invalidate();
          toast("success", "A párosítás bontva.");
        } catch (err) {
          toast("error", err instanceof Error ? err.message : "Váratlan hiba történt.");
        }
      }}
    />
  );
}

/** Sztornó megerősítése: dátum és ok megadásával; a fókusz a „Mégse” gombon kezd. */
function ReverseDialog({ doc, onDone }: { doc: DocumentDto; onDone: (id: string) => void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const invalidate = useInvalidateDocuments();
  const [open, setOpen] = useState(false);
  const company = useQuery({
    queryKey: ["company", ws.company?.id],
    queryFn: () => get<CompanyDto>(`/api/companies/${ws.company!.id}`),
    enabled: open && Boolean(ws.company),
  });
  const [date, setDate] = useState(doc.accountingDate);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const s = await post<DocumentDto>(`/api/companies/${ws.company!.id}/documents/${doc.id}/reverse`, { accountingDate: date, reason });
      await invalidate();
      toast("success", `Sztornózva: ${s.serialNumber}`);
      setOpen(false);
      onDone(s.id);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setMessage(Object.keys(err.fields).length ? null : err.message);
      } else setMessage("Váratlan hiba történt.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setDate(doc.accountingDate);
          setReason("");
          setErrors({});
          setMessage(null);
        }
      }}
    >
      <AlertDialog.Trigger asChild>
        <button type="button" className="btn btn-danger">
          Sztornózás
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content className="dialog">
          <AlertDialog.Title asChild>
            <h2>Bizonylat sztornózása</h2>
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div>
              <p>
                A rendszer új, azonnal könyvelt <strong>sztornó bizonylatot</strong> készít a(z) <span className="mono">{doc.serialNumber}</span> összes tételével,{" "}
                {company.data?.reversalMethod === "NEGATIVE" ? "ugyanazon az oldalon, negatív előjellel" : "fordított oldalon"} (a cégadatoknál
                állítható). Az eredeti bizonylat változatlanul megmarad, és a kettő hivatkozik egymásra.
              </p>
              <p>
                <strong>A sztornó nem vonható vissza.</strong> Ha csak egy része hibás, használjon helyesbítő bizonylatot.
              </p>
            </div>
          </AlertDialog.Description>
          {message && (
            <div className="alert alert-error" role="alert">
              {message}
            </div>
          )}
          <div className="form-row">
            <Field label="A sztornó könyvelési dátuma" required error={errors.accountingDate} hint="Nyitott időszakba eshet.">
              {(p) => <DateInput controlProps={p} value={date} defaultYear={Number(doc.accountingDate.slice(0, 4))} onChange={setDate} />}
            </Field>
            <Field label="A sztornó oka" required error={errors.reason}>
              {(p) => <input {...p} type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Pl. téves rögzítés" />}
            </Field>
          </div>
          <div className="dialog-actions">
            <AlertDialog.Cancel asChild>
              <button type="button" className="btn">
                Mégse
              </button>
            </AlertDialog.Cancel>
            <button type="button" className="btn btn-danger-solid" disabled={busy} onClick={submit}>
              Sztornózás
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
