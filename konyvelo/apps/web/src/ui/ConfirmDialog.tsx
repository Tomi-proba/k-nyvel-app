import type { ReactNode } from "react";
import { Megerosites } from "@aweboldal/felulet";

/**
 * Megerősítés veszélyes műveletekhez (törlés, eltávolítás, zárás): a közös komponenskészlet megerősítő ablaka
 * (TERV.md F23 KB4). Leírja a következményt; a fókusz alapból a „Mégse” gombon van, így Enterrel nem lehet
 * véletlenül jóváhagyni.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
  danger = true,
}: {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<unknown> | void;
  danger?: boolean;
}) {
  return <Megerosites kivalto={trigger} cim={title} leiras={description} megerositesFelirat={confirmLabel} onMegerosites={onConfirm} veszelyes={danger} />;
}
