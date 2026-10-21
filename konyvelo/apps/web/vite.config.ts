import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Konténerben (pl. GitHub Codespaces) fut-e: ott a porttovábbítás kívülről vagy IPv6-on is csatlakozhat. */
const codespace = Boolean(process.env.CODESPACES || process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || existsSync("/.dockerenv"));

function hasIpv6(): boolean {
  return Object.values(networkInterfaces()).some((list) => list?.some((i) => i.family === "IPv6"));
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Codespaces: minden címen figyelünk (a „::” IPv4-en és IPv6-on is; IPv6 nélküli gépen
    // 0.0.0.0), és a Codespace saját (…app.github.dev) címét is elfogadjuk.
    host: codespace ? (hasIpv6() ? "::" : "0.0.0.0") : undefined,
    allowedHosts: codespace ? true : undefined,
    // Fejlesztéskor az /api kéréseket a Fastify szerver kapja. Az eredeti Host fejléc
    // megmarad, így az API Origin-ellenőrzése bármilyen címen (pl. Codespace) működik.
    proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: false } },
  },
  build: { sourcemap: true },
});
