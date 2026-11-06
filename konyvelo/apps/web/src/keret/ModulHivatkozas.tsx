// Hivatkozás egy másik program tételére (F18, a keretben F26). Önállóan a program beállított címe (új lapon, mint
// eddig); a közös keretben a keret útvonala (pl. /keszlet/mozgas/12), ugyanazon a felületen, új ablak nélkül – a keret
// kiválasztott cégénél.
import type { ReactNode } from "react";
import { useKeretHaVan } from "@aweboldal/felulet";
import { esemenyHivatkozas } from "@aweboldal/modulok";

const MODUL_ESEMENY: Record<string, string> = { konyvelo: "konyvelo", keszlet: "keszlet", eafa: "eafa", afa: "eafa" };

export function ModulHivatkozas({ module, path, url, children }: { module: string; path?: string | null; url: string | null; children: ReactNode }) {
  const k = useKeretHaVan();
  if (k) {
    if (!path || !MODUL_ESEMENY[module]) return <>{children}</>;
    const cel = esemenyHivatkozas({ module: MODUL_ESEMENY[module], path });
    return (
      <a
        href={cel}
        data-modul-hivatkozas={module}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          k.navigal(cel);
        }}
      >
        {children}
      </a>
    );
  }
  if (!url) return <>{children}</>;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
