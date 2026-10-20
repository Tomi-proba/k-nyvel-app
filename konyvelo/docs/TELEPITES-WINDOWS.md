# Telepítés és indítás Windowson – kezdőknek

Kb. 20–30 perc, ebből a legtöbb a letöltés. Csak egyszer kell végigcsinálni.

## 1. Három program telepítése

Mindhármat a hivatalos oldalról töltse le, és a telepítőben az alapbeállításokat hagyja meg („Next”, „Next”…).

1. **Node.js** – https://nodejs.org → az **LTS** feliratú „Windows Installer (.msi)”.
2. **PostgreSQL 16** (adatbázis) – https://www.postgresql.org/download/windows/ → „Download the installer” → a **16**-os verzió Windows változata.
   - A telepítő kér egy **jelszót** a „postgres” felhasználóhoz. **Írja fel**, később kelleni fog.
   - A port maradjon **5432**. A végén a „Stack Builder” ablakot nyugodtan zárja be.
3. **Git** (a program letöltéséhez) – https://git-scm.com/download/win → „Click here to download”.

## 2. A program letöltése

1. Nyissa meg a **Parancssort**: Start menü → írja be: `cmd` → Enter.
   (A PowerShell helyett a Parancssort ajánlom, mert abban nem kell biztonsági beállítást módosítani.)
2. Másolja be egyenként a következő sorokat, mindegyik után Enter:

```
cd %USERPROFILE%\Documents
git clone -b claude/adoring-gates-qkf0a7 https://github.com/tomi-proba/k-nyvel-app.git
cd k-nyvel-app\konyvelo
```

Ha a Git bejelentkezést kér, jelentkezzen be a GitHub-fiókjával a felugró böngészőablakban.

## 3. Előkészítés (csak egyszer)

Ugyanabban a Parancssor-ablakban:

```
npx -y npm@11 install
```
Letölti a szükséges összetevőket (pár perc, sok szöveg jelenik meg – ez rendben van).

```
npm run db:setup
```
Megkérdezi a PostgreSQL telepítésekor felírt jelszót. **Gépeléskor nem látszik semmi** – ez szándékos. Írja be, majd Enter. A végén: „Kész.”

```
npm run db:migrate
```
Létrehozza a táblákat. A végén: „Kész: … migráció lefutott.”

## 4. Indítás

```
npm run dev
```

Pár másodperc múlva nyissa meg a böngészőben: **http://localhost:5173**

- A Parancssor-ablakot **hagyja nyitva**, amíg a programot használja.
- Leállítás: a Parancssorban **Ctrl+C**, majd „I” (vagy „Y”) és Enter.
- Legközelebbi indításkor elég: `cmd` → `cd %USERPROFILE%\Documents\k-nyvel-app\konyvelo` → `npm run dev`.

Ezután jöhet a [kipróbálható forgatókönyv](../README.md#kipróbálható-forgatókönyv-kézi-ellenőrzéshez).

## Frissítés (ha új verzió készült)

```
cd %USERPROFILE%\Documents\k-nyvel-app\konyvelo
git pull
npx -y npm@11 install
npm run db:migrate
npm run dev
```

## Ha valami nem működik

| Üzenet | Teendő |
|---|---|
| `'node' is not recognized…` vagy `'git' is not recognized…` | Zárja be és nyissa meg újra a Parancssort (a telepítés után kell). Ha így sem megy, indítsa újra a gépet. |
| `HIBA: Hibás jelszó.` | A PostgreSQL telepítésekor megadott jelszót kell beírni. Futtassa újra: `npm run db:setup` |
| `HIBA: Nem érem el a PostgreSQL-t` | Start → „Szolgáltatások” (services.msc) → „postgresql-x64-16” → Indítás. |
| `running scripts is disabled on this system` | PowerShellben van; használja helyette a Parancssort (`cmd`). |
| `EADDRINUSE` / a port foglalt | Már fut egy példány (egy másik ablakban). Zárja be azt, vagy állítsa le Ctrl+C-vel. |
| A böngésző nem tölt be | Várjon pár másodpercet, amíg a Parancssorban megjelenik a `Local: http://localhost:5173/` sor, majd frissítsen. |

Ha elakad, másolja be nekem a Parancssorban megjelent hibaüzenetet.
