"use client";

import { useRef } from "react";
import { switchCompanyAction } from "@/app/(app)/actions";

type Option = { id: string; name: string };

export function CompanySwitcher({
  companies,
  activeCompanyId,
}: {
  companies: Option[];
  activeCompanyId: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  if (companies.length <= 1) {
    return <span className="text-sm font-medium text-slate-900">{companies[0]?.name}</span>;
  }

  return (
    <form ref={formRef} action={switchCompanyAction}>
      <select
        name="companyId"
        defaultValue={activeCompanyId}
        onChange={() => formRef.current?.requestSubmit()}
        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-900 focus:outline-none"
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </form>
  );
}
