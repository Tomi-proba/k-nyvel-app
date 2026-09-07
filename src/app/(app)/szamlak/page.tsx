import { requireActiveMembership } from "@/lib/current-company";
import { db } from "@/lib/db";
import { UploadDropzone } from "@/components/upload-dropzone";
import { InvoiceList } from "@/components/invoice-list";
import { InvoiceFilters } from "@/components/invoice-filters";
import { parseFilterParams, buildInvoiceWhere } from "@/lib/invoice-filters";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { membership } = await requireActiveMembership();
  const resolvedSearchParams = await searchParams;
  const filters = parseFilterParams(resolvedSearchParams);
  const where = buildInvoiceWhere(membership.companyId, filters);

  const [invoices, categories] = await Promise.all([
    db.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { category: { select: { name: true } } },
    }),
    db.category.findMany({ where: { companyId: membership.companyId }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Számlák</h1>
      <UploadDropzone />
      <InvoiceFilters filters={filters} categories={categories} />
      <InvoiceList
        showDetails
        invoices={invoices.map((inv) => ({ ...inv, categoryName: inv.category?.name }))}
      />
    </div>
  );
}
