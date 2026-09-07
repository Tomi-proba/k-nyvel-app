"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActiveMembership } from "@/lib/current-company";
import { db } from "@/lib/db";
import { getStorageDriver } from "@/lib/storage";
import { invoiceUpdateSchema } from "@/lib/validation";

export type UpdateInvoiceState = { error?: string } | undefined;

export async function updateInvoiceAction(
  invoiceId: string,
  _prevState: UpdateInvoiceState,
  formData: FormData
): Promise<UpdateInvoiceState> {
  const { membership, userId } = await requireActiveMembership();

  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, companyId: membership.companyId },
  });
  if (!invoice) {
    return { error: "A bizonylat nem található." };
  }

  const parsed = invoiceUpdateSchema.safeParse({
    direction: formData.get("direction"),
    partnerNameRaw: formData.get("partnerNameRaw"),
    partnerTaxNumber: formData.get("partnerTaxNumber"),
    issueDate: formData.get("issueDate"),
    dueDate: formData.get("dueDate"),
    netAmount: formData.get("netAmount"),
    vatAmount: formData.get("vatAmount"),
    grossAmount: formData.get("grossAmount"),
    vatRate: formData.get("vatRate"),
    categoryId: formData.get("categoryId"),
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Érvénytelen adatok." };
  }

  const d = parsed.data;
  const toDecimal = (v: string | undefined) => (v ? v.replace(",", ".") : null);

  await db.invoice.update({
    where: { id: invoice.id },
    data: {
      direction: d.direction,
      partnerNameRaw: d.partnerNameRaw ?? null,
      partnerTaxNumber: d.partnerTaxNumber ?? null,
      issueDate: d.issueDate ? new Date(d.issueDate) : null,
      dueDate: d.dueDate ? new Date(d.dueDate) : null,
      netAmount: toDecimal(d.netAmount),
      vatAmount: toDecimal(d.vatAmount),
      grossAmount: toDecimal(d.grossAmount),
      vatRate: toDecimal(d.vatRate),
      categoryId: d.categoryId ?? null,
      notes: d.notes ?? null,
      status: "CONFIRMED",
      reviewedById: userId,
      reviewedAt: new Date(),
      uncertainFields: [],
    },
  });

  revalidatePath("/szamlak");
  revalidatePath(`/szamlak/${invoice.id}`);
  revalidatePath("/dashboard");
  redirect("/szamlak");
}

export async function deleteInvoiceAction(formData: FormData) {
  const { membership } = await requireActiveMembership();
  const invoiceId = formData.get("invoiceId");
  if (typeof invoiceId !== "string") return;

  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, companyId: membership.companyId },
  });
  if (!invoice) return;

  await getStorageDriver().delete(invoice.fileUrl);
  await db.invoice.delete({ where: { id: invoice.id } });

  revalidatePath("/szamlak");
  revalidatePath("/dashboard");
}
