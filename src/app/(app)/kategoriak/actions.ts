"use server";

import { revalidatePath } from "next/cache";
import { requireActiveMembership } from "@/lib/current-company";
import { db } from "@/lib/db";

export async function setPartnerCategoryAction(formData: FormData) {
  const { membership } = await requireActiveMembership();
  const partnerId = formData.get("partnerId");
  const categoryId = formData.get("categoryId");
  if (typeof partnerId !== "string") return;

  const partner = await db.partner.findFirst({
    where: { id: partnerId, companyId: membership.companyId },
  });
  if (!partner) return;

  await db.partner.update({
    where: { id: partnerId },
    data: { defaultCategoryId: typeof categoryId === "string" && categoryId ? categoryId : null },
  });

  revalidatePath("/kategoriak");
}
