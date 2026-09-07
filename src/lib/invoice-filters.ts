import type { Prisma } from "@prisma/client";

export type InvoiceFilterParams = {
  from?: string;
  to?: string;
  direction?: string;
  categoryId?: string;
  partner?: string;
};

export function parseFilterParams(
  searchParams: Record<string, string | string[] | undefined>
): InvoiceFilterParams {
  const get = (key: string) => {
    const v = searchParams[key];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };
  return {
    from: get("from"),
    to: get("to"),
    direction: get("direction"),
    categoryId: get("categoryId"),
    partner: get("partner"),
  };
}

export function buildInvoiceWhere(
  companyId: string,
  params: InvoiceFilterParams
): Prisma.InvoiceWhereInput {
  const where: Prisma.InvoiceWhereInput = { companyId };

  if (params.direction === "INCOME" || params.direction === "EXPENSE") {
    where.direction = params.direction;
  }
  if (params.categoryId) {
    where.categoryId = params.categoryId;
  }
  if (params.partner) {
    where.partnerNameRaw = { contains: params.partner, mode: "insensitive" };
  }
  if (params.from || params.to) {
    where.issueDate = {};
    if (params.from) where.issueDate.gte = new Date(params.from);
    if (params.to) {
      const to = new Date(params.to);
      to.setHours(23, 59, 59, 999);
      where.issueDate.lte = to;
    }
  }

  return where;
}
