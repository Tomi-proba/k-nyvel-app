import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createDb } from "./core/db";
import { createHubClient } from "@konyvelo/esemenyek";
import { startRelay } from "./modules/integration/relay";

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
const app = await buildApp(config, db);
// Integráció (I2): az átadó csak akkor fut, ha a központ be van állítva.
const stopRelay = config.hub ? startRelay(db, createHubClient({ url: config.hub.url, module: "konyvelo", secret: config.hub.secret }), app.log) : () => undefined;

const shutdown = async () => {
  stopRelay();
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: config.host });
console.log(`Könyvelő API fut: http://${config.host}:${config.port}`);
