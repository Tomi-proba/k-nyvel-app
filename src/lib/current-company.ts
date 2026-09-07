import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const ACTIVE_COMPANY_COOKIE = "activeCompanyId";

/**
 * A bejelentkezett user aktuálisan kiválasztott cége.
 * Ha a cookie-ban tárolt cég nem érvényes (törölve lett, vagy a user
 * nem tagja), a legkorábban létrehozott tagságra esik vissza.
 */
export async function getActiveMembership() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const cookieStore = await cookies();
  const wantedCompanyId = cookieStore.get(ACTIVE_COMPANY_COOKIE)?.value;

  const memberships = await db.membership.findMany({
    where: { userId: session.user.id },
    include: { company: true },
    orderBy: { createdAt: "asc" },
  });

  if (memberships.length === 0) return null;

  const match = wantedCompanyId
    ? memberships.find((m) => m.companyId === wantedCompanyId)
    : undefined;

  return { membership: match ?? memberships[0], allMemberships: memberships, userId: session.user.id };
}

export async function requireActiveMembership() {
  const result = await getActiveMembership();
  if (!result) {
    throw new Error("Nincs bejelentkezve, vagy nincs egyetlen céghez sem hozzárendelve.");
  }
  return result;
}
