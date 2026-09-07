import { NextResponse } from "next/server";
import { getActiveMembership } from "@/lib/current-company";
import { db } from "@/lib/db";
import { parseFilterParams, buildInvoiceWhere } from "@/lib/invoice-filters";
import { buildInvoicesCsv, buildInvoicesXlsx } from "@/lib/export";

export async function GET(request: Request) {
  const active = await getActiveMembership();
  if (!active) {
    return NextResponse.json({ error: "Nincs bejelentkezve." }, { status: 401 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const filterParams = parseFilterParams(Object.fromEntries(url.searchParams));
  const where = buildInvoiceWhere(active.membership.companyId, filterParams);

  const invoices = await db.invoice.findMany({
    where,
    orderBy: [{ issueDate: "asc" }, { createdAt: "asc" }],
    include: { category: { select: { name: true } } },
  });

  const rows = invoices.map((inv) => ({
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    direction: inv.direction,
    partnerNameRaw: inv.partnerNameRaw,
    partnerTaxNumber: inv.partnerTaxNumber,
    categoryName: inv.category?.name ?? null,
    netAmount: inv.netAmount,
    vatAmount: inv.vatAmount,
    vatRate: inv.vatRate,
    grossAmount: inv.grossAmount,
    currency: inv.currency,
    status: inv.status,
    fileName: inv.fileName,
  }));

  const timestamp = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    const csv = buildInvoicesCsv(rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="szamlak-${timestamp}.csv"`,
      },
    });
  }

  const xlsxBuffer = buildInvoicesXlsx(rows);
  return new NextResponse(new Uint8Array(xlsxBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="szamlak-${timestamp}.xlsx"`,
    },
  });
}
