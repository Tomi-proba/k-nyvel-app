# Könyvelő – kettős könyviteli webalkalmazás

Magyar nyelvű, kettős könyvvitelt vezető webalkalmazás. A követelmények a
[`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md), a terv a [`docs/PLAN.md`](docs/PLAN.md) fájlban vannak.

> A repository gyökerében lévő régi (Next.js) kód ettől független; ez a projekt
> teljes egészében a `konyvelo/` könyvtárban van.

## Állapot

| Lépés | Tartalom | Állapot |
|---|---|---|
| 1. Alapok | projektváz, adatbázis, belépés, jogosultság, audit napló, cégek, üzleti évek | ✅ kész |
| 2. Számlatükör, partnerek | alapértelmezett számlatükör, szerkesztő, számlakereső, partnerek | 🔶 a mérleg- és eredménykimutatás-sorok hozzárendelése az Szt. 1–2. mellékletére vár |
| 3. Bizonylatok és tételek | | ⏳ |
| 4. Analitika, bank, pénztár | | ⏳ |
| 5. Kimutatások | | ⏳ |
| 6. Zárás | | ⏳ |
| 7. NAV Online Számla import | | ⏳ |
| 8. Mentés, export, Docker | | ⏳ |

## Felépítés

```
packages/domain   tiszta könyvelési logika (dátum, Ft, adószám, üzleti év, audit-lánc) – tesztek
packages/shared   közös sémák (Zod) magyar hibaüzenetekkel, szerepkörök, API-típusok
apps/api          Fastify + Drizzle + PostgreSQL szerver, SQL-migrációk, integrációs tesztek
apps/web          React + Vite felület
e2e               Playwright böngészős tesztek akadálymentességi (axe) ellenőrzéssel
```

## Telepítés (fejlesztői gép)

Előfeltételek: **Node.js 22**, **npm 11** (az npm 10-ben ismert hiba miatt), **PostgreSQL 16**.

```bash
cd konyvelo
npx npm@11 install               # vagy: npm install, ha már npm 11 van telepítve
cp .env.example .env              # szükség szerint szerkessze
sudo -u postgres bash scripts/db-setup.sh   # adatbázis-felhasználók és adatbázisok
npm run db:migrate                # táblák, megkötések, triggerek
npm run dev                       # API: http://127.0.0.1:3000, felület: http://localhost:5173
```

Első megnyitáskor a felület az **Első indítás** oldalra visz, ahol létrehozhatja
az első felhasználót. Utána vegyen fel egy céget, majd az első üzleti évet.

### Adatbázis-felhasználók

- `konyvelo_owner` – a séma tulajdonosa, csak a migrációkat futtatja.
- `konyvelo_app` – az alkalmazás ezzel fut. Az audit naplót és a belépési
  eseményeket csak bővíteni tudja; ezek módosítását és törlését ráadásul
  adatbázis-trigger is tiltja.

## Tesztek

```bash
npm test             # egység- és integrációs tesztek (valódi PostgreSQL, konyvelo_test adatbázis)
npm run test:e2e     # felület fordítása + böngészős tesztek (konyvelo_e2e adatbázis)
npm run typecheck    # TypeScript-ellenőrzés minden csomagra
```

A tesztek a `konyvelo_test` és `konyvelo_e2e` adatbázist minden futáskor
**törlik és újraépítik** (biztonsági ellenőrzés: csak `_test`, illetve `_e2e`
végű adatbázisnévvel futnak).

## Éles futtatás (egyszerű)

```bash
npm run build        # a felület lefordítása (apps/web/dist)
NODE_ENV=production COOKIE_SECURE=true npm start
```

Az API ilyenkor a lefordított felületet is kiszolgálja. HTTPS-t fordított
proxy (pl. nginx) biztosítson; ekkor `TRUST_PROXY=true`.

## Gyorsbillentyűk

| Billentyű | Művelet |
|---|---|
| Alt+N, F2, vagy N (beviteli mezőn kívül) | Új tétel |
| Alt+L | Sablon választása (tételrögzítéskor) |
| Ctrl+Enter | Űrlap mentése |
| Esc | Mégse / ablak bezárása |
| ? | Gyorsbillentyűk listája |

A magyar billentyűzeten az AltGr+N (= Ctrl+Alt+N) a `}` jelet írja, ezért az
alkalmazás csak a Ctrl nélküli Alt+N-re reagál. A magyar nyelvű Firefoxban az
Alt+N a „Nézet” menü hozzáférési billentyűje; az alkalmazás ezt elnyeli – ha
mégis megnyílna a menü, használja az F2-t.
