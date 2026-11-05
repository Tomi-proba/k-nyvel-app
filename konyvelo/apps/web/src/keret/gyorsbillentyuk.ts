// A Könyvelő gyorsbillentyűi a keret rendszerében (TERV.md F23 KB4). Az új tétel (Alt+N, F2, N) a keret közös
// billentyűje; a Könyvelő saját billentyűje a sablonválasztás. A keret szabálya szerint minden Alt-os
// billentyűnek van módosító nélküli tartaléka (beviteli mezőn kívül).
import type { Gyorsbillentyu } from "@aweboldal/modulok";

export const SABLON_BILLENTYU: Gyorsbillentyu = {
  azon: "konyvelo-sablon",
  leiras: "Kontírozási sablon választása",
  billentyuk: [{ kod: "KeyL", alt: true }, { kod: "KeyL" }],
  forras: "konyvelo",
  megjegyzes: "Tételrögzítés közben.",
};

export const KONYVELO_GYORSBILLENTYUK: readonly Gyorsbillentyu[] = [SABLON_BILLENTYU];
