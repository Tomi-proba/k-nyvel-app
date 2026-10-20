import * as Dialog from "@radix-ui/react-dialog";
import { DOCUMENT_TYPES, formatDateHu, formatHuf, type Balance, type DeadlineStatus, type DocumentType } from "@konyvelo/domain";
import type { AccountDto } from "@konyvelo/shared";
import type { PreparedLine } from "./entry-model";

export type PreviewData = {
  docType: DocumentType;
  partnerName: string | null;
  externalNumber: string;
  description: string;
  issueDate: string;
  fulfillmentDate: string;
  accountingDate: string;
  dueDate: string;
  lines: PreparedLine[];
  balance: Balance;
  deadline: { deadline: string; rule: string; status: DeadlineStatus } | null;
  correctsSerial: string | null;
};

/**
 * Előnézet könyvelés előtt (PLAN 5.2): a bizonylat adatai, a kontírozás és a
 * partner egyenlegére gyakorolt hatás. A „Könyvelés” gombon van a fókusz,
 * így Enterrel véglegesíthető; Esc-kel vissza lehet térni a szerkesztéshez.
 */
export function PreviewDialog({
  open,
  onOpenChange,
  data,
  accounts,
  busy,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: PreviewData | null;
  accounts: ReadonlyMap<string, AccountDto>;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  if (!data) return null;
  const effect = (sub: "CUSTOMER" | "SUPPLIER") =>
    data.lines.reduce((s, l) => {
      const a = l.accountId ? accounts.get(l.accountId) : undefined;
      if (a?.subledger !== sub || !l.amount) return s;
      const sign = (l.side === "D") === (sub === "CUSTOMER") ? 1 : -1;
      return s + sign * l.amount;
    }, 0);
  const supplierEffect = effect("SUPPLIER");
  const customerEffect = effect("CUSTOMER");
  const signed = (v: number) => (v > 0 ? "+" : "") + formatHuf(v);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog dialog-wide" aria-describedby={undefined}>
          <Dialog.Title asChild>
            <h2>Előnézet – könyvelés előtt</h2>
          </Dialog.Title>
          <dl className="preview-grid">
            <dt>Típus</dt>
            <dd>{DOCUMENT_TYPES[data.docType].label}</dd>
            {data.correctsSerial && (
              <>
                <dt>Helyesbíti</dt>
                <dd className="mono">{data.correctsSerial}</dd>
              </>
            )}
            {data.partnerName && (
              <>
                <dt>Partner</dt>
                <dd>{data.partnerName}</dd>
              </>
            )}
            {data.externalNumber && (
              <>
                <dt>{DOCUMENT_TYPES[data.docType].externalNumberLabel}</dt>
                <dd className="mono">{data.externalNumber}</dd>
              </>
            )}
            <dt>Leírás</dt>
            <dd>{data.description}</dd>
            <dt>Kelt</dt>
            <dd>{formatDateHu(data.issueDate)}</dd>
            {data.fulfillmentDate && (
              <>
                <dt>Teljesítés</dt>
                <dd>{formatDateHu(data.fulfillmentDate)}</dd>
              </>
            )}
            <dt>Könyvelés dátuma</dt>
            <dd>{formatDateHu(data.accountingDate)}</dd>
            {data.dueDate && (
              <>
                <dt>Fizetési határidő</dt>
                <dd>{formatDateHu(data.dueDate)}</dd>
              </>
            )}
          </dl>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Kontírozás</caption>
              <thead>
                <tr>
                  <th scope="col">Számla</th>
                  <th scope="col" className="num">
                    Tartozik
                  </th>
                  <th scope="col" className="num">
                    Követel
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l) => {
                  const a = l.accountId ? accounts.get(l.accountId) : undefined;
                  return (
                    <tr key={l.key}>
                      <td>
                        <span className="mono">{a?.number}</span> {a?.name}
                        {l.description && <div className="muted small">{l.description}</div>}
                      </td>
                      <td className="num">{l.side === "D" && l.amount ? formatHuf(l.amount) : ""}</td>
                      <td className="num">{l.side === "C" && l.amount ? formatHuf(l.amount) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Összesen</th>
                  <td className="num">
                    <strong>{formatHuf(data.balance.debit)}</strong>
                  </td>
                  <td className="num">
                    <strong>{formatHuf(data.balance.credit)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {(supplierEffect !== 0 || customerEffect !== 0) && (
            <p>
              {supplierEffect !== 0 && <>Hatás a szállítói tartozásra: <strong>{signed(supplierEffect)}</strong>. </>}
              {customerEffect !== 0 && <>Hatás a vevői követelésre: <strong>{signed(customerEffect)}</strong>.</>}
            </p>
          )}
          {data.deadline && data.deadline.status === "OVERDUE" && (
            <div className="alert alert-warning">
              <strong>Határidőn túli rögzítés.</strong> A rögzítési határidő {formatDateHu(data.deadline.deadline)} volt. {data.deadline.rule} A bizonylat
              ettől még könyvelhető; a késést a rendszer a bizonylaton jelzi.
            </div>
          )}
          <p className="muted small">Könyvelés után a bizonylat sorszámot kap, és nem módosítható; javítani sztornóval vagy helyesbítő bizonylattal lehet.</p>
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <button type="button" className="btn">
                Vissza a szerkesztéshez
              </button>
            </Dialog.Close>
            <button type="button" className="btn btn-primary" autoFocus disabled={busy} onClick={onConfirm}>
              {busy ? "Könyvelés…" : "Könyvelés"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
