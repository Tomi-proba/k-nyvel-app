"use client";

import { useRef } from "react";

export function AutoSubmitSelect({
  action,
  name,
  defaultValue,
  options,
  emptyLabel,
  hidden,
}: {
  action: (formData: FormData) => void | Promise<void>;
  name: string;
  defaultValue: string;
  options: { value: string; label: string }[];
  emptyLabel: string;
  hidden?: Record<string, string>;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={action}>
      {hidden &&
        Object.entries(hidden).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
      <select
        name={name}
        defaultValue={defaultValue}
        onChange={() => formRef.current?.requestSubmit()}
        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none"
      >
        <option value="">{emptyLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </form>
  );
}
