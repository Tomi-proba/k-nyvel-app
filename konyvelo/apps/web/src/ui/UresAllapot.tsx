// Üres állapot (AWEBOLDAL TERV.md F27 B4): a három programban egy minta – mi hiányzik, és mi a teendő (a fő gomb
// nevével). A kinézetet a közös `fg-ures` stílus adja (felulet.css), így a keretben mindhárom programban egyforma.
// Ha van teendő gomb, az másodlagos: az oldal fő gombja az eszközsoron marad (F27 B3).
import type { ReactNode } from "react";

export function UresAllapot({ children, teendo }: { children: ReactNode; teendo?: ReactNode }) {
  return (
    <div className="fg-ures" data-ures-allapot>
      <p>{children}</p>
      {teendo && <div className="fg-ures__teendo">{teendo}</div>}
    </div>
  );
}
