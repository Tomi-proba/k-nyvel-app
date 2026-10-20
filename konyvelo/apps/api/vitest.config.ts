import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch {
  // Nincs .env fájl: a környezeti változókat kívülről kell megadni (pl. CI).
}

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // A tesztek egy közös, valódi PostgreSQL adatbázist használnak, amelyet a
    // fájlok egymás után újraépítenek – ezért nem futhatnak párhuzamosan.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
