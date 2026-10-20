import { useEffect, useRef, useState } from "react";
import { formatHuf, parseHufInput } from "@konyvelo/domain";
import type { ComboboxControlProps } from "./Combobox";

/** Összeg szövegből: üres → null, hibás → undefined, egyébként fillér. */
export function amountFromText(text: string): number | null | undefined {
  if (text.trim() === "") return null;
  const r = parseHufInput(text);
  return r.ok ? r.value : undefined;
}

export const amountText = (filler: number | null | undefined) => (filler == null ? "" : formatHuf(filler, { withUnit: false }));

/**
 * Forintösszeg mezője. „12500” vagy „12 500” is jó; kilépéskor „12 500”
 * formára áll. Az „=” billentyű a bizonylat hiányzó különbözetét írja be.
 */
export function AmountInput({
  value,
  onChange,
  onFillDifference,
  controlProps,
}: {
  value: string;
  onChange: (text: string) => void;
  onFillDifference?: () => void;
  controlProps: ComboboxControlProps;
}) {
  const [text, setText] = useState(value);
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value);
    }
  }, [value]);
  const emit = (t: string) => {
    last.current = t;
    setText(t);
    onChange(t);
  };
  return (
    <input
      {...controlProps}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className="amount-input"
      value={text}
      onChange={(e) => emit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "=" && onFillDifference) {
          e.preventDefault();
          onFillDifference();
        }
      }}
      onBlur={() => {
        const v = amountFromText(text);
        if (typeof v === "number") emit(v === 0 ? "" : amountText(v));
      }}
    />
  );
}
