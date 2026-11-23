// F29 (AWEBOLDAL TERV.md): valós idejű frissítés oldalújratöltés nélkül. A szerver a cég minden változásáról adat
// nélküli jelzést küld (SSE, /api/companies/:id/elo); erre a felület a szokásos lekérdezésekkel tölti újra az adatot.
//
// Szabályok (ugyanazok, mint a Készletkezelőben):
// - több jelzés gyors egymásutánban egy frissítés (várakozás után);
// - amíg a felhasználó saját mentése fut, nem töltünk újra: a mentés végén frissítünk;
// - a lap háttérben: nem frissítünk, a visszatéréskor egyszer igen;
// - kapcsolatvesztés után visszakapcsoláskor egyszer azonnal (a kimaradt változások pótlása).
// Időnkénti tartalék-frissítés nincs: a Könyvelő eddig sem frissített magától, és az automatikus kérések a tétlenségi
// kiléptetést sem akadályozhatják.

export type CsatornaAllapot = "kapcsolodik" | "el" | "megszakadt";

export interface EloFrissitesFuggosegek {
  feliratkozik(ceg: string, jelzes: () => void, allapot: (a: CsatornaAllapot) => void): () => void;
  frissit(): Promise<void>;
  /** Igaz, ha nem fut saját mentés. */
  mentesUres(): boolean;
  mentesFigyel(fn: () => void): () => void;
  lathato(): boolean;
  lathatosagFigyel(fn: () => void): () => void;
  idozito: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void };
}

export const VARAKOZAS_MS = 600;

export class EloFrissito {
  private ceg: string | null = null;
  private leiratkozasok: (() => void)[] = [];
  private kesleltetes: unknown = null;
  private fut = false;
  private ujraKell = false;
  private varakozik = false;
  private hatterbenKimaradt = false;
  private allapot: CsatornaAllapot = "kapcsolodik";
  private readonly f: EloFrissitesFuggosegek;

  constructor(f: EloFrissitesFuggosegek) {
    this.f = f;
  }

  get csatornaAllapot(): CsatornaAllapot {
    return this.allapot;
  }

  indit(ceg: string): void {
    if (this.ceg === ceg) return;
    this.leallit();
    this.ceg = ceg;
    this.allapot = "kapcsolodik";
    this.leiratkozasok.push(
      this.f.feliratkozik(ceg, () => this.jelzes(), (a) => this.allapotValtozas(a)),
      this.f.mentesFigyel(() => {
        if (this.varakozik && this.f.mentesUres()) {
          this.varakozik = false;
          this.jelzes();
        }
      }),
      this.f.lathatosagFigyel(() => {
        if (this.f.lathato() && this.hatterbenKimaradt) {
          this.hatterbenKimaradt = false;
          this.jelzes(0);
        }
      }),
    );
  }

  leallit(): void {
    for (const l of this.leiratkozasok.splice(0)) l();
    if (this.kesleltetes !== null) this.f.idozito.clearTimeout(this.kesleltetes);
    this.kesleltetes = null;
    this.ceg = null;
    this.varakozik = false;
    this.ujraKell = false;
    this.hatterbenKimaradt = false;
  }

  jelzes(ms = VARAKOZAS_MS): void {
    if (!this.ceg) return;
    if (this.kesleltetes !== null) this.f.idozito.clearTimeout(this.kesleltetes);
    this.kesleltetes = this.f.idozito.setTimeout(() => {
      this.kesleltetes = null;
      void this.frissites();
    }, ms);
  }

  private async frissites(): Promise<void> {
    if (!this.ceg) return;
    if (!this.f.lathato()) {
      this.hatterbenKimaradt = true;
      return;
    }
    if (!this.f.mentesUres()) {
      this.varakozik = true;
      return;
    }
    if (this.fut) {
      this.ujraKell = true;
      return;
    }
    this.fut = true;
    const ceg = this.ceg;
    try {
      await this.f.frissit();
    } catch (hiba) {
      console.warn("[eloFrissites] a frissítés nem sikerült, a következő jelzésnél újra próbáljuk", hiba);
    } finally {
      this.fut = false;
    }
    if (this.ujraKell && this.ceg === ceg) {
      this.ujraKell = false;
      this.jelzes();
    }
  }

  private allapotValtozas(a: CsatornaAllapot): void {
    const korabban = this.allapot;
    this.allapot = a;
    if (a === "el" && korabban === "megszakadt") this.jelzes(0);
  }
}
