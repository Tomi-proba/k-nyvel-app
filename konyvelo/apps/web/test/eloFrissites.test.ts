// F29: a felület élő frissítésének szabályai (késleltetés, mentés közben várakozás, háttérben szünet, visszakapcsolás).
import { describe, expect, it } from "vitest";
import { EloFrissito, VARAKOZAS_MS, type CsatornaAllapot } from "../src/lib/eloFrissites";

function kornyezet() {
  let ido = 0;
  const idozitok = new Map<number, { t: number; fn: () => void }>();
  let kov = 1;
  const k = {
    frissitesek: 0,
    mentesFut: false,
    lathatoE: true,
    jelzo: null as null | (() => void),
    allapot: null as null | ((a: CsatornaAllapot) => void),
    mentesFigyelok: [] as (() => void)[],
    lathatosagFigyelok: [] as (() => void)[],
    async telik(ms: number) {
      ido += ms;
      for (const [id, t] of [...idozitok]) if (t.t <= ido) {
        idozitok.delete(id);
        t.fn();
      }
      await Promise.resolve();
      await Promise.resolve();
    },
  };
  const f = new EloFrissito({
    feliratkozik(_c, jelzes, allapot) {
      k.jelzo = jelzes;
      k.allapot = allapot;
      return () => {
        k.jelzo = null;
      };
    },
    frissit: async () => {
      k.frissitesek++;
    },
    mentesUres: () => !k.mentesFut,
    mentesFigyel: (fn) => (k.mentesFigyelok.push(fn), () => undefined),
    lathato: () => k.lathatoE,
    lathatosagFigyel: (fn) => (k.lathatosagFigyelok.push(fn), () => undefined),
    idozito: {
      setTimeout: (fn, ms) => {
        const id = kov++;
        idozitok.set(id, { t: ido + ms, fn });
        return id;
      },
      clearTimeout: (id) => void idozitok.delete(id as number),
    },
  });
  return { f, k };
}

describe("élő frissítés a felületen (F29)", () => {
  it("több gyors jelzés egy frissítés", async () => {
    const { f, k } = kornyezet();
    f.indit("ceg");
    k.jelzo!();
    k.jelzo!();
    await k.telik(VARAKOZAS_MS / 2);
    k.jelzo!();
    await k.telik(VARAKOZAS_MS);
    expect(k.frissitesek).toBe(1);
  });

  it("saját mentés közben vár, utána frissít", async () => {
    const { f, k } = kornyezet();
    f.indit("ceg");
    k.mentesFut = true;
    k.jelzo!();
    await k.telik(VARAKOZAS_MS);
    expect(k.frissitesek).toBe(0);
    k.mentesFut = false;
    k.mentesFigyelok.forEach((fn) => fn());
    await k.telik(VARAKOZAS_MS);
    expect(k.frissitesek).toBe(1);
  });

  it("háttérben nem frissít; visszatéréskor egyszer, ha közben jött jelzés", async () => {
    const { f, k } = kornyezet();
    f.indit("ceg");
    k.lathatoE = false;
    k.jelzo!();
    await k.telik(VARAKOZAS_MS);
    expect(k.frissitesek).toBe(0);
    k.lathatoE = true;
    k.lathatosagFigyelok.forEach((fn) => fn());
    await k.telik(0);
    expect(k.frissitesek).toBe(1);
    // Jelzés nélkül a visszatérés nem frissít.
    k.lathatosagFigyelok.forEach((fn) => fn());
    await k.telik(0);
    expect(k.frissitesek).toBe(1);
  });

  it("megszakadás után visszakapcsoláskor pótol; leállítás után nem frissít", async () => {
    const { f, k } = kornyezet();
    f.indit("ceg");
    k.allapot!("el");
    await k.telik(0);
    expect(k.frissitesek).toBe(0);
    k.allapot!("megszakadt");
    k.allapot!("el");
    await k.telik(0);
    expect(k.frissitesek).toBe(1);
    f.leallit();
    expect(k.jelzo).toBeNull();
  });
});
