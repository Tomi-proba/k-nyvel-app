import { requireActiveMembership } from "@/lib/current-company";
import { db } from "@/lib/db";

const typeLabels: Record<string, string> = {
  INCOME: "Bevétel",
  EXPENSE: "Kiadás",
  BOTH: "Mindkettő",
};

export default async function CategoriesPage() {
  const { membership } = await requireActiveMembership();
  const categories = await db.category.findMany({
    where: { companyId: membership.companyId },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Kategóriák</h1>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Név</th>
              <th className="px-4 py-3">Típus</th>
              <th className="px-4 py-3">Kulcsszavak</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {categories.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{c.name}</td>
                <td className="px-4 py-3 text-slate-500">{typeLabels[c.type]}</td>
                <td className="px-4 py-3 text-slate-500">{c.keywords.join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-slate-500">
        A szabály alapú kategorizálás és a partner-tanulás a 3. fázisban készül el.
      </p>
    </div>
  );
}
