import { useId, useMemo, useRef, useState } from "react";
import { searchAccounts } from "@konyvelo/domain";
import type { AccountDto } from "@konyvelo/shared";
import type { FieldControlProps } from "./Field";

export const accountLabel = (a: Pick<AccountDto, "number" | "name">) => `${a.number} – ${a.name}`;

/**
 * Főkönyvi számla kiválasztása billentyűzetről: számra („38”) vagy névre
 * („bank”) is keres. Nyilakkal lehet lépkedni, Enterrel vagy Tabbal
 * választani, Esc-kel bezárni. Csak könyvelhető (nem gyűjtő), aktív
 * számla választható. (WAI-ARIA combobox minta.)
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
  controlProps: FieldControlProps;
  placeholder?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const selectable = useMemo(
    () => accounts.filter((a) => a.isActive && !a.hasChildren && (filter ? filter(a) : true)),
    [accounts, filter],
  );
  const options = useMemo(() => searchAccounts(selectable, query, 50), [selectable, query]);
  const selected = accounts.find((a) => a.id === value) ?? null;

  const choose = (a: AccountDto) => {
    onChange(a.id);
    setOpen(false);
    setQuery("");
  };

  const move = (delta: number) => {
    setOpen(true);
    setActive((i) => {
      const next = Math.max(0, Math.min(options.length - 1, i + delta));
      listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
      return next;
    });
  };

  const activeOption = open ? options[active] : undefined;

  return (
    <div className="combobox">
      <input
        {...controlProps}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeOption ? `${listId}-${activeOption.id}` : undefined}
        placeholder={placeholder}
        value={open ? query : selected ? accountLabel(selected) : ""}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
          if (e.target.value === "") onChange(null);
        }}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          setOpen(false);
          setQuery("");
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              setActive(0);
            } else move(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(-1);
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            if (activeOption) choose(activeOption);
          } else if (e.key === "Tab" && open && query !== "" && activeOption) {
            // Tab is választ (gyors rögzítés), majd továbblép a következő mezőre.
            choose(activeOption);
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            setQuery("");
          }
        }}
      />
      {open && (
        <ul className="combobox-list" role="listbox" id={listId} ref={listRef} aria-label="Számlák">
          {options.length === 0 && (
            <li className="combobox-empty" role="presentation">
              Nincs találat. Gyűjtőszámlára nem lehet könyvelni – válasszon alszámlát.
            </li>
          )}
          {options.map((a, i) => (
            <li
              key={a.id}
              id={`${listId}-${a.id}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "is-active" : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(a);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="mono">{a.number}</span> {a.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
