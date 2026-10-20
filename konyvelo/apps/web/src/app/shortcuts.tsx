import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef } from "react";
import { Kbd } from "../ui/Tooltip";

/**
 * Globális gyorsbillentyűk (PLAN 5.2).
 *
 * Új tétel: Alt+N (csak Ctrl nélkül: a magyar billentyűzeten az AltGr+N,
 * azaz Ctrl+Alt+N a „}” jelet írja), F2, vagy N, ha a fókusz nem
 * beviteli mezőben van. Macen az Option+N karaktert ír, ott az F2 és az N
 * a fő gyorsbillentyű.
 */
export const SHORTCUTS: Array<{ keys: string[][]; description: string; context?: string }> = [
  { keys: [["Alt", "N"], ["F2"], ["N"]], description: "Új tétel rögzítése", context: "Az N csak akkor, ha nem beviteli mezőben áll a kurzor." },
  { keys: [["Alt", "L"]], description: "Kontírozási sablon választása", context: "Tételrögzítés közben." },
  { keys: [["Ctrl", "Enter"]], description: "Mentés", context: "Űrlapokon." },
  { keys: [["Esc"]], description: "Mégse / ablak bezárása" },
  { keys: [["?"]], description: "Gyorsbillentyűk listája", context: "Ha nem beviteli mezőben áll a kurzor." },
];

/** A tooltipekben használt rövid felirat: „Alt+N, F2 vagy N” */
export const NEW_ENTRY_SHORTCUT_TEXT = "Alt+N, F2 vagy N";

export function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <span className="row" style={{ gap: 2, display: "inline-flex" }}>
      {keys.map((k, i) => (
        <span key={k}>
          {i > 0 && "+"}
          <Kbd>{k}</Kbd>
        </span>
      ))}
    </span>
  );
}

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["button", "submit", "checkbox", "radio", "reset"].includes(type);
  }
  return (el as HTMLElement).isContentEditable;
}

export function matchesNewEntry(
  e: Pick<KeyboardEvent, "key" | "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">,
  editable: boolean,
  isMac = false,
): boolean {
  const noMods = !e.altKey && !e.ctrlKey && !e.metaKey;
  if (e.key === "F2" && noMods && !e.shiftKey) return true;
  // Macen beviteli mezőben az Option+N karaktert ír, ott nem vesszük el.
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === "KeyN" && !(isMac && editable)) return true;
  if (!editable && noMods && !e.shiftKey && (e.key === "n" || e.key === "N")) return true;
  return false;
}

export function useGlobalShortcuts(handlers: { onNewEntry: () => void; onHelp: () => void }) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      // Nyitott párbeszédablakban a globális billentyűk nem működnek.
      if (document.querySelector("[role='dialog'], [role='alertdialog']")) return;
      const editable = isEditable(document.activeElement);
      if (matchesNewEntry(e, editable, /Mac|iPhone|iPad/.test(navigator.platform))) {
        e.preventDefault();
        ref.current.onNewEntry();
        return;
      }
      if (!editable && e.key === "?" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        ref.current.onHelp();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

export function ShortcutHelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title asChild>
            <h2>Gyorsbillentyűk</h2>
          </Dialog.Title>
          <Dialog.Description className="muted">A gyakori műveletek billentyűzetről is elérhetők.</Dialog.Description>
          <table className="shortcut-table">
            <thead>
              <tr>
                <th scope="col">Billentyű</th>
                <th scope="col">Művelet</th>
              </tr>
            </thead>
            <tbody>
              {SHORTCUTS.map((s) => (
                <tr key={s.description}>
                  <td>
                    {s.keys.map((combo, i) => (
                      <span key={combo.join("+")}>
                        {i > 0 && <span className="muted"> vagy </span>}
                        <KeyCombo keys={combo} />
                      </span>
                    ))}
                  </td>
                  <td>
                    {s.description}
                    {s.context && <div className="muted">{s.context}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <button type="button" className="btn btn-primary">
                Bezárás
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
