import Link from "next/link";
import { requireActiveMembership } from "@/lib/current-company";

const roleLabels: Record<string, string> = {
  OWNER: "Tulajdonos",
  ACCOUNTANT: "Könyvelő",
  MEMBER: "Munkatárs",
};

export default async function CompaniesPage() {
  const { allMemberships, membership } = await requireActiveMembership();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Cégek</h1>
        <Link
          href="/cegek/uj"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          + Új cég
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Cégnév</th>
              <th className="px-4 py-3">Adószám</th>
              <th className="px-4 py-3">Szerepkör</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {allMemberships.map((m) => (
              <tr key={m.companyId} className={m.companyId === membership.companyId ? "bg-slate-50" : undefined}>
                <td className="px-4 py-3 font-medium text-slate-900">{m.company.name}</td>
                <td className="px-4 py-3 text-slate-500">{m.company.taxNumber ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500">{roleLabels[m.role] ?? m.role}</td>
                <td className="px-4 py-3 text-right">
                  {m.companyId === membership.companyId ? (
                    <span className="text-xs font-medium text-emerald-600">Aktív</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-slate-500">
        Könyvelőiroda vagy? Hozz létre új céget minden ügyfeledhez, és a fenti listából bármikor
        válts közöttük.
      </p>
    </div>
  );
}
