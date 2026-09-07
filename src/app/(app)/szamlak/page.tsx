import { requireActiveMembership } from "@/lib/current-company";
import { db } from "@/lib/db";
import { UploadDropzone } from "@/components/upload-dropzone";
import { InvoiceList } from "@/components/invoice-list";

export default async function InvoicesPage() {
  const { membership } = await requireActiveMembership();

  const invoices = await db.invoice.findMany({
    where: { companyId: membership.companyId },
    orderBy: { createdAt: "desc" },
    include: { category: { select: { name: true } } },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Számlák</h1>
      <UploadDropzone />
      <InvoiceList
        showDetails
        invoices={invoices.map((inv) => ({ ...inv, categoryName: inv.category?.name }))}
      />
    </div>
  );
}
