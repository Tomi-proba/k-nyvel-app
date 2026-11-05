import type { ReactNode } from "react";
import { ErtesitesSzolgaltato, useErtesites } from "@aweboldal/felulet";

/**
 * Rövid visszajelzések a közös komponenskészlet értesítéseivel (TERV.md F23 KB4); a képernyőolvasó is bemondja.
 * A keretben a keret értesítési helye szolgál ki (a Könyvelő nem jelenít meg másodikat).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  return <ErtesitesSzolgaltato>{children}</ErtesitesSzolgaltato>;
}

export function useToast() {
  const ertesit = useErtesites();
  return (kind: "success" | "error", text: string) => ertesit(text, kind === "success" ? "siker" : "hiba");
}
