"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, type FormState } from "../actions";
import { SubmitButton } from "@/components/submit-button";

export default function LoginPage() {
  const [state, formAction] = useActionState<FormState, FormData>(loginAction, undefined);

  return (
    <div>
      <h1 className="mb-6 text-lg font-semibold text-slate-900">Bejelentkezés</h1>
      <form action={formAction} className="space-y-4">
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
            autoComplete="current-password"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <SubmitButton>Bejelentkezés</SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Még nincs fiókod?{" "}
        <Link href="/regisztracio" className="font-medium text-slate-900 underline">
          Regisztrálj
        </Link>
      </p>
    </div>
  );
}
