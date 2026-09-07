import Link from "next/link";
import type { InvoiceFilterParams } from "@/lib/invoice-filters";

type Category = { id: string; name: string };

export function InvoiceFilters({
  filters,
  categories,
}: {
  filters: InvoiceFilterParams;
  categories: Category[];
}) {
  const exportQuery = new URLSearchParams();
  if (filters.from) exportQuery.set("from", filters.from);
  if (filters.to) exportQuery.set("to", filters.to);
  if (filters.direction) exportQuery.set("direction", filters.direction);
  if (filters.categoryId) exportQuery.set("categoryId", filters.categoryId);
  if (filters.partner) exportQuery.set("partner", filters.partner);

  const xlsxHref = `/api/invoices/export?${new URLSearchParams({ ...Object.fromEntries(exportQuery), format: "xlsx" }).toString()}`;
  const csvHref = `/api/invoices/export?${new URLSearchParams({ ...Object.fromEntries(exportQuery), format: "csv" }).toString()}`;

  return (
    <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <label htmlFor="from" className="mb-1 block text-xs font-medium text-slate-500">
          Dátumtól
        </label>
        <input
          id="from"
          name="from"
          type="date"
          defaultValue={filters.from ?? ""}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="to" className="mb-1 block text-xs font-medium text-slate-500">
          Dátumig
        </label>
        <input
          id="to"
          name="to"
          type="date"
          defaultValue={filters.to ?? ""}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="direction" className="mb-1 block text-xs font-medium text-slate-500">
          Irány
        </label>
        <select
          id="direction"
          name="direction"
          defaultValue={filters.direction ?? ""}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
        >
          <option value="">Mind</option>
          <option value="INCOME">Bevétel</option>
          <option value="EXPENSE">Kiadás</option>
        </select>
      </div>
      <div>
        <label htmlFor="categoryId" className="mb-1 block text-xs font-medium text-slate-500">
          Kategória
        </label>
        <select
          id="categoryId"
          name="categoryId"
          defaultValue={filters.categoryId ?? ""}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
        >
          <option value="">Mind</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="partner" className="mb-1 block text-xs font-medium text-slate-500">
          Partner neve
        </label>
        <input
          id="partner"
          name="partner"
          type="text"
          placeholder="pl. Telekom"
          defaultValue={filters.partner ?? ""}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>
      <button
        type="submit"
        className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
      >
        Szűrés
      </button>
      <Link href="/szamlak" className="text-sm text-slate-500 hover:underline">
        Szűrők törlése
      </Link>
      <div className="ml-auto flex gap-2">
        <a
          href={xlsxHref}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Excel export
        </a>
        <a
          href={csvHref}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          CSV export
        </a>
      </div>
    </form>
  );
}
