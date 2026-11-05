// A Könyvelő felület-csomagja a közös keretnek (TERV.md F23 KB6): `/modulok/konyvelo/modul.js`. A keret közös
// példányait használja (React, útválasztó, közös komponensek: window.__keret), és a window.__modulok.konyvelo
// alá regisztrál. A stílusa (modul.css) a Könyvelő dobozára szűkítve készül (vite.keret.config.ts).
import type { ModulCsomag } from "@aweboldal/felulet";
import { KeretKepernyok } from "./keret/KeretApp";
import { KONYVELO_GYORSBILLENTYUK } from "./keret/gyorsbillentyuk";
import "./styles.css";

const csomag: ModulCsomag = {
  szerzodes: 1,
  kod: "konyvelo",
  Kepernyok: KeretKepernyok,
  // A Könyvelő dátumtartománnyal dolgozik: a keret választását változatlanul kapja (hónap, negyedév vagy év).
  idoszakFajta: null,
  gyorsbillentyuk: [...KONYVELO_GYORSBILLENTYUK],
  stilusok: ["modul.css"],
};

window.__modulok = { ...(window.__modulok ?? {}), konyvelo: csomag };
