import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createDb } from "./core/db";

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
const app = await buildApp(config, db);

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: config.host });
console.log(`Könyvelő API fut: http://${config.host}:${config.port}`);
