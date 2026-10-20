import { existsSync } from "node:fs";
import path from "node:path";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { CSRF_HEADER } from "@konyvelo/shared";
import type { Config } from "./config";
import { loadSession, SESSION_COOKIE } from "./core/auth";
import type { Db } from "./core/db";
import { AppError } from "./core/errors";
import type { AppModule } from "./core/modules";
import { accountsModule } from "./modules/accounts";
import { auditModule } from "./modules/audit";
import { authModule } from "./modules/auth";
import { companiesModule } from "./modules/companies";
import { fiscalYearsModule } from "./modules/fiscal-years";
import { documentsModule } from "./modules/documents";
import { partnersModule } from "./modules/partners";
import { subledgerModule } from "./modules/subledger";
import { templatesModule } from "./modules/templates";

/** A bekapcsolt modulok. Új modul felvétele: ide kell beírni. */
export const MODULES: AppModule[] = [
  authModule,
  companiesModule,
  fiscalYearsModule,
  accountsModule,
  partnersModule,
  templatesModule,
  documentsModule,
  subledgerModule,
  auditModule,
];

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

export async function buildApp(config: Config, db: Db): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie);

  app.decorateRequest("authUser", null);
  app.decorateRequest("sessionId", null);

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;

    // Biztonsági fejlécek.
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");

    // CSRF-védelem: minden módosító kérésnek tartalmaznia kell az egyedi
    // fejlécet (más oldalról küldött űrlap ilyet nem tud beállítani), és ha
    // van Origin fejléc, annak egyeznie kell a kiszolgálóval.
    if (MUTATING.has(request.method)) {
      if (request.headers[CSRF_HEADER] !== "1") {
        throw new AppError(403, "CSRF", "A kérés biztonsági ellenőrzése sikertelen. Kérjük, frissítse az oldalt.");
      }
      const origin = request.headers.origin;
      if (origin && originHost(origin) !== request.headers.host) {
        throw new AppError(403, "CSRF", "A kérés más webhelyről érkezett, ezért elutasítottuk.");
      }
    }

    const session = await loadSession(db, config, request.cookies[SESSION_COOKIE]);
    if (session) {
      request.authUser = session.user;
      request.sessionId = session.sessionId;
    }
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send(err.toJSON());
    }
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      // Pl. hibás JSON, nem támogatott tartalomtípus, túl nagy kérés.
      return reply.code(statusCode).send({
        error: { code: "BAD_REQUEST", message: "A kérés formailag hibás. Kérjük, próbálja újra." },
      });
    }
    request.log.error(err);
    return reply.code(500).send({
      error: { code: "INTERNAL", message: "Váratlan hiba történt. Kérjük, próbálja újra, vagy szóljon a rendszergazdának." },
    });
  });

  for (const mod of MODULES) {
    await mod.register(app, { db, config });
  }

  app.get("/api/health", async () => ({ ok: true }));

  // A lefordított felület kiszolgálása (éles üzem). Fejlesztéskor a Vite
  // fejlesztői szervere szolgálja ki a felületet.
  const dist = config.webDistDir;
  if (dist && existsSync(path.join(dist, "index.html"))) {
    await app.register(fastifyStatic, { root: dist, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Nincs ilyen végpont." } });
    });
  } else {
    app.setNotFoundHandler((_request, reply) =>
      reply.code(404).send({ error: { code: "NOT_FOUND", message: "Nincs ilyen végpont." } }),
    );
  }

  return app;
}
