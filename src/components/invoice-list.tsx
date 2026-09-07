import Link from "next/link";
import {
  formatCurrency,
  formatDate,
  invoiceDirectionLabels,
  invoiceStatusColors,
  invoiceStatusLabels,
} from "@/lib/format";
import { deleteInvoiceAction } from "@/app/(app)/szamlak/actions";

type InvoiceRow = {
  id: string;
  fileName: string;
  status: string;
  direction: string;
  partnerNameRaw: string | null;
  issueDate: Date | null;
  grossAmount: unknown;
  categoryName?: string | null;
  createdAt: Date;
};

export function InvoiceList({ invoices, showDetails = false }: { invoices: InvoiceRow[]; showDetails?: boolean }) {
  if (invoices.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        Még nincs feltöltött bizonylat.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3">Fájl</th>
            <th className="px-4 py-3">Irány</th>
            {showDetails && <th className="px-4 py-3">Partner</th>}
            {showDetails && <th className="px-4 py-3">Dátum</th>}
            {showDetails && <th className="px-4 py-3">Bruttó</th>}
            {showDetails && <th className="px-4 py-3">Kategória</th>}
            <th className="px-4 py-3">Státusz</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {invoices.map((inv) => (
            <tr key={inv.id}>
              <td className="px-4 py-3">
                <Link href={`/szamlak/${inv.id}`} className="font-medium text-slate-900 hover:underline">
                  {inv.fileName}
                </Link>
                <div className="text-xs text-slate-400">Feltöltve: {formatDate(inv.createdAt)}</div>
              </td>
              <td className="px-4 py-3 text-slate-600">{invoiceDirectionLabels[inv.direction]}</td>
              {showDetails && <td className="px-4 py-3 text-slate-600">{inv.partnerNameRaw ?? "—"}</td>}
              {showDetails && <td className="px-4 py-3 text-slate-600">{formatDate(inv.issueDate)}</td>}
              {showDetails && (
                <td className="px-4 py-3 text-slate-600">{formatCurrency(inv.grossAmount as never)}</td>
              )}
              {showDetails && <td className="px-4 py-3 text-slate-600">{inv.categoryName ?? "—"}</td>}
              <td className="px-4 py-3">
                <span
                  className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${invoiceStatusColors[inv.status]}`}
                >
                  {invoiceStatusLabels[inv.status]}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <form action={deleteInvoiceAction}>
                  <input type="hidden" name="invoiceId" value={inv.id} />
                  <button type="submit" className="text-xs font-medium text-red-600 hover:underline">
                    Törlés
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
