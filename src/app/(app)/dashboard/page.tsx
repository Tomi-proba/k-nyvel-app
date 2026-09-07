import { requireActiveMembership } from "@/lib/current-company";

export default async function DashboardPage() {
  const { membership } = await requireActiveMembership();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Áttekintő — {membership.company.name}</h1>
        <p className="text-sm text-slate-500">
          A havi bontású összesítő és az ÁFA-kimutatás a 4. fázisban készül el.
        </p>
      </div>
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        Nincs még megjeleníthető adat. Tölts fel egy számlát a Számlák menüpontban.
      </div>
    </div>
  );
}
