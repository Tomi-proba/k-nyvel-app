import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { FieldControlProps } from "./Field";

export type ComboboxControlProps = FieldControlProps & { "aria-label"?: string };

/**
 * Kereshető választómező billentyűzetről (WAI-ARIA combobox minta): gépelésre
 * szűr, nyilakkal lehet lépkedni, Enterrel vagy Tabbal választani, Esc-kel
 * bezárni. A számla- és a partnerválasztó erre épül.
 */
export function Combobox<T>({
  items,
  search,
  getKey,
  getLabel,
  renderOption,
  value,
  onChange,
  controlProps,
  placeholder,
  listLabel,
  emptyText,
}: {
  items: readonly T[];
  search: (items: readonly T[], query: string) => T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  renderOption: (item: T) => ReactNode;
  value: string | null;
  onChange: (key: string | null, item: T | null) => void;
  controlProps: ComboboxControlProps;
  placeholder?: string;
  listLabel: string;
  emptyText: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const options = useMemo(() => search(items, query), [search, items, query]);
  const selected = items.find((i) => getKey(i) === value) ?? null;

  const choose = (item: T) => {
    onChange(getKey(item), item);
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
        aria-activedescendant={activeOption ? `${listId}-${getKey(activeOption)}` : undefined}
        placeholder={placeholder}
        value={open ? query : selected ? getLabel(selected) : ""}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
          if (e.target.value === "") onChange(null, null);
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
        <ul className="combobox-list" role="listbox" id={listId} ref={listRef} aria-label={listLabel}>
          {options.length === 0 && (
            <li className="combobox-empty" role="presentation">
              {emptyText}
            </li>
          )}
          {options.map((item, i) => (
            <li
              key={getKey(item)}
              id={`${listId}-${getKey(item)}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "is-active" : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(item);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {renderOption(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
