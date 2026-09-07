import { notFound } from "next/navigation";
import Link from "next/link";
import { requireActiveMembership } from "@/lib/current-company";
import { db } from "@/lib/db";
import { getStorageDriver } from "@/lib/storage";
import { InvoiceReviewForm } from "@/components/invoice-review-form";
import { invoiceStatusColors, invoiceStatusLabels } from "@/lib/format";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { membership } = await requireActiveMembership();

  const invoice = await db.invoice.findFirst({
    where: { id, companyId: membership.companyId },
  });
  if (!invoice) notFound();

  const categories = await db.category.findMany({
    where: { companyId: membership.companyId },
    orderBy: { name: "asc" },
  });

  const fileUrl = await getStorageDriver().getUrl(invoice.fileUrl);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/szamlak" className="text-sm text-slate-500 hover:underline">
            ← Vissza a számlákhoz
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">{invoice.fileName}</h1>
        </div>
        <span
          className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${invoiceStatusColors[invoice.status]}`}
        >
          {invoiceStatusLabels[invoice.status]}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {invoice.mimeType === "application/pdf" ? (
            <iframe src={fileUrl} className="h-[600px] w-full" title={invoice.fileName} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl} alt={invoice.fileName} className="max-h-[600px] w-full object-contain" />
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <InvoiceReviewForm
            invoice={{
              id: invoice.id,
              direction: invoice.direction,
              partnerNameRaw: invoice.partnerNameRaw,
              partnerTaxNumber: invoice.partnerTaxNumber,
              issueDate: invoice.issueDate,
              dueDate: invoice.dueDate,
              netAmount: invoice.netAmount,
              vatAmount: invoice.vatAmount,
              grossAmount: invoice.grossAmount,
              vatRate: invoice.vatRate,
              categoryId: invoice.categoryId,
              notes: invoice.notes,
              uncertainFields: invoice.uncertainFields,
            }}
            categories={categories}
          />
        </div>
      </div>
    </div>
  );
}
