import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { AttachmentDto } from "@konyvelo/shared";
import { useWorkspace } from "../../app/workspace";
import { del, get, getBlob, uploadFile } from "../../lib/api";
import { formatDateTimeHu } from "../../lib/format";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { useToast } from "../../ui/Toasts";
import { HelpTip } from "../../ui/Tooltip";
import { documentsKey, useInvalidateDocuments } from "./queries";

const TYPE_LABEL: Record<AttachmentDto["mimeType"], string> = { "application/pdf": "PDF", "image/jpeg": "JPEG", "image/png": "PNG" };

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bájt`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/**
 * A bizonylat csatolmányai (K9): feltöltés, lista, előnézet az oldalon (új ablak nélkül) és letöltés.
 * Piszkozat csatolmánya törölhető; könyvelt bizonylathoz csak újabb tölthető fel.
 */
export function AttachmentsSection({ documentId, posted }: { documentId: string; posted: boolean }) {
  const ws = useWorkspace();
  const toast = useToast();
  const invalidate = useInvalidateDocuments();
  const companyId = ws.company!.id;
  const base = `/api/companies/${companyId}/documents/${documentId}/attachments`;
  const list = useQuery({ queryKey: [...documentsKey(companyId), "attachments", documentId], queryFn: () => get<AttachmentDto[]>(base) });
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AttachmentDto | null>(null);
  const canEdit = ws.can("ledger:post");

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const f of Array.from(files)) {
        try {
          await uploadFile<AttachmentDto>(base, f);
          toast("success", `Feltöltve: ${f.name}`);
        } catch (err) {
          setError(`${f.name}: ${err instanceof Error ? err.message : "Váratlan hiba történt."}`);
        }
      }
      await invalidate();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const items = list.data ?? [];
  return (
    <section className="card" aria-labelledby="csatolmanyok">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="csatolmanyok" style={{ margin: 0 }}>
          Csatolmányok <HelpTip term="csatolmany" />
        </h2>
        {canEdit && (
          <>
            <input
              ref={input}
              id={`csatolmany-${documentId}`}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-label="Csatolmány feltöltése (PDF, JPEG vagy PNG)"
              onChange={(e) => void upload(e.target.files)}
            />
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? "Feltöltés…" : "Fájl feltöltése"}
            </button>
          </>
        )}
      </div>
      <p className="muted small">
        PDF, JPEG vagy PNG. {posted ? "Könyvelt bizonylat csatolmánya nem törölhető; újabb feltölthető mellé." : "A könyveléskor a csatolmányok lenyomata a bizonylat lenyomatába kerül."} A csatolmány nem minősül hiteles
        elektronikus másolatnak: a papíralapú eredetit továbbra is meg kell őrizni (Szt. 169. § (6)).
      </p>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {list.error && (
        <div className="alert alert-error" role="alert">
          {list.error.message}
        </div>
      )}
      {items.length === 0 && !list.isLoading ? (
        <p className="muted">Nincs csatolmány.</p>
      ) : (
        <ul className="plain-list stack">
          {items.map((a) => (
            <li key={a.id} className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
              <span>
                <button type="button" className="btn-link" onClick={() => setPreview(a)}>
                  {a.fileName}
                </button>{" "}
                <span className="muted small">
                  {TYPE_LABEL[a.mimeType]} · {formatBytes(a.sizeBytes)} · {a.uploadedByName} · {formatDateTimeHu(a.uploadedAt)}
                  {a.locked && (a.inDocumentHash ? " · a bizonylat lenyomatában" : " · könyvelés után feltöltve")}
                </span>
                <br />
                <span className="mono small hash" title={`SHA-256: ${a.sha256}`}>
                  SHA-256: {a.sha256.slice(0, 16)}…
                </span>
              </span>
              <span className="row">
                <button type="button" className="btn btn-small" onClick={() => setPreview(a)}>
                  Előnézet
                </button>
                <a className="btn btn-small" href={`${base}/${a.id}/content?letoltes=1`} download={a.fileName}>
                  Letöltés
                </a>
                {canEdit && !a.locked && (
                  <ConfirmDialog
                    trigger={
                      <button type="button" className="btn btn-small btn-danger" aria-label={`${a.fileName} törlése`}>
                        Törlés
                      </button>
                    }
                    title="Csatolmány törlése"
                    description={<p>A(z) „{a.fileName}” csatolmány törlődik a piszkozatról. A törlés az audit naplóba kerül.</p>}
                    confirmLabel="Törlés"
                    onConfirm={async () => {
                      try {
                        await del(`${base}/${a.id}`);
                        await invalidate();
                        toast("success", "A csatolmány törölve.");
                      } catch (err) {
                        toast("error", err instanceof Error ? err.message : "Váratlan hiba történt.");
                      }
                    }}
                  />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <AttachmentPreview attachment={preview} url={preview ? `${base}/${preview.id}/content` : null} onClose={() => setPreview(null)} />
    </section>
  );
}

/** Előnézet párbeszédablakban: PDF beágyazva, kép közvetlenül. A fájlt a lenyomat-ellenőrzés után kapjuk. */
function AttachmentPreview({ attachment, url, onClose }: { attachment: AttachmentDto | null; url: string | null; onClose: () => void }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!url || !attachment) return;
    let revoked = false;
    let created: string | null = null;
    setObjectUrl(null);
    setError(null);
    getBlob(url)
      .then((blob) => {
        if (revoked) return;
        created = URL.createObjectURL(new Blob([blob], { type: attachment.mimeType }));
        setObjectUrl(created);
      })
      .catch((err: unknown) => !revoked && setError(err instanceof Error ? err.message : "Váratlan hiba történt."));
    return () => {
      revoked = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url, attachment]);

  return (
    <Dialog.Root open={Boolean(attachment)} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog dialog-preview" aria-describedby={undefined}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <Dialog.Title asChild>
              <h2 style={{ margin: 0 }}>{attachment?.fileName}</h2>
            </Dialog.Title>
            <span className="row">
              {url && attachment && (
                <a className="btn btn-small" href={`${url}?letoltes=1`} download={attachment.fileName}>
                  Letöltés
                </a>
              )}
              <Dialog.Close asChild>
                <button type="button" className="btn btn-small">
                  Bezárás
                </button>
              </Dialog.Close>
            </span>
          </div>
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
          {!error && !objectUrl && <p className="muted">Betöltés…</p>}
          {objectUrl && attachment?.mimeType === "application/pdf" && <iframe className="attachment-frame" src={objectUrl} title={`Előnézet: ${attachment.fileName}`} />}
          {objectUrl && attachment && attachment.mimeType !== "application/pdf" && <img className="attachment-image" src={objectUrl} alt={`Csatolmány: ${attachment.fileName}`} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
