import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // GitHub Codespaces: a program a Codespace saját (…app.github.dev) címén érhető el.
    allowedHosts: process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ? [`.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`] : undefined,
    // Fejlesztéskor az /api kéréseket a Fastify szerver kapja.
    proxy: { "/api": "http://127.0.0.1:3000" },
  },
  build: { sourcemap: true },
});
