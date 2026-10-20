import { useCallback, useMemo } from "react";
import { searchAccounts } from "@konyvelo/domain";
import type { AccountDto } from "@konyvelo/shared";
import { Combobox, type ComboboxControlProps } from "./Combobox";

export const accountLabel = (a: Pick<AccountDto, "number" | "name">) => `${a.number} – ${a.name}`;

/**
 * Főkönyvi számla kiválasztása billentyűzetről: számra („38”) vagy névre
 * („bank”) is keres. Csak könyvelhető (nem gyűjtő), aktív számla
 * választható.
 */
export function AccountPicker({
  accounts,
  value,
  onChange,
  filter,
  controlProps,
  placeholder = "Számlaszám vagy név…",
}: {
  accounts: readonly AccountDto[];
  value: string | null;
  onChange: (id: string | null) => void;
  filter?: (a: AccountDto) => boolean;
  controlProps: ComboboxControlProps;
  placeholder?: string;
}) {
  const selectable = useMemo(
    () => accounts.filter((a) => a.id === value || (a.isActive && !a.hasChildren && (filter ? filter(a) : true))),
    [accounts, filter, value],
  );
  const search = useCallback(
    (items: readonly AccountDto[], query: string) => searchAccounts(items.filter((a) => a.isActive && !a.hasChildren), query, 50),
    [],
  );
  return (
    <Combobox
      items={selectable}
      search={search}
      getKey={(a) => a.id}
      getLabel={accountLabel}
      renderOption={(a) => (
        <>
          <span className="mono">{a.number}</span> {a.name}
        </>
      )}
      value={value}
      onChange={(id) => onChange(id)}
      controlProps={controlProps}
      placeholder={placeholder}
      listLabel="Számlák"
      emptyText="Nincs találat. Gyűjtőszámlára nem lehet könyvelni – válasszon alszámlát."
    />
  );
}
