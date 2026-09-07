"use client";

import { useActionState } from "react";
import clsx from "clsx";
import { updateInvoiceAction, type UpdateInvoiceState } from "@/app/(app)/szamlak/actions";
import { SubmitButton } from "@/components/submit-button";

type Category = { id: string; name: string };

type InvoiceFormData = {
  id: string;
  direction: string;
  partnerNameRaw: string | null;
  partnerTaxNumber: string | null;
  issueDate: Date | null;
  dueDate: Date | null;
  netAmount: unknown;
  vatAmount: unknown;
  grossAmount: unknown;
  vatRate: unknown;
  categoryId: string | null;
  notes: string | null;
  uncertainFields: string[];
};

function toDateInputValue(d: Date | null): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

function field(label: string, name: string, invoice: InvoiceFormData, extra?: React.ReactNode, children?: React.ReactNode) {
  const isUncertain = invoice.uncertainFields.includes(name);
  return (
    <div>
      <label htmlFor={name} className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700">
        {label}
        {isUncertain && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            ellenőrzésre vár
          </span>
        )}
      </label>
      {children}
      {extra}
    </div>
  );
}

export function InvoiceReviewForm({
  invoice,
  categories,
}: {
  invoice: InvoiceFormData;
  categories: Category[];
}) {
  const boundAction = updateInvoiceAction.bind(null, invoice.id);
  const [state, formAction] = useActionState<UpdateInvoiceState, FormData>(boundAction, undefined);

  const inputClass = (name: string) =>
    clsx(
      "w-full rounded-lg border px-3 py-2 text-sm focus:outline-none",
      invoice.uncertainFields.includes(name)
        ? "border-amber-400 bg-amber-50 focus:border-amber-500"
        : "border-slate-300 focus:border-slate-500"
    );

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="direction" className="mb-1 block text-sm font-medium text-slate-700">
          Irány
        </label>
        <select
          id="direction"
          name="direction"
          defaultValue={invoice.direction}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        >
          <option value="EXPENSE">Kiadás</option>
          <option value="INCOME">Bevétel</option>
        </select>
      </div>

      {field(
        "Kiállító / partner neve",
        "partnerNameRaw",
        invoice,
        undefined,
        <input
          id="partnerNameRaw"
          name="partnerNameRaw"
          defaultValue={invoice.partnerNameRaw ?? ""}
          className={inputClass("partnerNameRaw")}
        />
      )}

      {field(
        "Partner adószáma",
        "partnerTaxNumber",
        invoice,
        undefined,
        <input
          id="partnerTaxNumber"
          name="partnerTaxNumber"
          placeholder="12345678-1-42"
          defaultValue={invoice.partnerTaxNumber ?? ""}
          className={inputClass("partnerTaxNumber")}
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        {field(
          "Számla kelte",
          "issueDate",
          invoice,
          undefined,
          <input
            id="issueDate"
            name="issueDate"
            type="date"
            defaultValue={toDateInputValue(invoice.issueDate)}
            className={inputClass("issueDate")}
          />
        )}
        {field(
          "Fizetési határidő",
          "dueDate",
          invoice,
          undefined,
          <input
            id="dueDate"
            name="dueDate"
            type="date"
            defaultValue={toDateInputValue(invoice.dueDate)}
            className={inputClass("dueDate")}
          />
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {field(
          "Nettó",
          "netAmount",
          invoice,
          undefined,
          <input
            id="netAmount"
            name="netAmount"
            inputMode="decimal"
            defaultValue={invoice.netAmount ? String(invoice.netAmount) : ""}
            className={inputClass("netAmount")}
          />
        )}
        {field(
          "ÁFA",
          "vatAmount",
          invoice,
          undefined,
          <input
            id="vatAmount"
            name="vatAmount"
            inputMode="decimal"
            defaultValue={invoice.vatAmount ? String(invoice.vatAmount) : ""}
            className={inputClass("vatAmount")}
          />
        )}
        {field(
          "Bruttó",
          "grossAmount",
          invoice,
          undefined,
          <input
            id="grossAmount"
            name="grossAmount"
            inputMode="decimal"
            defaultValue={invoice.grossAmount ? String(invoice.grossAmount) : ""}
            className={inputClass("grossAmount")}
          />
        )}
      </div>

      {field(
        "ÁFA kulcs (%)",
        "vatRate",
        invoice,
        undefined,
        <input
          id="vatRate"
          name="vatRate"
          inputMode="decimal"
          placeholder="27"
          defaultValue={invoice.vatRate ? String(invoice.vatRate) : ""}
          className={clsx(inputClass("vatRate"), "max-w-[140px]")}
        />
      )}

      <div>
        <label htmlFor="categoryId" className="mb-1 block text-sm font-medium text-slate-700">
          Kategória
        </label>
        <select
          id="categoryId"
          name="categoryId"
          defaultValue={invoice.categoryId ?? ""}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        >
          <option value="">Nincs kiválasztva</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="notes" className="mb-1 block text-sm font-medium text-slate-700">
          Megjegyzés
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={invoice.notes ?? ""}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <SubmitButton>Jóváhagyás és mentés</SubmitButton>
    </form>
  );
}
