import { useCallback, useMemo } from "react";
import { normalizeForSearch } from "@konyvelo/domain";
import type { PartnerDto } from "@konyvelo/shared";
import { Combobox, type ComboboxControlProps } from "./Combobox";

export const partnerLabel = (p: Pick<PartnerDto, "name" | "taxNumber">) => (p.taxNumber ? `${p.name} (${p.taxNumber})` : p.name);

/** Partner kiválasztása névre vagy adószámra keresve; csak aktív partner választható. */
export function PartnerPicker({
  partners,
  value,
  onChange,
  kind,
  controlProps,
}: {
  partners: readonly PartnerDto[];
  value: string | null;
  onChange: (partner: PartnerDto | null) => void;
  kind?: "CUSTOMER" | "SUPPLIER" | "ANY";
  controlProps: ComboboxControlProps;
}) {
  const items = useMemo(
    () => partners.filter((p) => p.id === value || (p.status === "ACTIVE" && (!kind || kind === "ANY" || p.kind === kind || p.kind === "BOTH"))),
    [partners, kind, value],
  );
  const search = useCallback((list: readonly PartnerDto[], query: string) => {
    const active = list.filter((p) => p.status === "ACTIVE");
    const q = normalizeForSearch(query.trim());
    if (!q) return active.slice(0, 50);
    const digits = query.replace(/\D/g, "");
    return active
      .filter((p) => normalizeForSearch(p.name).includes(q) || (digits.length >= 3 && (p.taxNumber ?? "").replace(/\D/g, "").startsWith(digits)))
      .slice(0, 50);
  }, []);
  return (
    <Combobox
      items={items}
      search={search}
      getKey={(p) => p.id}
      getLabel={partnerLabel}
      renderOption={(p) => (
        <>
          {p.name}
          {p.taxNumber && <span className="muted mono"> {p.taxNumber}</span>}
        </>
      )}
      value={value}
      onChange={(_, p) => onChange(p)}
      controlProps={controlProps}
      placeholder="Név vagy adószám…"
      listLabel="Partnerek"
      emptyText="Nincs találat. Új partnert a Partnerek menüben vehet fel."
    />
  );
}
