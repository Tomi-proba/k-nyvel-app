// F29 (AWEBOLDAL TERV.md): valós idejű frissítés oldalújratöltés nélkül.
//
// Minden üzleti változás bekerül az audit naplóba (writeAudit, ugyanabban a tranzakcióban). Ugyanott egy adat nélküli
// jelzés is megy a PostgreSQL NOTIFY-jal: a cég azonosítója és a változás fajtája. A NOTIFY a tranzakció véglegesítésekor
// kézbesül, visszagörgetett módosításról nem megy jelzés. A szerver egy külön kapcsolaton figyeli (LISTEN), és a cég
// nyitott SSE-kapcsolataira továbbítja; a felület erre a szokásos, jogosultság-ellenőrzött lekérdezéssel tölti újra az
// adatot. Több szerverpéldánynál is működik, mert a jelzés az adatbázison át megy.
import pg from "pg";
import { sql } from "drizzle-orm";
import type { Tx } from "./db";

export const ELO_CSATORNA = "konyvelo_valtozas";

/** Adat nélküli jelzés a cég nyitott kapcsolatainak (a tranzakció véglegesítésekor megy ki). */
export async function valtozasJelzes(tx: Tx, companyId: string, fajta: string): Promise<void> {
  await tx.execute(sql`SELECT pg_notify(${ELO_CSATORNA}, ${JSON.stringify({ c: companyId, f: fajta })})`);
}

export type EloJelzes = { fajta: string };
type Figyelo = (j: EloJelzes) => void;

/**
 * A jelzések elosztása a cégek nyitott kapcsolatai között. Az adatbázis-figyelés csak akkor fut, ha van feliratkozó;
 * kapcsolatvesztéskor egyre ritkábban próbál újra, és visszakapcsoláskor minden feliratkozónak szól
 * („ujrakapcsolodas”), hogy a kimaradt változásokat pótolják.
 */
export class EloEloszto {
  private readonly figyelok = new Map<string, Set<Figyelo>>();
  private kliens: pg.Client | null = null;
  private indul: Promise<void> | null = null;
  private ujraIdozito: NodeJS.Timeout | null = null;
  private varakozas = 1000;
  private leallitva = false;
  private voltKapcsolat = false;

  constructor(
    private readonly connectionString: string,
    private readonly naplo: { warn: (obj: unknown, msg?: string) => void } = console,
  ) {}

  feliratkozik(companyId: string, fn: Figyelo): () => void {
    let halmaz = this.figyelok.get(companyId);
    if (!halmaz) this.figyelok.set(companyId, (halmaz = new Set()));
    halmaz.add(fn);
    void this.kapcsolodik();
    return () => {
      const h = this.figyelok.get(companyId);
      if (!h) return;
      h.delete(fn);
      if (h.size === 0) this.figyelok.delete(companyId);
    };
  }

  /** Feliratkozók száma (tesztekhez és naplózáshoz). */
  get feliratkozok(): number {
    let n = 0;
    for (const h of this.figyelok.values()) n += h.size;
    return n;
  }

  /** Megvárja, hogy az adatbázis-figyelés elinduljon (tesztekhez). */
  async kesz(): Promise<void> {
    await this.kapcsolodik();
  }

  async leallit(): Promise<void> {
    this.leallitva = true;
    if (this.ujraIdozito) clearTimeout(this.ujraIdozito);
    this.ujraIdozito = null;
    this.figyelok.clear();
    const k = this.kliens;
    this.kliens = null;
    if (k) await k.end().catch(() => undefined);
  }

  private kapcsolodik(): Promise<void> {
    if (this.leallitva || this.kliens) return Promise.resolve();
    if (this.indul) return this.indul;
    this.indul = (async () => {
      const k = new pg.Client({ connectionString: this.connectionString });
      k.on("notification", (msg) => this.kezbesit(msg.payload));
      k.on("error", (err) => this.megszakadt(k, err));
      k.on("end", () => this.megszakadt(k));
      try {
        await k.connect();
        await k.query(`LISTEN ${ELO_CSATORNA}`);
        if (this.leallitva) {
          await k.end().catch(() => undefined);
          return;
        }
        this.kliens = k;
        this.varakozas = 1000;
        if (this.voltKapcsolat) this.mindenkinek({ fajta: "ujrakapcsolodas" });
        this.voltKapcsolat = true;
      } catch (err) {
        await k.end().catch(() => undefined);
        this.megszakadt(k, err);
      } finally {
        this.indul = null;
      }
    })();
    return this.indul;
  }

  private megszakadt(k: pg.Client, err?: unknown): void {
    if (this.kliens === k) this.kliens = null;
    if (this.leallitva || this.ujraIdozito) return;
    if (err) this.naplo.warn({ err }, "Az élő frissítés adatbázis-figyelése megszakadt, újrapróbálom");
    this.ujraIdozito = setTimeout(() => {
      this.ujraIdozito = null;
      if (this.figyelok.size > 0) void this.kapcsolodik();
    }, this.varakozas);
    this.ujraIdozito.unref?.();
    this.varakozas = Math.min(this.varakozas * 2, 30_000);
  }

  private kezbesit(payload: string | undefined): void {
    if (!payload) return;
    let j: { c?: unknown; f?: unknown };
    try {
      j = JSON.parse(payload) as { c?: unknown; f?: unknown };
    } catch {
      return;
    }
    if (typeof j.c !== "string") return;
    const fajta = typeof j.f === "string" ? j.f : "valtozas";
    for (const fn of this.figyelok.get(j.c) ?? []) fn({ fajta });
  }

  private mindenkinek(j: EloJelzes): void {
    for (const h of this.figyelok.values()) for (const fn of h) fn(j);
  }
}
