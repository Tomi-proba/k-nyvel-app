# Terv – architektúra, technológiák, adatmodell

> Állapot: **TERVEZET, jóváhagyásra vár** · 2026.10.20.
> Alapja: [`REQUIREMENTS.md`](./REQUIREMENTS.md). A hivatkozott pontokat (pl. „K 5.4”) onnan veszem.

## 1. Alapdöntések röviden

| Kérdés | Javaslat | Miért |
|---|---|---|
| Felépítés | **Moduláris monolit**: egy alkalmazás, belül szigorúan elválasztott modulokkal | Egy könyvelőirodának egyszerű üzemeltetni, mégis könnyen bővíthető új modullal |
| Nyelv | **TypeScript** a szerveren és a böngészőben is | Közös típusok és validáció a két oldalon |
| Szerver | **Node.js 22 + Fastify** | Gyors, egyszerű, jó séma-alapú validáció |
| Adatbázis | **PostgreSQL 16** | Tranzakciók, triggerek (könyvelt tétel módosíthatatlansága, egyensúly), megbízható mentés |
| Adatelérés | **Drizzle ORM** + kézzel írt SQL-migrációk | Átlátható SQL, triggereket és megkötéseket közvetlenül írhatunk |
| Felület | **React + Vite** egyoldalas alkalmazás, **React Router**, **TanStack Query** | Gyors, billentyűzetbarát rögzítőfelület |
| Komponensek | **Radix UI** (akadálymentes alapelemek) + saját CSS-változós téma | WCAG 2.1 AA, világos és sötét mód |
| Validáció | **Zod** sémák, közösen a szerver és a felület között | Ugyanaz a hibaüzenet azonnal az űrlapon és a szerveren is |
| Exportok | **ExcelJS** (xlsx), saját CSV (UTF-8 BOM, `;` elválasztó), **pdfmake** (PDF, magyar ékezetes betűkészlettel) | Tiszta JavaScript, nem kell külső program |
| Tesztek | **Vitest** (egység és adatbázis-integráció valódi PostgreSQL-lel), **Playwright** + **axe-core** (végponttól végpontig és akadálymentesség) | A könyvelési szabályokat valódi adatbázison is teszteljük |
| Futtatás | **Docker Compose** (alkalmazás + PostgreSQL); fejlesztéshez helyi PostgreSQL | Egy paranccsal indítható |

A régi kód (Next.js, Prisma stb.) érintetlen marad, az új projekt teljesen önálló a `konyvelo/` könyvtárban.

## 2. Projektszerkezet

```
konyvelo/
  docs/                 REQUIREMENTS.md, PLAN.md, később felhasználói súgó
  packages/
    domain/             tiszta könyvelési logika (nincs adatbázis, nincs HTTP) – a tesztek fő terepe
                        pénzösszegek, egyensúly, zárási tételek, kimutatás-számítás, magyar formátumok
    shared/             Zod sémák, API-típusok, hibakódok és magyar hibaüzenetek
    nav-client/         NAV Online Számla v3 kliens (aláírás, XML, lassítás) – külön cserélhető
  apps/
    api/
      src/core/         adatbázis, hitelesítés, jogosultság, audit napló, modul-regiszter
      src/modules/      company, accounts, partners, documents, ledger, subledger,
                        bank-cash, nav-import, closing, reports, export-backup, users
      migrations/       SQL migrációk (táblák, triggerek, megkötések)
      test/             adatbázis-integrációs tesztek
    web/
      src/app/          elrendezés, főmenü, gyorsbillentyűk, téma
      src/features/     a szerver moduljainak megfelelő felületi részek
      src/ui/           közös komponensek (összegmező, dátummező, számlakereső, táblázat)
  e2e/                  Playwright tesztek
  docker-compose.yml
```

**Modulszerkezet (szerveren):** minden modul egy könyvtár `routes.ts` (HTTP), `service.ts` (üzleti szabályok, tranzakciók), `repo.ts` (adatbázis) és `index.ts` (regisztráció) fájlokkal. A modul a regiszterben bejelenti az útvonalait, jogosultságait, menüpontjait és a zárás előtti ellenőrzéseit („zárási hook”). Új modul (pl. később tárgyieszköz-nyilvántartás, bérszámfejtés-import, hiteles archívum, devizás könyvelés) így a meglévő kód módosítása nélkül illeszthető be. Modulok egymás táblájába nem írnak, csak egymás szolgáltatásain keresztül.

## 3. Rétegek és a könyvelési szabályok helye

```
Felület (React) ──HTTP/JSON──► API útvonal ──► Szolgáltatás ──► domain (tiszta függvények)
                                                   │
                                                   └──► Repo ──► PostgreSQL (megkötések + triggerek)
```

A legfontosabb szabályok **két helyen** is érvényesülnek: a `domain` csomagban (gyors, tesztelhető, a felületen azonnali hibaüzenetet ad), és az **adatbázisban** (utolsó védvonal, akkor is, ha valaki megkerülné az alkalmazást):

| Szabály | Domain | Adatbázis |
|---|---|---|
| Σ tartozik = Σ követel (K 1.6) | igen, eltérés kiírásával | halasztott (DEFERRABLE) trigger könyveléskor |
| Könyvelt tétel nem módosítható/törölhető (K 3.4) | igen | trigger: `POSTED` bizonylat sorára UPDATE/DELETE tiltva |
| Lezárt időszakba nem lehet könyvelni (K 5.3) | igen | trigger: könyvelési dátum lezárt időszakban → hiba |
| Hézagmentes bizonylatsorszám (K 3.5) | – | sorszámtábla soronkénti zárolással, ugyanabban a tranzakcióban |
| Audit napló csak hozzáfűzhető (K 8.1) | – | az alkalmazás adatbázis-felhasználója csak INSERT-et kap; trigger tiltja a módosítást |
| Megőrzési időn belül nincs fizikai törlés (K 7.6) | igen | trigger: `retention_until` előtt DELETE tiltva |

**Pénzösszegek:** egész számként, **fillérben** (`bigint`) tároljuk, lebegőpontos számot sehol nem használunk. A felület Ft-ban, szóközzel tagolva mutatja (`12 500 Ft`; fillért csak akkor, ha van). A kimutatások ezer Ft-os nézetet is adnak (K 1.8, K 6.3).

## 4. Adatmodell

Jelölés: PK = elsődleges kulcs, FK = idegen kulcs. Minden táblában van `created_at`, `created_by`; a cégspecifikus táblákban `company_id`.

### 4.1 Felhasználók, jogosultság, napló

- **users**: id, email (egyedi), name, password_hash (Argon2id), is_active, last_login_at
- **company_memberships**: user_id, company_id, role
  - Szerepkörök: **Adminisztrátor** (mindent), **Vezető könyvelő** (könyvel + időszakot zár, zárást kér feloldani), **Könyvelő** (rögzít, könyvel), **Megtekintő** (csak olvas). A zárás feloldása csak Adminisztrátornak, indoklással (K 5.3, K 8.2).
- **audit_log**: id (bigserial), company_id, user_id, at, action, entity_type, entity_id, before (jsonb), after (jsonb), ip, prev_hash, hash. A `hash` az előző sor hash-éből és a sor tartalmából számolódik (hash-lánc), így utólagos módosítás kimutatható (K 8.1). Ellenőrző végpont: „napló sértetlenségének ellenőrzése”.
- **auth_events**: sikeres és sikertelen belépések, kilépések (K 8.3).

### 4.2 Cég, üzleti év, időszak

- **companies**: name, short_name, tax_number (8-1-2), community_vat_number, registration_number (cégjegyzékszám), address, representative_name (aláíráshoz, K 6.4), book_currency (`HUF`, rögzített, K 1.8), balance_sheet_variant (`A`), income_statement_method (`TOTAL_COST`), report_type (`SIMPLIFIED_ANNUAL` | `MICRO`), significant_error_threshold (a számviteli politika szerinti határ, K 5.4), fx_rate_source (`MNB` | `ECB` | `BANK` | `VAT_ACT`, K 1.9)
- **fiscal_years**: start_date, end_date, status `OPEN` → `CLOSING` (fordulónap után, csak zárlati tétel) → `CLOSED`; closed_at, closed_by, retention_until (a zárás évét követő 8. év vége, K 7.6). Megkötés: az évek nem fedhetik egymást, és folytonosak.
- **periods**: fiscal_year_id, start_date, end_date (havi), status `OPEN` | `CLOSED`. Minden zárás és feloldás bekerül az audit naplóba, indoklással.

### 4.3 Számlatükör

- **accounts**: number (pl. `3811`), name, class (0–9, a számból), parent_id, is_postable (csak a legalsó szinten lehet könyvelni), nature (`ASSET` | `EQUITY_LIABILITY` | `EXPENSE` | `REVENUE` | `OFF_BALANCE` | `COST_CENTER`), subledger (`NONE` | `CUSTOMER` | `SUPPLIER` | `BANK` | `CASH`), balance_sheet_line, income_statement_line, description (súgószöveg: „mit könyvelünk ide”), is_active. Egyedi: (company_id, number).
- **report_lines**: a mérleg „A” változatának és az összköltséges eredménykimutatásnak a sorai (kód, megnevezés, szülő sor, sorrend, előjel). Ezeket a hiányzó 1. és 2. melléklet bemásolása után véglegesítem; addig a szerkezetet a 96. § szerinti nagybetűs és római számos szinten készítem elő.
- **Alapértelmezett számlatükör**: induló csomag (seed) az egységes számlakeret 0–9. osztálya szerint, kb. 250 számlával, előre beállított analitikával (pl. 311 Vevők → `CUSTOMER`, 454 Szállítók → `SUPPLIER`, 384 Bank → `BANK`, 381 Pénztár → `CASH`, 466/467/468 áfa) és sor-hozzárendeléssel. Cégenként másolatként jön létre, utána szabadon testreszabható; könyvelt számla nem törölhető, csak inaktiválható.
- A zárási számlák (491 Nyitómérleg, 492 Zárómérleg, 493 Adózott eredmény elszámolása, 419 Mérleg szerinti eredmény, 413 Eredménytartalék) cégszinten beállíthatók. Ez szakmai gyakorlat, nem jogszabályi előírás (❓), ezért nem építem be fixen.

### 4.4 Partnerek

- **partners**: kind (`CUSTOMER` | `SUPPLIER` | `BOTH`), name, tax_number, community_vat_number, country, address, bank_account, email, is_private_person, default_receivable_account, default_payable_account, default_expense_account, default_revenue_account, payment_terms_days, default_template_id, status (`ACTIVE` | `INACTIVE` | `ANONYMIZED`), anonymized_at (K 9.2, K 9.3). Adószám alapján a NAV `/queryTaxpayer` kitöltheti a nevét és címét.

### 4.5 Bizonylatok és könyvelési tételek (a rendszer magja)

- **document_types**: code (pl. `VSZ` vevőszámla, `SZSZ` szállítói számla, `BANK`, `PB` pénztár-bevétel, `PK` pénztár-kiadás, `VEGY` vegyes, `NYIT` nyitás, `ZAR` zárás, `HELY` helyesbítő), name, prefix.
- **document_sequences**: (document_type_id, fiscal_year_id) → next_number; soronként zárolva, így hézagmentes (K 3.5).
- **documents** (bizonylat, K 3.3):
  - azonosítás: serial_number (rendszer adja, pl. `BANK-2026-00012`), external_number (pl. a szállítói számla száma), document_type_id, fiscal_year_id
  - tartalom: description (a gazdasági művelet tartalma), issuer_name, partner_id, issue_date (kelt), fulfillment_date (teljesítés), due_date, accounting_date (könyvelés dátuma)
  - **deviza (döntés 2.)**: currency, fx_amount, fx_rate, fx_rate_source, fx_rate_date. A könyvelés mindig HUF-ban történik; ezek a mezők a későbbi devizás könyvvezetést készítik elő.
  - jóváhagyás: approved_by (utalványozó), checked_by (ellenőrző), posted_by, posted_at
  - állapot: `DRAFT` (szabadon szerkeszthető) → `POSTED` (végleges, módosíthatatlan) → `REVERSED` (sztornózva)
  - kapcsolatok: reverses_document_id (sztornó), corrects_document_id (helyesbítő)
  - előző évet érintő hiba (K 5.4): affects_fiscal_year_id, error_kind (`SIGNIFICANT` | `NOT_SIGNIFICANT`, a rendszer számolja)
  - eredet: source (`MANUAL` | `TEMPLATE` | `NAV_IMPORT` | `BANK` | `CASH` | `OPENING` | `CLOSING`), nav_invoice_id
  - **archiválásra felkészítés (döntés 3.)**: content_hash (SHA-256 a könyveléskori teljes tartalomról), chain_prev_hash (cégenkénti hash-lánc), retention_until, archive_status (`NONE` | `PACKAGED` | `ARCHIVED`), authenticity_method (`NONE` | `QUALIFIED_E_SIGNATURE` | `TIMESTAMP` | `AUTHENTIC_COPY`), authenticity_ref
- **journal_lines** (kontírozás): document_id, line_no, account_id, side (`D` tartozik | `C` követel), amount_huf (fillér, > 0), fx_amount (opcionális), partner_id, open_item_id, description, due_date. A napló a tételek könyvelési dátum és sorszám szerinti sorrendje, a főkönyv számlánkénti csoportosítása – mindkettő lekérdezés, nem külön adat (K 4.1).
- **attachments**: document_id, file_name, mime_type, size, sha256, storage_key, és archiváláshoz is_authentic_copy, authenticity_ref, retention_until. A fájlok lemezen vagy S3-kompatibilis tárolóban vannak, nem az adatbázisban. MVP-ben a csatolmány nem minősül hiteles másolatnak (K 3.6).
- **posting_templates** (gyakori kontírozások): name, shortcut (pl. `ANY` anyagbeszerzés), partner_id (opcionális), lines (jsonb: számla, oldal, összegképlet `NET` | `VAT` | `GROSS` | arány). A rögzítéskor beírt bruttó összegből és áfakulcsból a sablon kitölti a sorokat (pl. 5xx tartozik nettó, 466 tartozik áfa, 454 követel bruttó). Ez csak kontírozási segítség, áfa-analitika nincs.

### 4.6 Analitika: vevők, szállítók, nyitott tételek

- **open_items**: partner_id, kind (`RECEIVABLE` | `PAYABLE`), origin_line_id (a 311/454 soron keletkezik), document_id, invoice_number, due_date, original_amount, currency, fx_amount, status (`OPEN` | `PARTIAL` | `SETTLED` | `WRITTEN_OFF`).
- **settlements**: open_item_id, settling_line_id (banki, pénztári, beszámítási vagy leírási tétel sora), amount, settled_at. A nyitott egyenleg = eredeti összeg − kiegyenlítések; mindig számolt érték, nincs külön tárolva (K 4.4).
- Egyeztetés: analitika összesen = főkönyvi egyenleg (311, 454 stb.) bármely napra; évzáráskor kötelező ellenőrzés (K 4.2).
- Kimutatások: nyitott tételek listája, korosítás (lejárt 0–30, 31–60, 61–90, 90+ nap), partnerkarton, egyenlegközlő levél (PDF).

### 4.7 Bank és pénztár

- **bank_accounts**: account_id (384x), bank_name, account_number/IBAN, currency.
- **bank_statements**: bank_account_id, statement_number, statement_date, opening_balance, closing_balance, document_id. A kivonat maga a bizonylat; a nyitó egyenlegnek egyeznie kell az előző kivonat záró egyenlegével, a záró egyenlegnek pedig a sorok összegével.
- **cash_registers**: account_id (381x), name, daily_close_limit (a pénzkezelési szabályzatból, K 1.10). Pénztárbizonylat (`PB`, `PK`) pénztáranként külön, hézagmentes sorszámmal. Negatív pénztáregyenleg nem engedett; limit-túllépésnél figyelmeztetés. Pénztárjelentés napra/időszakra.
- Bank- és pénztársor rögzítésekor a partner nyitott tételei felajánlódnak kiegyenlítésre (egy kattintás vagy Enter).
- Banki kivonat fájlimport (pl. CSV) későbbi modul; a táblaszerkezet felkészül rá.

### 4.8 NAV Online Számla import

- **nav_credentials**: company_id, environment (`TEST` | `PROD`), login, password, sign_key, exchange_key – **titkosítva** (AES-256-GCM, a kulcs környezeti változóban, nem az adatbázisban) (K 9.4).
- **nav_import_runs**: direction (`INBOUND` | `OUTBOUND`), date_from, date_to (≤ 35 nap; hosszabb időszakot a rendszer felbont, K 10.4), status, counts, error_message, started_by.
- **nav_invoices**: direction, invoice_number, operation (`CREATE` | `MODIFY` | `STORNO`), modification_index, original_invoice_number, supplier_tax_number, supplier_name, customer_tax_number, customer_name, issue_date, delivery_date, payment_due_date, payment_method, currency, net_amount, vat_amount, net_amount_huf, vat_amount_huf, completeness_indicator, raw_digest (jsonb), raw_invoice_xml (tömörítve), status (`NEW` | `PROPOSED` | `POSTED` | `IGNORED`), document_id. Egyedi: (company_id, direction, supplier_tax_number, invoice_number, modification_index) – duplikáció kizárva (K 10.8).
- Folyamat: lekérés (lassítva, 1 kérés/másodperc, K 10.5) → partner párosítása vagy felajánlása létrehozásra → kontírozási javaslat a partner alapértelmezései vagy sablon alapján → **a felhasználó jóváhagyja** → könyvelt bizonylat (K 10.7). Módosító és sztornó számla az eredetihez kapcsolt helyesbítő vagy sztornó bizonylatot javasol.
- A `nav-client` csomag tesztelhető hamis (mock) NAV-szerverrel; éles hívás csak a felhasználó saját technikai felhasználójával.

### 4.9 Zárás

- **Havi időszakzárás**: ellenőrzések futnak (piszkozatban maradt bizonylatok, kiegyenlítetlen bank–főkönyv eltérés, negatív pénztár), majd megerősítés után lezárás. Lezárt időszakba könyvelni nem lehet; javítás a nyitott időszakban felvitt helyesbítő bizonylattal (K 5.3).
- **Évzárás** (K 5.2, K 5.5):
  1. Fordulónap után: év → `CLOSING`. Csak a fordulónapra datált zárlati bizonylat rögzíthető (pl. elhatárolás, értékvesztés, társasági adó).
  2. Évzárási ellenőrzések: analitika–főkönyv egyeztetés (K 4.2), minden bizonylat könyvelve, mérleg egyezik.
  3. **Előnézet**: a rendszer kiszámolja és megmutatja a zárótételeket (eredményszámlák zárása, adózott eredmény, zárómérleg) – mentés előtt átnézhető.
  4. Megerősítés (a cég rövid nevét be kell gépelni) → zárótételek könyvelése → év `CLOSED`, megőrzési határidő beállítva.
  5. Következő év nyitótételei automatikusan, a záró egyenlegekből; az előző év eredménye az eredménytartalékba kerül.
- **Zárás feloldása**: csak Adminisztrátor, kötelező indoklással; audit naplóba kerül, a már zárt évre vonatkozó minden változás látszik.

### 4.10 Kimutatások

Mind lekérdezés a könyvelt tételekből; bármely időszakra, képernyőn, CSV-ben, Excelben és PDF-ben:

- **Naplófőkönyv**: időrendben minden tétel, számlánkénti tartozik/követel oszlopokkal, oldalankénti és göngyölített összesítéssel.
- **Főkönyvi kivonat**: számlánként nyitó egyenleg, időszaki és halmozott tartozik/követel forgalom, záró egyenleg; számlaosztályonkénti és végösszeggel (Σ T = Σ K ellenőrzés).
- **Karton**: egy számla vagy partner tételei, futó egyenleggel.
- **Egyszerűsített mérleg („A” változat)** és **összköltséges eredménykimutatás**: tárgyév és előző év oszlop, valamint jelentős hiba esetén külön oszlop (K 5.4, K 6.3), Ft-ban és ezer Ft-ban; aláírási blokk (K 6.4). „Tájékoztató jellegű” felirattal.
- Analitikai kimutatások (4.6), pénztárjelentés (4.7).

### 4.11 Mentés és export

- **Teljes mentés**: `pg_dump` alapú, ütemezhető (napi), visszaállítási útmutatóval; a mentés titkosítható.
- **Cégexport**: egy cég összes adata (cég, számlatükör, partnerek, bizonylatok, tételek, csatolmányok, audit napló) ZIP-ben, JSON- és CSV-fájlokkal, valamint SHA-256-os tartalomjegyzékkel (manifest) – ez a hiteles archiválás csomagformátumának alapja is (döntés 3.).
- Minden mentés és export bekerül az audit naplóba.

## 5. Felület

### 5.1 Főmenü (6 pont)

1. **Kezdőlap** – teendők: piszkozatok, NAV-ból jött jóváhagyandó számlák, lejárt tételek, zárandó időszak
2. **Könyvelés** – bizonylatok és napló, bank, pénztár, NAV-import
3. **Partnerek** – vevők, szállítók, nyitott tételek, kiegyenlítés, egyenlegközlő
4. **Kimutatások** – naplófőkönyv, főkönyvi kivonat, karton, mérleg, eredménykimutatás
5. **Zárás** – havi időszakok, évzárás, nyitás
6. **Beállítások** – cégadatok, üzleti évek, számlatükör, sablonok, felhasználók, NAV-kapcsolat, mentés, audit napló

A fejlécben mindig látszik: a választott cég és üzleti év, valamint egy kiemelt **„+ Új tétel”** gomb (1 kattintás) és gyorsbillentyűje.

### 5.2 Gyors rögzítés billentyűzetről

- **Alt+N** új tétel bárhonnan; **Ctrl+Enter** mentés; **Esc** mégse; **Alt+S** sablon választása; **?** gyorsbillentyű-súgó. A böngésző saját billentyűit (Ctrl+N, Ctrl+S) nem írjuk felül.
- A tételsorokban **Enter/Tab** lépés a következő mezőre, a sor végén új sor.
- **Számlakereső**: számra (`38` → 381, 384…) és névre („bank”) is keres, nyilakkal és Enterrel választható.
- Összegmező: `12500` vagy `12 500` is jó, kilépéskor `12 500` formára áll; `=` a sorban a még hiányzó különbözetet írja be.
- Folyamatos egyensúly-sáv a tételtáblázat alján: „Tartozik 112 500 Ft · Követel 100 000 Ft · **Eltérés: 12 500 Ft**”, piros/zöld jelzéssel és szöveggel is (nem csak színnel).
- **Előnézet mentés előtt**: a könyvelés előtt összefoglaló (bizonylat adatai, kontírozás, hatás a partner egyenlegére), onnan Enterrel véglegesíthető.

### 5.3 Formátumok, súgó, akadálymentesség

- Dátum `ÉÉÉÉ.HH.NN.` (bevitelnél `20261020`, `2026.10.20` vagy `10.20` is elfogadott, az aktuális évvel), összeg `12 500 Ft`, ezres tagolás nem törő szóközzel.
- Szakkifejezések mellett ⓘ súgó (pl. „Tartozik: a számla bal oldala…”, „Analitika”, „Sztornó”, „Zárlati tétel”), a súgószövegek egy helyen, könnyen bővíthetően.
- Hibaüzenetek magyarul, a mező mellett, érthetően (pl. „A tartozik és követel oldal nem egyezik, eltérés: 12 500 Ft”, „A 2026. szeptember lezárt időszak, ide nem lehet könyvelni. Rögzítse helyesbítő tételként a nyitott időszakban.”).
- WCAG 2.1 AA: teljes billentyűzetes kezelhetőség, látható fókusz, megfelelő kontraszt mindkét témában, ARIA-címkék, képernyőolvasóval tesztelt hibaüzenetek (`aria-live`); axe-core ellenőrzés a tesztekben.
- Világos/sötét mód a rendszerbeállítás szerint, kézzel is váltható.
- Reszponzív: a kimutatások és a jóváhagyások telefonon is használhatók; a tömeges rögzítés asztali képernyőre optimalizált.
- Veszélyes műveletek (sztornó, időszakzárás, évzárás, feloldás, partner anonimizálása) megerősítő ablakkal, a következmény leírásával; évzárásnál a cég nevének begépelésével.

## 6. Biztonság

- Jelszó Argon2id hash-sel; munkamenet HttpOnly, Secure, SameSite cookie-val; CSRF-védelem; belépési kísérletek korlátozása.
- Minden kérés cégszintű jogosultság-ellenőrzésen megy át (egy felhasználó csak a saját cégeit látja).
- NAV-titkok titkosítva; naplóba, hibaüzenetbe soha nem kerülnek.
- Az adatbázisban az alkalmazás felhasználója nem lehet tulajdonos; az audit napló táblára csak INSERT joga van.

## 7. Tesztelési terv

| Terület | Mit tesztelünk | Hogyan |
|---|---|---|
| Egyensúly | eltérés számítása, kerekítés, üres és egysoros tétel, nulla és negatív összeg elutasítása, nagy összegek | domain egységtesztek + tulajdonság-alapú (property) tesztek véletlen tételekkel |
| Adatbázis-védelmek | kiegyensúlyozatlan bizonylat nem könyvelhető; könyvelt sor nem módosítható; lezárt időszakba nem írható; sorszám hézagmentes párhuzamos rögzítésnél is | integrációs tesztek valódi PostgreSQL-lel |
| Zárás | havi zárás és feloldás; évzárás zárótételei; nyitás = előző évi zárás; zárlati állapot korlátai; helyesbítő tétel lezárt évre; jelentős hiba küszöbe (2% / 1 millió Ft) | domain + integrációs tesztek, előre kiszámolt mintacéggel |
| Kimutatások | főkönyvi kivonat Σ T = Σ K; naplófőkönyv = főkönyv; mérleg eszköz = forrás; eredménykimutatás eredménye = mérleg szerinti eredmény; előző év oszlop; analitika = főkönyv | „arany” mintaadatok (egy teljes mintaév kézzel ellenőrzött eredményekkel) |
| Analitika | részleges és többszörös kiegyenlítés, túlfizetés, beszámítás, leírás | integrációs tesztek |
| NAV | aláírás és jelszó-hash a specifikáció példáival; 35 napos felbontás; lassítás; duplikáció; módosító/sztornó lánc | egységtesztek + mock NAV-szerver |
| Felület | gyors rögzítés billentyűzetről, hibaüzenetek, előnézet, megerősítések; akadálymentesség | Playwright + axe-core |

## 8. Ütemezés (minden lépés után rövid összefoglaló)

1. **Alapok**: projektváz, adatbázis, migrációk, hitelesítés, jogosultság, audit napló, cégek és üzleti évek.
2. **Számlatükör** alapértelmezett csomaggal és szerkesztővel; partnerek.
3. **Bizonylatok és tételek**: rögzítés, egyensúly, könyvelés, sztornó, helyesbítés, sablonok, gyors rögzítés.
4. **Analitika, bank, pénztár**: nyitott tételek, kiegyenlítés.
5. **Kimutatások**: naplófőkönyv, főkönyvi kivonat, karton, mérleg, eredménykimutatás; exportok.
6. **Zárás**: havi és éves zárás, nyitás.
7. **NAV Online Számla import.**
8. **Mentés, cégexport**, végső akadálymentességi és teljes körű tesztek, felhasználói súgó.

A 150–169. § és az 1–2. melléklet bemásolása után a `REQUIREMENTS.md` ⚠️ pontjait véglegesítem; ha valami eltér a fenti feltételezésektől (pl. bizonylatkellékek, mérlegsorok), azt a megfelelő lépésnél jelzem és javítom.

## 9. Jóváhagyandó döntések

1. A technológiai javaslat (TypeScript, Fastify, PostgreSQL, React) megfelelő?
2. A 6 pontos főmenü és a gyorsbillentyűk (főleg **Alt+N** az új tételhez) megfelelők?
3. A szerepkörök (Adminisztrátor, Vezető könyvelő, Könyvelő, Megtekintő) megfelelők?
4. Egy telepítés **több céget** is kezelhessen (könyvelőiroda), ahogy a terv feltételezi?
