import { useCallback, useRef, useState } from "react";
import type { z } from "zod";
import { fieldErrorsFromZod } from "@konyvelo/shared";
import { ApiError } from "./api";

/**
 * Űrlapkezelés Zod sémával: a mező elhagyásakor azonnal megjelenik az
 * esetleges hiba (ugyanaz a szöveg, amit a szerver is adna), beküldéskor
 * pedig minden mező ellenőrzésre kerül. A szerver mezőhibái is a mezők alá
 * kerülnek.
 */
export function useZodForm<V extends Record<string, unknown>, S extends z.ZodType>(
  schema: S,
  initial: V,
  toPayload: (values: V) => unknown = (v) => v,
) {
  const [values, setValues] = useState<V>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const validateField = useCallback(
    (field: string, vals: V) => {
      const r = schema.safeParse(toPayload(vals));
      const fe = r.success ? {} : fieldErrorsFromZod(r.error);
      setErrors((prev) => {
        const next = { ...prev };
        if (fe[field]) next[field] = fe[field];
        else delete next[field];
        return next;
      });
    },
    [schema, toPayload],
  );

  const set = useCallback(
    <K extends keyof V>(field: K, value: V[K]) => {
      const next = { ...valuesRef.current, [field]: value };
      valuesRef.current = next;
      setValues(next);
      // Ha már hibás volt, gépelés közben is frissüljön (eltűnjön a javításkor).
      setErrors((prev) => {
        if (prev[field as string]) queueMicrotask(() => validateField(field as string, next));
        return prev;
      });
    },
    [validateField],
  );

  const blur = useCallback((field: keyof V) => validateField(field as string, valuesRef.current), [validateField]);

  const reset = useCallback((next: V) => {
    valuesRef.current = next;
    setValues(next);
    setErrors({});
    setFormError(null);
  }, []);

  /** Beküldés: ellenőrzés, majd a művelet futtatása; szerverhiba esetén a hibák megjelenítése. */
  const submit = useCallback(
    async (action: (payload: z.output<S>) => Promise<unknown>): Promise<boolean> => {
      setFormError(null);
      const r = schema.safeParse(toPayload(valuesRef.current));
      if (!r.success) {
        setErrors(fieldErrorsFromZod(r.error));
        setFormError("Kérjük, javítsa a megjelölt mezőket.");
        return false;
      }
      setErrors({});
      setSubmitting(true);
      try {
        await action(r.data);
        return true;
      } catch (err) {
        if (err instanceof ApiError) {
          setErrors(err.fields);
          setFormError(err.message);
        } else {
          setFormError("Váratlan hiba történt. Kérjük, próbálja újra.");
        }
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [schema, toPayload],
  );

  return { values, errors, formError, submitting, set, blur, reset, submit, setFormError };
}

/** Ctrl+Enter beküldés (PLAN 5.2) – az űrlap onKeyDown eseményére kell kötni. */
export function submitOnCtrlEnter(e: React.KeyboardEvent<HTMLFormElement>) {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    e.currentTarget.requestSubmit();
  }
}
