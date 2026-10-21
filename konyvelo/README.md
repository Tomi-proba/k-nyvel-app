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
| 4. Analitika, bank, pénztár | nyitott tételek, kiegyenlítés (rögzítéskor vagy utólag), korosítás, főkönyv–analitika egyeztetés, bank- és pénztárnapló, negatív pénztár tiltása, pénztármaximum | ✅ kész |
| 5. Kimutatások | főkönyvi kivonat, naplófőkönyv, karton, mérleg („A”), eredménykimutatás (összköltség), előző év, Ft / ezer Ft, CSV, nyomtatás/PDF | ✅ kész |
| 6. Zárás | havi időszakzárás és feloldás, zárlati állapot, évzárás előnézettel, nyitás, év újranyitása, nyitó egyenlegek átvétele; Excel (.xlsx) export | ✅ kész |
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

## Kipróbálás a böngészőben, telepítés nélkül (GitHub Codespaces)

1. Jelentkezzen be a GitHubra, majd nyissa meg ezt a linket:
   **https://codespaces.new/tomi-proba/k-nyvel-app/tree/claude/adoring-gates-qkf0a7?devcontainer_path=.devcontainer%2Fkonyvelo%2Fdevcontainer.json**
   A megjelenő oldalon ellenőrizze: *Branch*: `claude/adoring-gates-qkf0a7`, *Dev container configuration*: **Könyvelő (konyvelo/)** – majd **Create codespace**.
   (Ha a link nem működik: a repó oldalán zöld **Code** gomb → **Codespaces** fül → **…** → **New with options…**, és ott válassza ki a fenti ágat és konfigurációt.)
2. Az első indítás 3–5 perc: a böngészőben megnyíló fejlesztőkörnyezet telepíti a csomagokat, létrehozza az adatbázist, majd a háttérben elindítja a programot (napló: `tail -f /tmp/konyvelo-dev.log`).
3. Alul a **Ports** fülön a **5173 – Könyvelő** sorban kattintson a földgömb ikonra. Ha **502**-es hibát kap: a sorban jobb klikk → **Stop Forwarding Port**, majd **Forward a Port** → `5173` → földgömb.
4. Onnantól a fenti **Kipróbálható forgatókönyv** szerint haladhat (Első indítás → cég → üzleti év …).

Jó tudni:
- A program címe privát: csak Ön éri el a saját GitHub-fiókjával.
- Az adatok a Codespace-ben megmaradnak, amíg a Codespace-t nem törli. Leállítani nem kell: 30 perc tétlenség után magától leáll, újra megnyitva (github.com/codespaces) folytatható, a program ilyenkor is magától elindul. Ha a nyitva hagyott lapon „A szerver most nem érhető el” üzenet jelenik meg, várjon egy kicsit, és frissítse az oldalt. A terminálba nem kell parancsot írni.
- A személyes GitHub-fiókoknak havi ingyenes Codespaces-kerete van; ha végzett a próbával, a github.com/codespaces oldalon törölheti a Codespace-t.
- Ez próbakörnyezet, valódi cégadatokat ne vigyen fel.

## Telepítés (fejlesztői gép)

> **Windowson, kezdőknek:** lépésről lépésre: [docs/TELEPITES-WINDOWS.md](docs/TELEPITES-WINDOWS.md)

Előfeltételek: **Node.js 22 vagy újabb (LTS)**, **npm 11** (az npm 10-ben ismert hiba miatt), **PostgreSQL 16**.

```bash
cd konyvelo
npx npm@11 install               # vagy: npm install, ha már npm 11 van telepítve
npm run db:setup                  # .env, adatbázis-felhasználók és adatbázisok (a postgres jelszavát kéri)
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

**5. Nyitott tételek és kiegyenlítés (4. lépés)**

1. Rögzítsen egy új szállítói számlát az Irodaszernek (pl. 50 800 Ft, Alt+L sablonnal).
2. **Partnerek → Irodaszer Kft.**: a *Nyitott tételek* között ott az új számla; a *Párosítatlan fizetések* között a `BANK-2026-00001` (mert a hozzá tartozó számlát sztornózta). **Párosítás** → a számla kiegyenlítve.
3. Új számla (pl. 25 400 Ft), majd **F2**, *Banki bizonylat*, partner: Irodaszer. Megjelenik a *Kiegyenlítendő tételek* lista: pipálja be a számlát – a tételsorok (454 T / bank K) maguktól kitöltődnek. Könyvelés után a bizonylaton: „Kiegyenlíti: SZSZ-…”.
4. **Partnerek → Nyitott tételek**: korosítás (nem lejárt, 1–30, 31–60… nap); **Egyeztetés**: a 454 és 311 főkönyvi egyenlege egyezik az analitikával.
5. **Könyvelés → Bank és pénztár**: futó egyenleg; írja be a kivonat záró egyenlegét, és a rendszer jelzi, egyezik-e. Pénztárnál negatív egyenleget nem enged; a Cégadatoknál megadható a napi pénztár-záróegyenleg maximuma.

**6. Kimutatások (5. lépés)**

1. **Kimutatások → Főkönyvi kivonat**: számlánként nyitó egyenleg, időszaki és halmozott forgalom, záró egyenleg, számlaosztályonként részösszeggel. Alul zöld ellenőrzés: minden oszlopban Σ tartozik = Σ követel. A számlaszámra kattintva a számla kartonja nyílik meg.
2. **Naplófőkönyv**: az összes könyvelt tétel időrendben; a bizonylatszám kattintható.
3. **Karton**: válassza a `454`-et – a szállítói számlák és kifizetések futó egyenleggel. Partnert is választhat (pl. Irodaszer Kft.), akkor csak az ő tételei látszanak.
4. **Mérleg**: a fejlécben „Belső kimutatás – nem minősül közzétett beszámolónak”, alul „A kimutatás a könyvelt tételek alapján készült.” és aláírási hely. Ellenőrzés: eszközök összesen = források összesen. A tárgyévi eredmény a D.VII Adózott eredmény soron. Próbálja ki: *Pénzegység: ezer Ft*, *Részletes sorok*.
5. Pipálja be a **Közzétételi példány**-t: a belső felirat eltűnik, és – mivel a Cégadatoknál nincs bejelölve a könyvvizsgálat – megjelenik: „A közzétett adatok könyvvizsgálattal nincsenek alátámasztva.” (Szt. 154. § (3)). Ha a Cégadatoknál bejelöli „A beszámolót könyvvizsgáló ellenőrzi”, ez a szöveg elmarad.
6. **Eredménykimutatás**: összköltség-eljárással, I–X sorok és A–D eredmények; az előző év oszlopa az egy évvel korábbi időszak.
7. Bármelyik kimutatásnál: **Letöltés (CSV, Excel)** – Excelben dupla kattintással megnyílik; **Nyomtatás / PDF** – a böngésző nyomtatási ablakában „Mentés PDF-ként”. Nyomtatásban csak maga a kimutatás látszik.

**7. Zárás (6. lépés)**

1. **Zárás → Időszakok és évzárás**: a *Havi időszakok* táblában a januárnál nyomja meg a **Lezárás**-t: mivel januárban piszkozat van (Postaköltség), a rendszer nem engedi, és megmondja, miért. Zárja le a februárt: sikerül.
2. Próbáljon a **Könyvelés**-ben februári dátumra könyvelni: „A(z) 2026. február lezárt időszak, ide nem lehet könyvelni…”.
3. **Feloldás** (csak Adminisztrátor): indoklás nélkül nem megy; írjon be egy okot. A feloldás az audit naplóba kerül.
4. **Évzárás** (érdemes külön próbacégen): hozza létre a *következő* üzleti évet (Beállítások → Üzleti évek). A Zárás oldalon az ellenőrzőlista mutatja, mi hiányzik még (piszkozatok, egyeztetés, zárási számlák, következő év).
5. **1. Zárlat indítása**: ezután csak a fordulónapra (12.31.) lehet könyvelni – próbálja ki egy 12.30-i bizonylattal (hibaüzenet), majd egy 12.31-i zárlati tétellel (sikerül).
6. **2. Előnézet**: a záró tételek (eredményszámlák → 493 → 419) és az adózott eredmény. **3.** Írja be a cég rövid nevét, majd **Évzárás véglegesítése**: létrejön a `ZAR-…` záró és a `NYIT-…` nyitó bizonylat (az eredmény a 413 Eredménytartalékba kerül).
7. **Kimutatások → Mérleg**: a lezárt év fordulónapjára az eredmény a D.VII soron; a következő évre a D.IV Eredménytartalékban, az előző év oszlopában a tavalyi adatokkal.
8. **Év újranyitása** (Adminisztrátor, indoklással): a záró és a nyitó bizonylat sztornózva, az év újra könyvelhető.
9. Bármelyik kimutatásnál **Excel (.xlsx)**: formázott táblázat cégfejléccel, ezres tagolással, kiemelt összesítő sorokkal, nyomtatásra beállítva.

**8. Amit még érdemes megnézni**

- *Helyesbítő bizonylat*: a `BANK-2026-00001` oldalán „Helyesbítő bizonylat” – csak a különbözetet kell rögzíteni, az eredeti tételei felül látszanak.
- *Beállítások → Audit napló*: minden lépés (piszkozat, könyvelés, sztornó) benne van; a „Sértetlenség ellenőrzése” gomb ellenőrzi a hash-láncot.
- *Sötét mód* (fejléc ◐ gombja) és *mobil nézet* (keskeny ablak): a tételtábla a saját dobozában görgethető.
- A lezárt időszakba könyvelés tiltása az adatbázisban már működik (tesztek ellenőrzik); a havi zárás felülete a 6. lépésben jön.

## Meglévő cég indítása évközben (nyitó egyenlegek)

Példa: a cég eddig másik programban könyvelt, 2026. október 1-jétől ebben a programban folytatja. Kb. 20 perc.

1. **Cég és üzleti év**: vegye fel a céget, és az üzleti évet a **teljes évre** (2026.01.01.–2026.12.31.) – az eredménykimutatás az év elejétől számol.
2. **Számlatükör** (Beállítások → Számlatükör): nézze meg, hogy a régi programban használt számlák megvannak-e. Ha ott alszámlák voltak (pl. `3841` OTP, `3842` K&H), hozza létre őket itt is; gyűjtőszámlára (pl. `384`, ha van alszámlája) nem lehet nyitó egyenleget adni.
3. **Partnerek**: vegye fel azokat a vevőket és szállítókat, akiknek nyitott számlájuk van. A beillesztéskor a rendszer név vagy adószám alapján találja meg őket.
4. Kérje le a régi programból a **2026.09.30-i főkönyvi kivonatot** (számlánként a záró egyenleg), és a **nyitott vevő- és szállítótételek** listáját.
5. **Zárás → Nyitó egyenlegek**:
   - *Az átvétel napja*: `2026.09.30.`
   - *Főkönyvi kivonat*: jelölje ki Excelben a számlaszám, megnevezés, tartozik, követel oszlopokat, másolja (Ctrl+C), és illessze be (Ctrl+V). A mérlegszámlák mellett az **eredményszámlák (5., 8., 9. osztály) január–szeptemberi halmozott egyenlegét** is adja meg, különben az éves eredménykimutatás hiányos lesz. Például:
     ```
     384	Elszámolási betétszámla	1 000 000
     311	Belföldi vevők	254 000
     454	Szállítók		127 000
     411	Jegyzett tőke		3 000 000
     413	Eredménytartalék	2 000 000
     912	Árbevétel – szolgáltatás		200 000
     522	Bérleti díjak	73 000
     ```
   - *Nyitott vevőtételek* és *Nyitott szállítói tételek*: soronként `partner; számlaszám; esedékesség; összeg`, pl. `Vevő Zrt.;V-9;2026.10.10;254 000`.
   - A táblázatok soronként jelzik a hibát (ismeretlen számla vagy partner, gyűjtőszámla), alul az összesen: **tartozik = követel**, és a nyitott tételek összege = a 311/454 egyenlege. Ha minden zöld: **Nyitó egyenlegek könyvelése**.
6. **Ellenőrzés**: *Kimutatások → Főkönyvi kivonat* 2026.01.01.–2026.09.30. – a záró oszlop egyezzen a régi program kivonatával (a 491 Nyitómérleg-számla egyenlege 0). *Partnerek → Nyitott tételek*: a beillesztett számlák nyitottként látszanak; *Egyeztetés*: minden „Egyezik”.
7. **Zárja le a január–szeptember időszakokat** (Zárás), hogy oda tévedésből ne lehessen könyvelni.
8. **Október könyvelése**: szállítói és vevőszámlák (Alt+L sablonnal), banki kifizetések és jóváírások – a nyitott tételek kiválasztásával kiegyenlítve –, pénztár.
9. **Hónap végén**: *Bank és pénztár* → bankkivonat záró egyenlegének egyeztetése; *Főkönyvi kivonat* októberre; *Egyeztetés*; végül az október lezárása.

Ha egy nyitó tétel hibás, a nyitó bizonylat (NYIT-…) sztornózható, és a helyes adat újra rögzíthető.

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
