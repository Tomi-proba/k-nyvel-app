import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type StorageDriver = {
  /** Fájl mentése, visszaadja a tárolási kulcsot. */
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Fájl beolvasása (csak a helyi driverhez kell közvetlen kiszolgáláshoz). */
  read(key: string): Promise<Buffer>;
  /** Nyilvánosan (vagy aláírt linkkel) elérhető URL a fájlhoz. */
  getUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
};

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-120);
}

export function buildStorageKey(companyId: string, originalFileName: string): string {
  return `${companyId}/${randomUUID()}-${sanitizeFileName(originalFileName)}`;
}

class LocalStorageDriver implements StorageDriver {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private resolve(key: string): string {
    const full = path.resolve(this.baseDir, key);
    if (!full.startsWith(path.resolve(this.baseDir))) {
      throw new Error("Érvénytelen fájl elérési út.");
    }
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const filePath = this.resolve(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async getUrl(key: string): Promise<string> {
    // Helyi fejlesztésben a fájlokat egy auth-ellenőrzött route szolgálja ki,
    // mert nincsenek a /public alatt (nem publikus tárterület).
    return `/api/files/${key}`;
  }

  async delete(key: string): Promise<void> {
    await unlink(this.resolve(key)).catch(() => {});
  }
}

class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl?: string;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT;
    const region = process.env.S3_REGION || "auto";
    const bucket = process.env.S3_BUCKET;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "S3 storage driver esetén az S3_BUCKET, S3_ACCESS_KEY_ID és S3_SECRET_ACCESS_KEY env változók kötelezőek."
      );
    }

    this.bucket = bucket;
    this.publicBaseUrl = process.env.S3_PUBLIC_BASE_URL || undefined;
    this.client = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      })
    );
  }

  async read(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    const bytes = await res.Body?.transformToByteArray();
    return Buffer.from(bytes ?? []);
  }

  async getUrl(key: string): Promise<string> {
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl.replace(/\/$/, "")}/${key}`;
    }
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: 60 * 15 }
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
  }
}

let cachedDriver: StorageDriver | undefined;

export function getStorageDriver(): StorageDriver {
  if (cachedDriver) return cachedDriver;

  const driverName = process.env.STORAGE_DRIVER || "local";
  if (driverName === "s3") {
    cachedDriver = new S3StorageDriver();
  } else {
    // A feltöltött fájlok tárolási könyvtára futásidőben dől el (env), nem
    // projektfájl — nem kell a build tracing-nek statikusan bejárnia.
    const baseDir = path.resolve(/* turbopackIgnore: true */ process.env.LOCAL_STORAGE_DIR || "./storage");
    cachedDriver = new LocalStorageDriver(baseDir);
  }
  return cachedDriver;
}
