import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Fájltárolás (TERV.md H pont): beállításból cserélhető, a kód módosítása nélkül.
 *
 * - `local` (alapértelmezés): helyi mappa (FAJLTAR_MAPPA, alapból `storage/`).
 * - `s3`: bármely S3-kompatibilis tároló (pl. Supabase Storage, EU-s felhőtárhely).
 *
 * A kulcsot mindig a program adja (cégazonosító/csatolmány-azonosító), a felhasználó fájlneve soha nem
 * kerül bele, így útvonal-trükkel sem lehet a tárolón kívülre írni.
 */
export interface FileStore {
  readonly kind: "local" | "s3";
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** A fájl tartalma, vagy `null`, ha nincs ilyen. */
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

const KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

function checkKey(key: string): void {
  if (!KEY.test(key)) throw new Error(`Érvénytelen tárolókulcs: ${key}`);
}

export class LocalFileStore implements FileStore {
  readonly kind = "local" as const;
  constructor(readonly dir: string) {}

  private file(key: string) {
    checkKey(key);
    return path.join(this.dir, ...key.split("/"));
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.file(key);
    mkdirSync(path.dirname(target), { recursive: true });
    // Előbb ideiglenes fájlba, majd átnevezés: félig írt fájl nem maradhat a helyén.
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, data, { mode: 0o600 });
    renameSync(tmp, target);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return readFileSync(this.file(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    rmSync(this.file(key), { force: true });
  }
}

export type S3Settings = { endpoint: string | null; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean };

export class S3FileStore implements FileStore {
  readonly kind = "s3" as const;
  private client: S3Client;
  constructor(readonly settings: S3Settings) {
    this.client = new S3Client({
      region: settings.region,
      ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
      forcePathStyle: settings.forcePathStyle,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    checkKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.settings.bucket, Key: key, Body: data, ContentType: contentType }));
  }

  async get(key: string): Promise<Buffer | null> {
    checkKey(key);
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }));
      return r.Body ? Buffer.from(await r.Body.transformToByteArray()) : null;
    } catch (e) {
      if (e instanceof NoSuchKey || (e as { name?: string }).name === "NoSuchKey" || (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    checkKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key }));
  }
}

export type FileStoreConfig = { kind: "local"; dir: string } | ({ kind: "s3" } & S3Settings);

export function createFileStore(config: FileStoreConfig): FileStore {
  return config.kind === "s3" ? new S3FileStore(config) : new LocalFileStore(config.dir);
}

/** A tárolókulcs: cég és csatolmány azonosítója. */
export const storageKey = (companyId: string, attachmentId: string) => `${companyId}/${attachmentId}`;
