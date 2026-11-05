// A Könyvelő felület-csomagja a közös keretnek (TERV.md F23 KB6): IIFE, a keret közös példányaira hivatkozva
// (window.__keret), azokat nem csomagolja be. Kimenet: dist/modul/modul.js és modul.css. Az önálló felület
// fordítása (vite.config.ts) változatlan.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { keretCss } from "./keret-css";

const kozos: Record<string, string> = {
  react: "__keret.React",
  "react-dom": "__keret.ReactDOM",
  "react/jsx-runtime": "__keret.jsxRuntime",
  "react-router": "__keret.ReactRouter",
  "react-router-dom": "__keret.ReactRouter",
  "@aweboldal/felulet": "__keret.Felulet",
};

export default defineConfig({
  plugins: [react()],
  esbuild: { jsx: "automatic" },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  css: { postcss: { plugins: [keretCss()] } },
  build: {
    outDir: "dist/modul",
    emptyOutDir: true,
    sourcemap: true,
    cssCodeSplit: false,
    lib: { entry: "src/modul.tsx", formats: ["iife"], name: "__konyveloModul", fileName: () => "modul.js", cssFileName: "modul" },
    rollupOptions: { external: Object.keys(kozos), output: { globals: kozos } },
  },
});
