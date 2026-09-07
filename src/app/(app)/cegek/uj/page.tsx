"use client";

import { useActionState } from "react";
import { createCompanyAction, type NewCompanyState } from "../../actions";
import { SubmitButton } from "@/components/submit-button";

export default function NewCompanyPage() {
  const [state, formAction] = useActionState<NewCompanyState, FormData>(createCompanyAction, undefined);

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">Új cég hozzáadása</h1>
      <form action={formAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium text-slate-700">
            Cégnév
          </label>
          <input
            id="name"
            name="name"
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="taxNumber" className="mb-1 block text-sm font-medium text-slate-700">
            Adószám <span className="font-normal text-slate-400">(opcionális)</span>
          </label>
          <input
            id="taxNumber"
            name="taxNumber"
            placeholder="12345678-1-42"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="address" className="mb-1 block text-sm font-medium text-slate-700">
            Cím <span className="font-normal text-slate-400">(opcionális)</span>
          </label>
          <input
            id="address"
            name="address"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <SubmitButton>Cég létrehozása</SubmitButton>
      </form>
    </div>
  );
}
