import { requireActiveMembership } from "@/lib/current-company";
import { db } from "@/lib/db";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { setPartnerCategoryAction } from "./actions";

const typeLabels: Record<string, string> = {
  INCOME: "Bevétel",
  EXPENSE: "Kiadás",
  BOTH: "Mindkettő",
};

export default async function CategoriesPage() {
  const { membership } = await requireActiveMembership();
  const [categories, partners] = await Promise.all([
    db.category.findMany({ where: { companyId: membership.companyId }, orderBy: { name: "asc" } }),
    db.partner.findMany({
      where: { companyId: membership.companyId },
      orderBy: { name: "asc" },
      include: { defaultCategory: { select: { name: true } } },
    }),
  ]);

  const categoryOptions = categories.map((c) => ({ value: c.id, label: c.name }));

  return (
    <div className="space-y-8">
      <div className="space-y-3">
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
          A kiállító nevében található kulcsszó alapján a rendszer automatikusan javasol kategóriát
          egy új bizonylathoz.
        </p>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Partnerek és tanult kategóriák</h2>
        {partners.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            Még nincs rögzített partner. Tölts fel egy számlát, vagy hagyj jóvá egy bizonylatot
            partnerrel a Számlák menüpontban.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Partner</th>
                  <th className="px-4 py-3">Adószám</th>
                  <th className="px-4 py-3">Alapértelmezett kategória</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {partners.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-medium text-slate-900">{p.name}</td>
                    <td className="px-4 py-3 text-slate-500">{p.taxNumber ?? "—"}</td>
                    <td className="px-4 py-3">
                      <AutoSubmitSelect
                        action={setPartnerCategoryAction}
                        name="categoryId"
                        defaultValue={p.defaultCategoryId ?? ""}
                        options={categoryOptions}
                        emptyLabel="Nincs beállítva"
                        hidden={{ partnerId: p.id }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-sm text-slate-500">
          Ha egy bizonylat jóváhagyásakor kategóriát választasz egy partnerhez, azt itt is
          módosíthatod — a rendszer legközelebb automatikusan ezt fogja javasolni ugyanahhoz a
          partnerhez.
        </p>
      </div>
    </div>
  );
}
