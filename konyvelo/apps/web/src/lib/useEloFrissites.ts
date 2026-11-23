// F29: a kiválasztott cég élő jelzéseinek bekötése (önállóan és a keretben is). Lásd eloFrissites.ts.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiCim } from "../keret/futas";
import { automatikusan } from "./api";
import { EloFrissito } from "./eloFrissites";

/** Ha a kapcsolat végleg megszakad (pl. lejárt a belépés), egyre ritkábban próbálunk újra. */
const UJRA_MS = 5_000;
const UJRA_MAX_MS = 120_000;

export function useEloFrissites(companyId: string | null): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!companyId || typeof EventSource === "undefined") return;
    const frissito = new EloFrissito({
      feliratkozik(ceg, jelzes, allapot) {
        let es: EventSource | null = null;
        let ujra: number | undefined;
        let varakozas = UJRA_MS;
        let zarva = false;
        const nyit = () => {
          es = new EventSource(apiCim(`/api/companies/${ceg}/elo`), { withCredentials: true });
          es.addEventListener("kapcsolodva", () => {
            varakozas = UJRA_MS;
            allapot("el");
          });
          es.addEventListener("valtozas", () => jelzes());
          es.onerror = () => {
            allapot("megszakadt");
            // Hálózati hibánál a böngésző magától újrakapcsol; ha a szerver elutasította (pl. kilépés), mi próbáljuk.
            if (es && es.readyState === EventSource.CLOSED && !zarva) {
              es.close();
              ujra = window.setTimeout(nyit, varakozas);
              varakozas = Math.min(varakozas * 2, UJRA_MAX_MS);
            }
          };
        };
        nyit();
        return () => {
          zarva = true;
          window.clearTimeout(ujra);
          es?.close();
        };
      },
      frissit: () => automatikusan(() => qc.invalidateQueries()),
      mentesUres: () => qc.isMutating() === 0,
      mentesFigyel: (fn) => qc.getMutationCache().subscribe(() => fn()),
      lathato: () => document.visibilityState === "visible",
      lathatosagFigyel: (fn) => {
        document.addEventListener("visibilitychange", fn);
        return () => document.removeEventListener("visibilitychange", fn);
      },
      idozito: { setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: (id) => window.clearTimeout(id as number) },
    });
    frissito.indit(companyId);
    return () => frissito.leallit();
  }, [companyId, qc]);
}
