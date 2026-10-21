import { existsSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Konténerben (pl. GitHub Codespaces) fut-e: ott a porttovábbítás kívülről, a 127.0.0.1-re csatlakozik. */
const codespace = Boolean(process.env.CODESPACES || process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || existsSync("/.dockerenv"));

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Codespaces: a „localhost” csak IPv6-on (::1) figyelhet, ezért minden címen figyelünk,
    // és a Codespace saját (…app.github.dev) címét is elfogadjuk.
    host: codespace ? "0.0.0.0" : undefined,
    allowedHosts: codespace ? true : undefined,
    // Fejlesztéskor az /api kéréseket a Fastify szerver kapja.
    proxy: { "/api": "http://127.0.0.1:3000" },
  },
  build: { sourcemap: true },
});
