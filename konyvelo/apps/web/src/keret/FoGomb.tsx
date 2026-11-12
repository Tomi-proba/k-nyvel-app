// Egy fő gomb oldalanként (AWEBOLDAL TERV.md F27 B3): a keretben az oldal fő művelete (pl. „Új bizonylat”,
// „Új partner”) nem az oldal fejlécében, hanem a Könyvelő eszközsorán, mindig jobb fent jelenik meg, egyetlen
// kiemelt gombként, a gyorsbillentyűvel (Alt+N, F2, N) és a tooltipben a feliratával. Ha az oldal nem ad meg
// saját fő műveletet, az alapértelmezés az „Új bizonylat”; űrlapoldalon (pl. rögzítés közben) nincs fő gomb.
// Önálló használatban minden a régi: a gomb az oldal fejlécében marad.
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { keretben } from "./futas";
import { Link } from "./router";

export interface FoMuvelet {
  cim: string;
  /** Útvonal (a Könyvelőn belül) vagy művelet. */
  to?: string;
  onClick?: () => void;
}

/** undefined: az alapértelmezés („Új bizonylat”); null: ezen az oldalon nincs fő gomb. */
type Beallito = (m: FoMuvelet | null | undefined) => void;

export const FoGombKontextus = createContext<Beallito | null>(null);

/** Az oldal fő művelete a keret eszközsorán; az oldal elhagyásakor visszaáll az alapértelmezésre. */
export function useFoMuvelet(m: FoMuvelet | null | undefined) {
  const beallit = useContext(FoGombKontextus);
  const legutobbi = useRef(m);
  useEffect(() => {
    legutobbi.current = m;
  });
  const kulcs = m === null ? "nincs" : m ? `${m.cim}|${m.to ?? ""}` : "alap";
  useEffect(() => {
    if (!beallit) return;
    beallit(m ? { ...m, onClick: () => legutobbi.current?.onClick?.() } : m);
    return () => beallit(undefined);
    // A cím és az útvonal (kulcs) változásakor jegyzi be újra; a friss onClick a refen át fut.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beallit, kulcs]);
}

/**
 * Az oldal fő gombja. A keretben a Könyvelő eszközsorára kerül (itt nem jelenik meg); önállóan a megszokott helyén,
 * a megszokott kinézettel jelenik meg.
 */
export function FoGomb({ cim, to, onClick, children, onallo }: FoMuvelet & { children?: ReactNode; onallo?: ReactNode }) {
  const keret = keretben();
  useFoMuvelet(keret ? { cim, to, onClick } : undefined);
  if (keret) return null;
  if (onallo) return <>{onallo}</>;
  if (to)
    return (
      <Link to={to} className="btn btn-primary">
        {children ?? cim}
      </Link>
    );
  return (
    <button type="button" className="btn btn-primary" onClick={onClick}>
      {children ?? cim}
    </button>
  );
}

/** Űrlapoldal (pl. rögzítés): a keret eszközsorán nincs fő gomb, az űrlap saját gombja a fő művelet. */
export function useNincsFoGomb() {
  useFoMuvelet(keretben() ? null : undefined);
}
