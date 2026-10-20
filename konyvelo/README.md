# Könyvelő – kettős könyviteli webalkalmazás

Magyar nyelvű, kettős könyvvitelt vezető webalkalmazás. A követelmények a
[`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md), a terv a [`docs/PLAN.md`](docs/PLAN.md) fájlban vannak.

> A repository gyökerében lévő régi (Next.js) kód ettől független; ez a projekt
> teljes egészében a `konyvelo/` könyvtárban van.

## Állapot

| Lépés | Tartalom | Állapot |
|---|---|---|
| 1. Alapok | projektváz, adatbázis, belépés, jogosultság, audit napló, cégek, üzleti évek | ✅ kész |
| 2. Számlatükör, partnerek | alapértelmezett számlatükör, szerkesztő, számlakereső, partnerek | ✅ kész (mérleg- és eredménykimutatás-sor hozzárendeléssel az Szt. 1–2. melléklete szerint) |
| 3. Bizonylatok és tételek | rögzítés, egyensúly, előnézet, könyvelés hézagmentes sorszámmal, sztornó, helyesbítés, sablonok, rögzítési határidő, Teendők | ✅ kész |
| 4. Analitika, bank, pénztár | | ⏳ |
| 5. Kimutatások | | ⏳ |
| 6. Zárás | | ⏳ |
| 7. NAV Online Számla import | | ⏳ |
| 8. Mentés, export, Docker | | ⏳ |

## Felépítés

```
packages/domain   tiszta könyvelési logika (dátum, Ft, adószám, üzleti év, audit-lánc, számlatükör, kimutatássorok,
                  bizonylat-ellenőrzés, egyensúly, rögzítési határidő, sablonok) – tesztek
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

## Kipróbálható forgatókönyv (kézi ellenőrzéshez)

Kb. 10 perc. Indítás után (`npm run dev`, majd http://localhost:5173) üres adatbázisból:

**0. Előkészítés**

1. Az **Első indítás** oldalon hozza létre a saját felhasználóját.
2. **Új cég létrehozása**: pl. „Minta Kft.”, adószám `10773381-2-44`. A cég az alapértelmezett számlatükörrel és 6 kontírozási sablonnal jön létre (Beállítások → Sablonok).
3. A **Beállítások → Üzleti évek** oldalon hozza létre a 2026-os üzleti évet (a javasolt dátumok jók).
4. **Partnerek → Új partner**: név „Irodaszer Kft.”, adószám `10537914-4-44`, típus *Szállító*, szállító számla `454`, költségszámla `522` (írja be: „berleti”, majd Enter), fizetési határidő `15` nap. Mentés: Ctrl+Enter.

**1. Szállítói számla rögzítése – sablonnal**

1. Nyomja meg az **F2**-t (vagy Alt+N, vagy a fejléc „+ Új tétel” gombját).
2. Típus: *Szállítói számla (bejövő)*. Partner: írja be „iroda”, Enter. A szállító számlaszáma: `IR-2026/0042`. Leírás: „Irodabérlet, október”. Kelt: `20261005` – kilépéskor `2026.10.05.` lesz, a teljesítés és a könyvelés dátuma követi, a fizetési határidő a partner 15 napjából `2026.10.20.`.
3. **Alt+L**: a sablonok között első a partner alapértelmezett kontírozása. Enter, bruttó összeg: `127000`, Enter. A sorok: 522 T 100 000 · 466 T 27 000 · 454 K 127 000. Az egyensúly-sáv zöld: „A tartozik és követel oldal egyezik.”
4. *Hibaüzenet kipróbálása:* a 3. sor követel összegét írja át `120000`-re: azonnal megjelenik „A tartozik és követel oldal nem egyezik, eltérés: 7 000 Ft”. Törölje a mezőt, és nyomja meg az **=** billentyűt: a hiányzó 127 000 kerül be.
5. **Ctrl+Enter**: előnézet (kontírozás, „Hatás a szállítói tartozásra: +127 000 Ft”). **Enter**: könyvelés. A bizonylat sorszáma `SZSZ-2026-00001`; nincs rajta szerkesztés gomb, mert könyvelt bizonylat nem módosítható.

**2. Banki kifizetés – piszkozatból, a Teendőkön keresztül**

1. **F2**, típus: *Banki bizonylat (kivonat)*, partner: Irodaszer, leírás: „Kifizetés: IR-2026/0042”, kelt: `2026.10.10`.
2. Sorok csak billentyűzettel: az 1. sor számlájába `454`, Enter (kiválaszt), Enter (következő mező), tartozik: `127000`, Enter… A sor végén az Enter új sort nyit. A 2. sor számlája `384`, a követel mezőben az **=** beírja a 127 000-et. (Vagy: Alt+L → „bki” → Enter → 127000 → Enter.)
3. **Mentés piszkozatként**.
4. **Kezdőlap**: a *Teendők* között ott a „Piszkozat: Kifizetés: IR-2026/0042” – kattintson rá, a piszkozat nyílik meg. Ctrl+Enter, majd Könyvelés → `BANK-2026-00001`.

**3. Rögzítési határidő (Szt. 165. § (3))**

1. **F2**, típus: *Pénztárkiadási bizonylat*, leírás: „Postaköltség”, kelt: `2026.01.12`. Sorok: `527` tartozik `1500`, `381` követel `=`.
2. Az űrlapon figyelmeztetés: „Rögzítési határidő lejárt: 2026.01.12.” (pénztári tételt a pénzmozgással egyidejűleg kell könyvelni). Mentse piszkozatként.
3. **Kezdőlap → Teendők**: piros „Rögzítési határidő: 1 lejárt” – a kattintás a piszkozatok listájára visz; a „Piszkozat: Postaköltség” elem a piszkozatra.

**4. Sztornó**

1. **Könyvelés** menü → kattintson a `SZSZ-2026-00001`-re → **Sztornózás**.
2. A megerősítő ablak leírja a következményt; a fókusz a „Mégse” gombon van, így Enterrel nem lehet véletlenül sztornózni. Ok nélkül hibaüzenetet kap; írja be: „Téves rögzítés”, majd Sztornózás.
3. Létrejön a `SZT-2026-00001`: ugyanazok a tételek fordított oldalon, hivatkozással az eredetire. Az eredeti bizonylaton „Sztornózva” látszik, a tételei változatlanok, és még egyszer nem sztornózható.
4. A listában az *Állapot: Sztornózott* szűrő mutatja az eredetit.

**5. Amit még érdemes megnézni**

- *Helyesbítő bizonylat*: a `BANK-2026-00001` oldalán „Helyesbítő bizonylat” – csak a különbözetet kell rögzíteni, az eredeti tételei felül látszanak.
- *Beállítások → Audit napló*: minden lépés (piszkozat, könyvelés, sztornó) benne van; a „Sértetlenség ellenőrzése” gomb ellenőrzi a hash-láncot.
- *Sötét mód* (fejléc ◐ gombja) és *mobil nézet* (keskeny ablak): a tételtábla a saját dobozában görgethető.
- A lezárt időszakba könyvelés tiltása az adatbázisban már működik (tesztek ellenőrzik); a havi zárás felülete a 6. lépésben jön.

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
