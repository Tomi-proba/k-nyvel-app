import { DOCUMENT_STATUS_LABELS } from "@konyvelo/shared";

/** A bizonylat állapota: piszkozat, könyvelt, sztornózva. */
export function StatusBadge({ status, reversed }: { status: "DRAFT" | "POSTED"; reversed: boolean }) {
  if (reversed) return <span className="badge">{DOCUMENT_STATUS_LABELS.REVERSED}</span>;
  return <span className={`badge ${status === "POSTED" ? "badge-success" : "badge-warning"}`}>{DOCUMENT_STATUS_LABELS[status]}</span>;
}
