import Link from "next/link";
import { requireActiveMembership } from "@/lib/current-company";
import { db } from "@/lib/db";
import { summarizeByMonth } from "@/lib/vat";
import { formatCurrency, HU_MONTHS } from "@/lib/format";
import { InvoiceList } from "@/components/invoice-list";

function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  return `${year}. ${HU_MONTHS[Number(m) - 1]}`;
}

function monthRange(month: string): { start: Date; end: Date } {
  const [year, m] = month.split("-").map(Number);
  return { start: new Date(Date.UTC(year, m - 1, 1)), end: new Date(Date.UTC(year, m, 1)) };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { membership } = await requireActiveMembership();
  const resolved = await searchParams;
  const requestedMonth = typeof resolved.month === "string" ? resolved.month : undefined;

  const [allDatedInvoices, reviewCount] = await Promise.all([
    db.invoice.findMany({
      where: { companyId: membership.companyId, issueDate: { not: null } },
      select: { direction: true, issueDate: true, netAmount: true, vatAmount: true, grossAmount: true },
    }),
    db.invoice.count({
      where: { companyId: membership.companyId, status: { in: ["NEEDS_REVIEW", "PROCESSING", "ERROR"] } },
    }),
  ]);

  const monthlySummaries = summarizeByMonth(
    allDatedInvoices.map((inv) => ({
      direction: inv.direction,
      issueDate: inv.issueDate,
      netAmount: inv.netAmount ? Number(inv.netAmount) : null,
      vatAmount: inv.vatAmount ? Number(inv.vatAmount) : null,
      grossAmount: inv.grossAmount ? Number(inv.grossAmount) : null,
    }))
  );

  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const selectedMonth =
    (requestedMonth && monthlySummaries.some((s) => s.month === requestedMonth) && requestedMonth) ||
    monthlySummaries[0]?.month ||
    currentMonthKey;

  const selectedSummary = monthlySummaries.find((s) => s.month === selectedMonth);
  const { start, end } = monthRange(selectedMonth);

  const monthInvoices = await db.invoice.findMany({
    where: { companyId: membership.companyId, issueDate: { gte: start, lt: end } },
    orderBy: { issueDate: "desc" },
    include: { category: { select: { name: true } } },
  });

  const categoryTotals = new Map<string, { name: string; expenseGross: number; incomeGross: number }>();
  for (const inv of monthInvoices) {
    const name = inv.category?.name ?? "Kategorizálatlan";
    const entry = categoryTotals.get(name) ?? { name, expenseGross: 0, incomeGross: 0 };
    const gross = inv.grossAmount ? Number(inv.grossAmount) : 0;
    if (inv.direction === "EXPENSE") entry.expenseGross += gross;
    else entry.incomeGross += gross;
    categoryTotals.set(name, entry);
  }
  const categoryRows = Array.from(categoryTotals.values()).sort(
    (a, b) => b.expenseGross + b.incomeGross - (a.expenseGross + a.incomeGross)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Összesítők — {membership.company.name}</h1>
        {reviewCount > 0 && (
          <Link
            href="/szamlak"
            className="rounded-full bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-200"
          >
            {reviewCount} bizonylat vár ellenőrzésre
          </Link>
        )}
      </div>

      {monthlySummaries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Nincs még megjeleníthető adat. Tölts fel egy számlát a Számlák menüpontban.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {monthlySummaries.map((s) => (
              <Link
                key={s.month}
                href={`/dashboard?month=${s.month}`}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  s.month === selectedMonth
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                }`}
              >
                {monthLabel(s.month)}
              </Link>
            ))}
          </div>

          <h2 className="text-lg font-semibold text-slate-900">{monthLabel(selectedMonth)}</h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Bevétel (bruttó)" value={formatCurrency(selectedSummary?.incomeGross ?? 0)} tone="emerald" />
            <SummaryCard label="Kiadás (bruttó)" value={formatCurrency(selectedSummary?.expenseGross ?? 0)} tone="red" />
            <SummaryCard label="Egyenleg" value={formatCurrency(selectedSummary?.balanceGross ?? 0)} tone="slate" />
            <SummaryCard
              label="ÁFA egyenleg"
              value={formatCurrency(selectedSummary?.vatBalance ?? 0)}
              tone="blue"
              hint={
                (selectedSummary?.vatBalance ?? 0) >= 0
                  ? "Becsült fizetendő ÁFA"
                  : "Becsült visszaigényelhető ÁFA"
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Nettó / ÁFA részletek</h3>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2" />
                      <th className="px-4 py-2">Nettó</th>
                      <th className="px-4 py-2">ÁFA</th>
                      <th className="px-4 py-2">Bruttó</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="px-4 py-2 font-medium text-slate-700">Bevétel</td>
                      <td className="px-4 py-2">{formatCurrency(selectedSummary?.incomeNet ?? 0)}</td>
                      <td className="px-4 py-2">{formatCurrency(selectedSummary?.incomeVat ?? 0)}</td>
                      <td className="px-4 py-2">{formatCurrency(selectedSummary?.incomeGross ?? 0)}</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 font-medium text-slate-700">Kiadás</td>
                      <td className="px-4 py-2">{formatCurrency(selectedSummary?.expenseNet ?? 0)}</td>
                      <td className="px-4 py-2">{formatCurrency(selectedSummary?.expenseVat ?? 0)}</td>
                      <td className="px-4 py-2">{formatCurrency(selectedSummary?.expenseGross ?? 0)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Kategóriánként (bruttó)</h3>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Kategória</th>
                      <th className="px-4 py-2">Bevétel</th>
                      <th className="px-4 py-2">Kiadás</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {categoryRows.map((c) => (
                      <tr key={c.name}>
                        <td className="px-4 py-2 font-medium text-slate-700">{c.name}</td>
                        <td className="px-4 py-2">{c.incomeGross ? formatCurrency(c.incomeGross) : "—"}</td>
                        <td className="px-4 py-2">{c.expenseGross ? formatCurrency(c.expenseGross) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">
              Bizonylatok — {monthLabel(selectedMonth)} ({monthInvoices.length} db)
            </h3>
            <InvoiceList
              showDetails
              invoices={monthInvoices.map((inv) => ({ ...inv, categoryName: inv.category?.name }))}
            />
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: "emerald" | "red" | "slate" | "blue";
  hint?: string;
}) {
  const toneClasses: Record<string, string> = {
    emerald: "text-emerald-600",
    red: "text-red-600",
    slate: "text-slate-900",
    blue: "text-blue-600",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${toneClasses[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
