import { NextResponse } from "next/server";
import { getActiveMembership } from "@/lib/current-company";
import { db } from "@/lib/db";
import { buildDraftIncomeStatement, type PeriodGranularity } from "@/lib/draft-statement";
import { buildDraftStatementPdf, buildDraftStatementXlsx } from "@/lib/draft-statement-export";

function isGranularity(v: string | null): v is PeriodGranularity {
  return v === "month" || v === "quarter" || v === "year";
}

export async function GET(request: Request) {
  const active = await getActiveMembership();
  if (!active) {
    return NextResponse.json({ error: "Nincs bejelentkezve." }, { status: 401 });
  }

  const url = new URL(request.url);
  const granularityParam = url.searchParams.get("granularity");
  const granularity: PeriodGranularity = isGranularity(granularityParam) ? granularityParam : "month";
  const periodKey = url.searchParams.get("period");
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "pdf";

  if (!periodKey) {
    return NextResponse.json({ error: "Hiányzó időszak paraméter." }, { status: 400 });
  }

  const invoices = await db.invoice.findMany({
    where: { companyId: active.membership.companyId, issueDate: { not: null } },
    select: { status: true, direction: true, issueDate: true, netAmount: true, category: { select: { name: true } } },
  });

  const statement = buildDraftIncomeStatement(
    invoices.map((inv) => ({
      status: inv.status,
      direction: inv.direction,
      issueDate: inv.issueDate,
      netAmount: inv.netAmount ? Number(inv.netAmount) : null,
      categoryName: inv.category?.name ?? null,
    })),
    granularity,
    periodKey
  );

  const companyName = active.membership.company.name;
  const fileBase = `tervezet-kimutatas-${statement.periodKey}`;

  if (format === "xlsx") {
    const buffer = buildDraftStatementXlsx({ companyName, statement });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileBase}.xlsx"`,
      },
    });
  }

  const buffer = await buildDraftStatementPdf({ companyName, statement });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileBase}.pdf"`,
    },
  });
}
