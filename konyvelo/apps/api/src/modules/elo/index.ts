// F29 (AWEBOLDAL TERV.md): a cég változásainak élő jelzése (SSE). Adatot nem küld, csak azt, hogy valami változott
// (és milyen fajta); a felület erre a szokásos lekérdezésekkel tölti újra, ami a jogosultságot is ellenőrzi.
// Csak az kapja, aki a céget láthatja. A kapcsolat 15 percenként lezárul, és a böngésző újra kapcsolódik: így a kilépés
// és a tagság megszűnése legkésőbb ennyi idő múlva a nyitott kapcsolatra is hat. A kapcsolat nem hosszabbítja a
// munkamenetet (app.ts, loadSession: csusztat).
import { requireCompanyPermission } from "../../core/auth";
import { EloEloszto } from "../../core/elo";
import type { AppModule } from "../../core/modules";

export const ELO_PING_MS = 25_000;
export const ELO_LEJARAT_MS = 15 * 60_000;

export const eloModule: AppModule = {
  name: "elo",
  register(app, { db, config }) {
    const eloszto = new EloEloszto(config.databaseUrl, app.log);
    app.decorate("eloEloszto", eloszto);
    // A nyitott kapcsolatok: a szerver leállításakor ezek is lezárulnak.
    const nyitott = new Set<() => void>();
    app.addHook("onClose", async () => {
      for (const zar of [...nyitott]) zar();
      await eloszto.leallit();
    });

    app.get<{ Params: { companyId: string } }>("/api/companies/:companyId/elo", async (request, reply) => {
      const companyId = request.params.companyId;
      await requireCompanyPermission(db, request, companyId, "company:read");

      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        // Közbenső kiszolgáló (nginx, proxy) ne pufferelje.
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      });
      const ir = (s: string) => {
        if (!res.writableEnded) res.write(s);
      };
      ir("retry: 5000\n\n");
      ir("event: kapcsolodva\ndata: {}\n\n");
      const leiratkozik = eloszto.feliratkozik(companyId, (j) => ir(`event: valtozas\ndata: ${JSON.stringify(j)}\n\n`));
      const ping = setInterval(() => ir(": ping\n\n"), ELO_PING_MS);
      const lejarat = setTimeout(() => res.end(), ELO_LEJARAT_MS);
      let lezarva = false;
      const lezar = () => {
        if (lezarva) return;
        lezarva = true;
        nyitott.delete(lezar);
        clearInterval(ping);
        clearTimeout(lejarat);
        leiratkozik();
        if (!res.writableEnded) res.end();
      };
      nyitott.add(lezar);
      request.raw.on("close", lezar);
      res.on("close", lezar);
    });
  },
};

declare module "fastify" {
  interface FastifyInstance {
    eloEloszto: EloEloszto;
  }
}
