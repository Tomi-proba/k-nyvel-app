import Link from "next/link";
import { requireActiveMembership } from "@/lib/current-company";
import { db } from "@/lib/db";
import {
  buildDraftIncomeStatement,
  listAvailablePeriods,
  periodKeyForDate,
  type PeriodGranularity,
} from "@/lib/draft-statement";
import { formatCurrency } from "@/lib/format";
import { LegalDisclaimerBanner } from "@/components/legal-disclaimer-banner";

const GRANULARITY_LABEL: Record<PeriodGranularity, string> = {
  month: "Hónap",
  quarter: "Negyedév",
  year: "Év",
};

function isGranularity(v: string | undefined): v is PeriodGranularity {
  return v === "month" || v === "quarter" || v === "year";
}

export default async function DraftStatementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { membership } = await requireActiveMembership();
  const resolved = await searchParams;

  const granularityParam = typeof resolved.g === "string" ? resolved.g : undefined;
  const granularity: PeriodGranularity = isGranularity(granularityParam) ? granularityParam : "month";
  const requestedPeriod = typeof resolved.p === "string" ? resolved.p : undefined;

  const invoices = await db.invoice.findMany({
    where: { companyId: membership.companyId, issueDate: { not: null } },
    select: { status: true, direction: true, issueDate: true, netAmount: true, category: { select: { name: true } } },
  });

  const draftInvoices = invoices.map((inv) => ({
    status: inv.status,
    direction: inv.direction,
    issueDate: inv.issueDate,
    netAmount: inv.netAmount ? Number(inv.netAmount) : null,
    categoryName: inv.category?.name ?? null,
  }));

  const availablePeriods = listAvailablePeriods(
    draftInvoices.map((i) => i.issueDate).filter((d): d is Date => d !== null),
    granularity
  );

  const currentPeriodKey = periodKeyForDate(new Date(), granularity);
  const selectedPeriod =
    (requestedPeriod && availablePeriods.some((p) => p.key === requestedPeriod) && requestedPeriod) ||
    availablePeriods[0]?.key ||
    currentPeriodKey;

  const statement = buildDraftIncomeStatement(draftInvoices, granularity, selectedPeriod);

  // A kizárt (nem jóváhagyott) tételekre mutató szűrt link a Számlák nézetre.
  const filterTo = new Date(statement.periodEnd);
  filterTo.setUTCDate(filterTo.getUTCDate() - 1);
  const reviewLinkHref = `/szamlak?from=${statement.periodStart.toISOString().slice(0, 10)}&to=${filterTo
    .toISOString()
    .slice(0, 10)}`;

  const exportQuery = (format: "pdf" | "xlsx") =>
    `/api/reports/draft-statement/export?granularity=${granularity}&period=${encodeURIComponent(selectedPeriod)}&format=${format}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Tervezet pénzügyi kimutatás</h1>
        <p className="mt-1 text-sm text-slate-500">
          A jóváhagyott bizonylatok alapján számolt, durva becslés — nem hivatalos könyvelés.
        </p>
      </div>

      <LegalDisclaimerBanner />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
          {(Object.keys(GRANULARITY_LABEL) as PeriodGranularity[]).map((g) => (
            <Link
              key={g}
              href={`/tervezet?g=${g}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                g === granularity ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {GRANULARITY_LABEL[g]}
            </Link>
          ))}
        </div>

        <div className="flex gap-2">
          <a
            href={exportQuery("pdf")}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            PDF export
          </a>
          <a
            href={exportQuery("xlsx")}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Excel export
          </a>
        </div>
      </div>

      {availablePeriods.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Még nincs dátummal rendelkező bizonylat. Tölts fel és hagyj jóvá legalább egy számlát a Számlák
          menüpontban, hogy tervezetet tudjunk számolni.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {availablePeriods.map((p) => (
              <Link
                key={p.key}
                href={`/tervezet?g=${granularity}&p=${encodeURIComponent(p.key)}`}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  p.key === selectedPeriod
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {p.label}
              </Link>
            ))}
          </div>

          <div>
            <h2 className="text-lg font-semibold text-slate-900">{statement.periodLabel}</h2>
            <p className="mt-1 text-xs text-slate-500">
              Nettó (ÁFA nélküli) összegek. Écs-elszámolást és időbeli elhatárolást nem tartalmaz.
            </p>
          </div>

          {statement.excludedNotConfirmedCount > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {statement.excludedNotConfirmedCount} bizonylat még ellenőrzésre vár ebben az időszakban — ezek
              adatai nem eléggé megbízhatóak, ezért nem szerepelnek a tervezetben.{" "}
              <Link href={reviewLinkHref} className="font-medium underline">
                Ellenőrzöm most
              </Link>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <StatementTable title="Bevételek" lines={statement.incomeLines} total={statement.incomeTotal} tone="emerald" />
            <StatementTable title="Ráfordítások" lines={statement.expenseLines} total={statement.expenseTotal} tone="red" />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-sm font-medium text-slate-500">Tervezett eredmény (bevétel − kiadás)</p>
            <p
              className={`mt-1 text-2xl font-semibold ${
                statement.estimatedResult >= 0 ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {formatCurrency(statement.estimatedResult)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {statement.includedInvoiceCount} jóváhagyott bizonylat alapján — ez egy becslés, nem hivatalos
              adózás előtti eredmény.
            </p>
          </div>

          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-700">Mérleg-vázlat</h3>
            <p className="mt-1 text-sm text-slate-500">
              Ehhez a rendszer jelenleg nem tárol elég strukturált adatot (pl. eszköz-/kötelezettség-kategóriák,
              bankegyenleg, kintlévőségek nyilvántartása), ezért ez a szakasz egyelőre kimarad. Egy következő
              verzióban készülhet el, ha ezek az adatok is rögzíthetők lesznek.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function StatementTable({
  title,
  lines,
  total,
  tone,
}: {
  title: string;
  lines: { categoryName: string; net: number }[];
  total: number;
  tone: "emerald" | "red";
}) {
  const toneClass = tone === "emerald" ? "text-emerald-700" : "text-red-700";
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">{title}</div>
      {lines.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">Nincs jóváhagyott tétel ebben az időszakban.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <tbody className="divide-y divide-slate-100">
            {lines.map((l) => (
              <tr key={l.categoryName}>
                <td className="px-4 py-2.5 text-slate-600">{l.categoryName}</td>
                <td className="px-4 py-2.5 text-right text-slate-900">{formatCurrency(l.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
        <span className="text-sm font-semibold text-slate-700">{title} összesen</span>
        <span className={`text-sm font-bold ${toneClass}`}>{formatCurrency(total)}</span>
      </div>
    </div>
  );
}
