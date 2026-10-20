import { useEffect, useRef, useState } from "react";
import { formatDateHu, parseDateHu } from "@konyvelo/domain";
import type { FieldControlProps } from "./Field";

/**
 * Dátummező magyar formátummal (ÉÉÉÉ.HH.NN.). Gyors bevitel: "20261020",
 * "2026.10.20" vagy év nélkül "10.20" (a megadott évvel). Kilépéskor a
 * beírt érték egységes formára áll. Az érték ISO dátum ("2026-10-20"),
 * érvénytelen vagy félig beírt dátumnál üres szöveg.
 */
export function DateInput({
  value,
  onChange,
  defaultYear,
  controlProps,
}: {
  value: string;
  onChange: (iso: string) => void;
  defaultYear?: number;
  controlProps: FieldControlProps;
}) {
  const [text, setText] = useState(formatDateHu(value));
  const lastEmitted = useRef(value);

  useEffect(() => {
    // Csak kívülről jövő változásra (pl. előkitöltés) írjuk át a mezőt,
    // a saját gépelésünkre nem.
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setText(formatDateHu(value));
    }
  }, [value]);

  return (
    <input
      {...controlProps}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="ÉÉÉÉ.HH.NN."
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const iso = parseDateHu(e.target.value, defaultYear) ?? "";
        lastEmitted.current = iso;
        onChange(iso);
      }}
      onBlur={() => {
        const iso = parseDateHu(text, defaultYear);
        if (iso) setText(formatDateHu(iso));
      }}
    />
  );
}
