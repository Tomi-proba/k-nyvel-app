"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { signIn } from "@/lib/auth";
import { registerSchema, loginSchema } from "@/lib/validation";

export type FormState = { error?: string } | undefined;

export async function registerAction(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    companyName: formData.get("companyName"),
    companyTaxNumber: formData.get("companyTaxNumber"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Érvénytelen adatok." };
  }

  const { name, email, password, companyName, companyTaxNumber } = parsed.data;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "Ezzel az email címmel már regisztráltak." };
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name, email, passwordHash },
    });

    const company = await tx.company.create({
      data: { name: companyName, taxNumber: companyTaxNumber },
    });

    await tx.membership.create({
      data: { userId: user.id, companyId: company.id, role: "OWNER" },
    });

    await tx.category.createMany({
      data: defaultCategories(company.id),
    });
  });

  const signInUrl = await signIn("credentials", {
    email,
    password,
    redirect: false,
  });

  if (typeof signInUrl === "string" && signInUrl.includes("error=")) {
    return { error: "A regisztráció sikerült, de a bejelentkezés nem. Jelentkezz be manuálisan." };
  }

  redirect("/dashboard");
}

export async function loginAction(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Érvénytelen adatok." };
  }

  const signInUrl = await signIn("credentials", {
    email: parsed.data.email,
    password: parsed.data.password,
    redirect: false,
  });

  if (typeof signInUrl === "string" && signInUrl.includes("error=")) {
    return { error: "Hibás email cím vagy jelszó." };
  }

  redirect("/dashboard");
}

function defaultCategories(companyId: string) {
  return [
    { companyId, name: "Iroda", type: "EXPENSE" as const, keywords: ["iroda", "papír", "toner", "irodaszer"], isDefault: true },
    { companyId, name: "Utazás", type: "EXPENSE" as const, keywords: ["utazás", "szállás", "repül", "vonat", "taxi", "benzin", "üzemanyag"], isDefault: true },
    { companyId, name: "Szoftver", type: "EXPENSE" as const, keywords: ["szoftver", "software", "saas", "előfizetés", "licenc", "subscription"], isDefault: true },
    { companyId, name: "Marketing", type: "EXPENSE" as const, keywords: ["marketing", "hirdetés", "reklám", "ads"], isDefault: true },
    { companyId, name: "Rezsi", type: "EXPENSE" as const, keywords: ["áram", "gáz", "víz", "internet", "telefon", "rezsi"], isDefault: true },
    { companyId, name: "Bérleti díj", type: "EXPENSE" as const, keywords: ["bérleti", "bérlet", "rent"], isDefault: true },
    { companyId, name: "Könyvelés", type: "EXPENSE" as const, keywords: ["könyvelés", "könyvelő", "accounting"], isDefault: true },
    { companyId, name: "Értékesítés", type: "INCOME" as const, keywords: [], isDefault: true },
    { companyId, name: "Egyéb", type: "BOTH" as const, keywords: [], isDefault: true },
  ];
}
