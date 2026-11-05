import type { ReactNode } from "react";
import { HibaOsszegzes, Mezo } from "@aweboldal/felulet";
import type { GlossaryKey } from "../help/glossary";
import { HelpTip } from "./Tooltip";

export type FieldControlProps = {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
  "aria-required": boolean | undefined;
};

/**
 * Űrlapmező címkével, súgóval, tipp-szöveggel és hibaüzenettel. A hiba a
 * mező alatt jelenik meg, és a mezőhöz van kötve (aria-describedby), így a
 * képernyőolvasó is felolvassa.
 */
export function Field({
  label,
  error,
  hint,
  help,
  required,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  help?: GlossaryKey;
  required?: boolean;
  children: (props: FieldControlProps) => ReactNode;
}) {
  // A közös komponenskészlet mezője (TERV.md F23 KB4); a súgógomb a címke mellé, nem a mező nevébe.
  return (
    <Mezo cimke={label} hiba={error} sugo={hint} kotelezo={required} kiegeszites={help ? <HelpTip term={help} /> : undefined}>
      {(a) => children(a)}
    </Mezo>
  );
}

/**
 * Űrlap tetején megjelenő hibaösszesítő (fókuszt kap, a képernyőolvasó felolvassa): a közös komponenskészleté.
 */
export function ErrorSummary({ message, fields, attempt }: { message?: string | null; fields?: Record<string, string>; attempt?: number }) {
  return <HibaOsszegzes uzenet={message} mezok={fields} kiserlet={attempt} />;
}
