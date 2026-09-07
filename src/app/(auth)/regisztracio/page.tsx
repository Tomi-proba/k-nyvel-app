"use client";

import Link from "next/link";
import { useActionState } from "react";
import { registerAction, type FormState } from "../actions";
import { SubmitButton } from "@/components/submit-button";

export default function RegisterPage() {
  const [state, formAction] = useActionState<FormState, FormData>(registerAction, undefined);

  return (
    <div>
      <h1 className="mb-6 text-lg font-semibold text-slate-900">Regisztráció</h1>
      <form action={formAction} className="space-y-4">
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium text-slate-700">
            Neved
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            autoComplete="name"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
            Email cím
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
            Jelszó
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-slate-400">Legalább 8 karakter.</p>
        </div>

        <hr className="border-slate-200" />
        <p className="text-sm font-medium text-slate-700">Céged adatai</p>

        <div>
          <label htmlFor="companyName" className="mb-1 block text-sm font-medium text-slate-700">
            Cégnév
          </label>
          <input
            id="companyName"
            name="companyName"
            type="text"
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="companyTaxNumber" className="mb-1 block text-sm font-medium text-slate-700">
            Adószám <span className="font-normal text-slate-400">(opcionális)</span>
          </label>
          <input
            id="companyTaxNumber"
            name="companyTaxNumber"
            type="text"
            placeholder="12345678-1-42"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>

        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <SubmitButton>Regisztráció</SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Már van fiókod?{" "}
        <Link href="/bejelentkezes" className="font-medium text-slate-900 underline">
          Bejelentkezés
        </Link>
      </p>
    </div>
  );
}
