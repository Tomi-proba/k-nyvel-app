# Könyvel — számla- és bizonylatkezelés magyar KKV-knak

MVP webalkalmazás, amely automatizálja a számlák/bizonylatok begyűjtését,
rendszerezését és könyvelésre való előkészítését. Cél: egy KKV-tulajdonos
vagy könyvelőiroda gyorsan lássa, mi történt egy hónapban, kézi Excel-be
másolás nélkül.

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
- **OCR absztrakció** (`src/lib/ocr.ts`): `OcrProvider` interfész, jelenleg
  egy determinisztikus mock implementációval. Éles integrációhoz javasolt
  szolgáltatók (a fájlban részletesebben dokumentálva):
  - **Azure AI Document Intelligence** (Invoice modell) — jól kezeli az
    EU-s/magyar számlaformátumokat, egyedi modell is tanítható.
  - **Google Document AI** (Invoice Parser) — hasonló képességű alternatíva.
  - **Rossum / Mindee** — számla-OCR-re szakosodott SaaS-ok, gyors
    integrációval.
  A bizonytalan mezőket a mock (és majd az éles provider is) sosem tölti ki
  kitalált adattal — ezeket a rendszer `uncertainFields`-ként jelöli, a
  review-űrlap pedig sárga "ellenőrzésre vár" jelöléssel emeli ki.
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

## Amit az MVP tudatosan nem tartalmaz

A specifikáció szerint ezek később, éles indítás előtt/után kerülnek sorra:

- NAV API integráció (jogi/technikai egyeztetést igényel)
- Fizetési/előfizetési rendszer (Stripe/Barion)
- Többnyelvűség (jelenleg csak magyar UI)
- Email-továbbítással történő bizonylatbeküldés (jelenleg csak manuális
  feltöltés)
- Valós OCR szolgáltató bekötése (lásd fent a javasolt opciókat)

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
