import Link from "next/link";
import { redirect } from "next/navigation";
import { getActiveMembership } from "@/lib/current-company";
import { CompanySwitcher } from "@/components/company-switcher";
import { signOutAction } from "./actions";

const navItems = [
  { href: "/dashboard", label: "Áttekintő" },
  { href: "/szamlak", label: "Számlák" },
  { href: "/kategoriak", label: "Kategóriák" },
  { href: "/cegek", label: "Cégek" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const active = await getActiveMembership();
  if (!active) {
    redirect("/bejelentkezes");
  }

  const { membership, allMemberships } = active;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-lg font-bold text-slate-900">
              Könyvel
            </Link>
            <nav className="hidden gap-1 sm:flex">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <CompanySwitcher
              companies={allMemberships.map((m) => ({ id: m.companyId, name: m.company.name }))}
              activeCompanyId={membership.companyId}
            />
            <form action={signOutAction}>
              <button
                type="submit"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Kijelentkezés
              </button>
            </form>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-4 py-1 sm:hidden">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
