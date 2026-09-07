"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { auth, signOut } from "@/lib/auth";
import { ACTIVE_COMPANY_COOKIE } from "@/lib/current-company";
import { newCompanySchema } from "@/lib/validation";

export async function switchCompanyAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/bejelentkezes");

  const companyId = formData.get("companyId");
  if (typeof companyId !== "string") return;

  const membership = await db.membership.findUnique({
    where: { userId_companyId: { userId: session.user.id, companyId } },
  });
  if (!membership) return;

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_COMPANY_COOKIE, companyId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  redirect("/szamlak");
}

export type NewCompanyState = { error?: string } | undefined;

export async function createCompanyAction(
  _prevState: NewCompanyState,
  formData: FormData
): Promise<NewCompanyState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/bejelentkezes");

  const parsed = newCompanySchema.safeParse({
    name: formData.get("name"),
    taxNumber: formData.get("taxNumber"),
    address: formData.get("address"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Érvénytelen adatok." };
  }

  const company = await db.company.create({
    data: {
      name: parsed.data.name,
      taxNumber: parsed.data.taxNumber,
      address: parsed.data.address,
      memberships: {
        create: { userId: session.user.id, role: "OWNER" },
      },
      categories: {
        createMany: {
          data: [
            { name: "Iroda", type: "EXPENSE", keywords: ["iroda", "papír", "toner", "irodaszer"], isDefault: true },
            { name: "Utazás", type: "EXPENSE", keywords: ["utazás", "szállás", "repül", "vonat", "taxi", "benzin", "üzemanyag"], isDefault: true },
            { name: "Szoftver", type: "EXPENSE", keywords: ["szoftver", "software", "saas", "előfizetés", "licenc", "subscription"], isDefault: true },
            { name: "Marketing", type: "EXPENSE", keywords: ["marketing", "hirdetés", "reklám", "ads"], isDefault: true },
            { name: "Rezsi", type: "EXPENSE", keywords: ["áram", "gáz", "víz", "internet", "telefon", "rezsi"], isDefault: true },
            { name: "Bérleti díj", type: "EXPENSE", keywords: ["bérleti", "bérlet", "rent"], isDefault: true },
            { name: "Könyvelés", type: "EXPENSE", keywords: ["könyvelés", "könyvelő", "accounting"], isDefault: true },
            { name: "Értékesítés", type: "INCOME", keywords: [], isDefault: true },
            { name: "Egyéb", type: "BOTH", keywords: [], isDefault: true },
          ],
        },
      },
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_COMPANY_COOKIE, company.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  redirect("/szamlak");
}

export async function signOutAction() {
  await signOut({ redirectTo: "/bejelentkezes" });
}
