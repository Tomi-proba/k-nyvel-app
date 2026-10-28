import type { FastifyInstance } from "fastify";
import type { Config } from "../config";
import type { Db } from "./db";
import type { FileStore } from "./filestore";

/**
 * Modul-regiszter. Minden funkcionális egység (cégek, üzleti évek, később
 * számlatükör, bizonylatok, NAV-import…) egy modul, amely itt jelenti be az
 * útvonalait. Új modul felvétele a meglévők módosítása nélkül lehetséges.
 */
/** `files`: a csatolmányok tárolója (helyi mappa vagy S3, beállításból). */
export type ModuleContext = { db: Db; config: Config; files: FileStore };

export type AppModule = {
  name: string;
  register(app: FastifyInstance, ctx: ModuleContext): void | Promise<void>;
};
