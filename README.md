# Könyvel — számla- és bizonylatkezelés magyar KKV-knak

MVP webalkalmazás, amely automatizálja a számlák/bizonylatok begyűjtését,
rendszerezését és könyvelésre való előkészítését. Cél: egy KKV-tulajdonos
vagy könyvelőiroda gyorsan lássa, mi történt egy hónapban, kézi Excel-be
másolás nélkül.

## Gyors demó — GitHub Codespaces

Nincs szükség helyi telepítésre: a repóban lévő `.devcontainer` konfiguráció
egy kattintással elindítja az egész appot (Postgres, migráció, seed adatok,
dev szerver) egy felhős Codespace-ben.

1. Nyisd meg a repót GitHubon, válaszd ki a `claude/kkv-invoice-automation-mvp-obcgmx` branch-et
2. **Code → Codespaces → Create codespace on branch**
3. Várd meg, amíg lefut az automatikus setup (kb. 2-3 perc) — ekkor jön létre
   az adatbázis, fut le a migráció és a seed
4. Amint a dev szerver elindul, a Codespace felajánl egy előnézeti linket a
   3000-es porthoz ("Open in Browser") — ez a publikus demó URL, bárkivel
   megosztható, amíg a Codespace fut
5. Bejelentkezés a seed adatokkal (lásd lejjebb: `kovacs@example.com` / `jelszo1234`)

## Tech stack

- **Next.js 16 (App Router) + TypeScript** — frontend és backend egyben
  (Server Components, Server Actions, Route Handlerek)
- **PostgreSQL + Prisma ORM**
- **NextAuth (Auth.js) v5** — email + jelszó (credentials), JWT session
- **Tailwind CSS** — magyar nyelvű, mobilbarát felület
- **Vitest** — automata tesztek a kritikus logikára

## Architektúra röviden

- **Multi-tenant**: `User` ⟷ `Company` many-to-many a `Membership` táblán
  keresztül (`role`: OWNER / ACCOUNTANT / MEMBER). Egy könyvelőiroda usere
  több ügyfél-céghez tartozhat, és a fejlécben lévő cégváltóval vált közöttük
  (az aktív cég egy cookie-ban van eltárolva, mindig ellenőrizve a
  jogosultságot).
- **Storage absztrakció** (`src/lib/storage.ts`): `StorageDriver` interfész,
  helyi fájlrendszer implementációval (dev) és S3/Cloudflare R2-kompatibilis
  implementációval (éles), `STORAGE_DRIVER` env változóval váltva — a hívó
  kód nem változik.
- **OCR absztrakció** (`src/lib/ocr.ts`): `OcrProvider` interfész.
  Alapértelmezetten egy determinisztikus mock implementáció fut
  (`OCR_PROVIDER=mock`). **Google Document AI** (Invoice Parser) integráció
  már elő van készítve (`src/lib/ocr-providers/google-document-ai.ts`,
  `OCR_PROVIDER=google-document-ai`) — lásd lejjebb a bekapcsolás lépéseit.
  Alternatívák, ha inkább más szolgáltatót választanál (a fájlban
  részletesebben dokumentálva):
  - **Azure AI Document Intelligence** (Invoice modell) — jól kezeli az
    EU-s/magyar számlaformátumokat, egyedi modell is tanítható.
  - **Rossum / Mindee** — számla-OCR-re szakosodott SaaS-ok, gyors
    integrációval.
  A bizonytalan mezőket a mock és a Google Document AI provider is sosem
  tölti ki kitalált adattal — ezeket a rendszer `uncertainFields`-ként
  jelöli, a review-űrlap pedig sárga "ellenőrzésre vár" jelöléssel emeli ki.
- **Kategorizálás** (`src/lib/categorize.ts`): partner (adószám) alapján
  tanult alapértelmezett kategória, másodsorban kulcsszó-egyezés a kiállító
  nevében. Jóváhagyáskor vagy a Kategóriák oldalon a user felülbírálhatja —
  ez elmentődik a partneren, legközelebb automatikusan azt javasoljuk.
- **ÁFA-számítás és havi összesítés** (`src/lib/vat.ts`): tiszta,
  IO-mentes függvények, unit tesztekkel lefedve.

## Első indítás

### 1. Előfeltételek

- Node.js 20+
- Egy futó PostgreSQL adatbázis

### 2. Telepítés

```bash
npm install
cp .env.example .env
# szerkeszd a .env-et: DATABASE_URL, AUTH_SECRET (pl. `openssl rand -base64 32`)
```

### 3. Adatbázis

```bash
npx prisma migrate dev
npm run db:seed   # opcionális, de ajánlott: teszt cégek és mintaszámlák
```

A seed két fake céget és egy közös könyvelő-usert hoz létre (minden jelszó:
`jelszo1234`):

| Email                  | Szerepkör                              |
| ----------------------- | --------------------------------------- |
| `kovacs@example.com`    | Kávézó Sarok Kft. tulajdonosa            |
| `nagy@example.com`      | Dizájn Stúdió Bt. tulajdonosa            |
| `konyvelo@example.com`  | könyvelő, mindkét céget látja/válthatja  |

### 4. Fejlesztői szerver

```bash
npm run dev
```

Nyisd meg: <http://localhost:3000>

### 5. Tesztek

```bash
npm run test
```

### 6. Valódi OCR bekötése (Google Document AI) — opcionális

Alapértelmezetten `OCR_PROVIDER=mock` fut, valós fiók/kulcs nélkül. Ha
szeretnéd, hogy a rendszer ténylegesen kiolvassa a feltöltött számlák
adatait, a Google Document AI provider elő van készítve — ehhez saját
Google Cloud erőforrás kell:

1. **Google Cloud projekt** — hozz létre egyet (vagy használj meglévőt) a
   [Google Cloud Console](https://console.cloud.google.com/)-on, és
   engedélyezd rajta a **Document AI API**-t.
2. **Processzor létrehozása** — a Document AI konzolban hozz létre egy új
   **Invoice Parser** (számla-feldolgozó) processzort. Válassz régiót
   (`eu` vagy `us` — ez lesz a `GOOGLE_DOCUMENT_AI_LOCATION`), és jegyezd
   fel a processzor azonosítóját (`GOOGLE_DOCUMENT_AI_PROCESSOR_ID`).
3. **Service account** — hozz létre egy service accountot a projektben, add
   hozzá a **Document AI API User** (`roles/documentai.apiUser`) szerepkört,
   majd generálj hozzá egy JSON kulcsot (Keys → Add key → JSON).
4. **Env változók** beállítása a `.env` fájlban:
   ```bash
   OCR_PROVIDER="google-document-ai"
   GOOGLE_CLOUD_PROJECT_ID="a-te-projekt-azonosítód"
   GOOGLE_DOCUMENT_AI_LOCATION="eu"
   GOOGLE_DOCUMENT_AI_PROCESSOR_ID="a-processzor-azonosítója"
   # a letöltött service account JSON kulcsfájl TELJES tartalma, egy sorban:
   GOOGLE_APPLICATION_CREDENTIALS_JSON='{"type":"service_account","client_email":"...","private_key":"...",...}'
   ```
   (Ha üresen hagyod a `GOOGLE_APPLICATION_CREDENTIALS_JSON`-t, a kliens a
   szokásos Google Application Default Credentials láncot próbálja használni
   — pl. helyi `gcloud auth application-default login` után.)
5. Indítsd újra a szervert (`npm run dev`) — mostantól a feltöltött számlák
   valódi OCR-en mennek keresztül.

**Fontos korlátok, amiket érdemes tudni:**
- A `src/lib/ocr-providers/google-document-ai.ts`-ben szereplő entitástípus-
  nevek (`supplier_name`, `net_amount` stb.) a Google hivatalos Invoice
  Parser sémája szerintiek, de processzor-verziónként minimálisan
  eltérhetnek. Az első éles teszt után érdemes egy valós válasz `raw` mezőjét
  megnézni (minden nyers entitás elmentve marad audit célra), és szükség
  esetén bővíteni az `ENTITY_TYPE_MAP`-et.
- Nem volt hozzáférésem éles Google Cloud fiókhoz, ezért ez az integráció
  mockolt Document AI válaszokkal van tesztelve (`tests/google-document-ai.test.ts`),
  végponttól-végpontig valós fiókkal nincs kipróbálva.
- Az ÁFA kulcsot a Document AI nem mindig adja vissza külön mezőként — ha
  van nettó és ÁFA összeg, abból számolja a provider; ha bármelyik hiányzik
  vagy alacsony konfidenciájú, `vatRate` bizonytalanként jelölődik (sosem
  talál ki adatot).

## Fő funkciók

1. **Auth + cégprofil** — regisztráció (user + cég egy lépésben), email+jelszó
   bejelentkezés, cégváltó a fejlécben, "Cégek" oldal új ügyfél-cég
   felvételéhez (könyvelőirodáknak).
2. **Feltöltés** — drag-and-drop és mobil kamerás feltöltés (PDF/JPG/PNG,
   max. 15 MB), bevétel/kiadás választóval.
3. **OCR (mock)** — feltöltés után automatikusan "kinyeri" a kiállító nevét,
   adószámát, dátumokat, nettó/ÁFA/bruttó összeget; bizonytalan mezőket
   ellenőrzésre jelöl, sosem talál ki adatot.
4. **Dashboard** — havi bontású bevétel/kiadás/ÁFA összesítő,
   kategóriánkénti bontás, "ellenőrzésre vár" jelzés.
5. **Szűrés és export** — dátum/irány/kategória/partner szerinti szűrés,
   Excel (.xlsx) és CSV export könyvelőbarát oszlopszerkezettel (a CSV magyar
   Excel-lokalizációhoz igazítva: pontosvessző-elválasztó, tizedesvessző).
6. **Tervezet pénzügyi kimutatás** (`/tervezet`) — a jóváhagyott bizonylatok
   nettó összegeiből számolt tervezet-eredménykimutatás, hónap/negyedév/év
   szerint szűrve, PDF (átlós "TERVEZET – NEM HIVATALOS" vízjellel) és Excel
   exporttal. **Nem alapértelmezett nézet** — tudatosan külön menüpont, és
   minden képernyőn/exportban jól látható, nem eltüntethető jogi
   figyelmeztetést visel: ez egy becslés, nem hivatalos könyvelés, NAV-beadásra
   nem alkalmas, könyvelőt nem helyettesít. A mérleg-vázlat egyelőre nincs
   implementálva — ehhez a jelenlegi adatmodell (nincs eszköz-/kötelezettség-
   kategória, bankegyenleg, kintlévőség-nyilvántartás) nem elég strukturált;
   a felület ezt őszintén jelzi, nem imitál hamis adatot.

## Alapértelmezett nézetek és navigáció

A "Számlák" (nyers bizonylatlista, összesítés nélkül) az alapértelmezett
nézet bejelentkezés után. A "Összesítők" a korábbi havi dashboard. A
"Tervezet kimutatás" egy tudatosan külön, nem alapértelmezett menüpont —
lásd fent.

## Amit az MVP tudatosan nem tartalmaz

A specifikáció szerint ezek később, éles indítás előtt/után kerülnek sorra:

- NAV API integráció (jogi/technikai egyeztetést igényel)
- Fizetési/előfizetési rendszer (Stripe/Barion)
- Többnyelvűség (jelenleg csak magyar UI)
- Email-továbbítással történő bizonylatbeküldés (jelenleg csak manuális
  feltöltés)
- Valós OCR szolgáltató bekötése (lásd fent a javasolt opciókat)
- NAV-beadásra kész bevallási nyomtatvány vagy automatikus főkönyvi
  könyvelés — a "Tervezet pénzügyi kimutatás" szándékosan és véglegesen
  csak becslés, sosem fog ilyet generálni (lásd a jogi figyelmeztetést)
- Mérleg-becslés — a jelenlegi adatmodell nem tárol eszköz-/kötelezettség-
  kategóriákat, bankegyenleget vagy kintlévőség-nyilvántartást

## Ismert korlátok

- Az `xlsx` (SheetJS) npm csomagnak vannak nyilvántartott biztonsági
  hiányosságai (prototype pollution, ReDoS) *idegen fájlok beolvasásakor*.
  Az alkalmazás az `xlsx`-et kizárólag **exportra** (saját, ellenőrzött
  adatból generált fájl írására) használja, nem fogad el/olvas be
  felhasználó által feltöltött `.xlsx` fájlt, így ez a kockázat jelentősen
  korlátozott — de éles bevezetés előtt érdemes megfontolni az `exceljs`-re
  váltást.
- Az OCR mock szinkron módon fut a feltöltési kérésen belül. Valós, lassabb
  OCR szolgáltatóra váltáskor javasolt háttérfeladatba (job queue)
  kiszervezni.
