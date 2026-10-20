# Követelmények – magyar kettős könyvviteli webalkalmazás

> Állapot: **TERVEZET, jóváhagyásra vár** · Összeállítva: 2026.10.20.
> Hatókör: kizárólag könyvelés. Áfa-bevallás, áfa-analitika és áfa-összesítők **nincsenek** benne; az áfa csak főkönyvi számla (466, 467, 468).

## Jelölések és a kutatás korlátai

| Jel | Jelentés |
|---|---|
| ✅ | Hivatalos forrásból letöltve és ellenőrizve ebben a munkamenetben |
| ⚠️ | A hivatalos forrás URL-je meg van adva, de a szöveget **nem tudtam letölteni**. A jogszabályhely a korábbi ismereteimen alapul, kódolás előtt ellenőrizni kell az njt.hu-n. |
| ❓ | Bizonytalan, értelmezést igényel vagy változóban van |

**Fontos korlát:** az **njt.hu** (Nemzeti Jogszabálytár) a kutatás idején ebből a felhőkörnyezetből nem volt elérhető (HTTP 503, illetve a kapcsolatot a hálózati szabály elutasította). Ezért a számviteli törvény (Szt.) konkrét bekezdéseit **nem tudtam a hatályos szövegből ellenőrizni**. A ⚠️ jelű pontokat a hatályos szöveg alapján véglegesíteni kell, mielőtt a kódban rájuk építünk. Nem hivatalos oldalt (fórumot, blogot, jogi portált) szándékosan nem használtam pótlásként.

Felhasznált hivatalos források:

- [S1] 2000. évi C. törvény a számvitelről (Szt.) – https://njt.hu/jogszabaly/2000-100-00-00 ⚠️ (nem volt elérhető)
- [S2] NAV Online Számla – *Számlaadat-szolgáltatás REST API interfészleírás és fejlesztői dokumentáció*, v3.0 (utolsó változásnapló-bejegyzés: 2024.12.11.) – https://onlineszamla.nav.gov.hu/api/files/container/download/Online_Szamla_interfesz%20specifikacio_HU_v3.0.pdf ✅
- [S3] NAV 18. információs füzet – *A számla, nyugta kibocsátásának alapvető szabályai* (közzétéve: 2026.03.02.) – https://nav.gov.hu/pfile/file?path=%2Fugyfeliranytu%2Fnezzen-utana%2Finf_fuz%2Frejtett%2FInformacios-fuzetek---Aktualis%2F18.-informacios-fuzet---A-szamla-nyugta-kibocsatasanak-alapveto-szabalyai ✅
- [S4] NAV – *Így adózunk jövőre* (2025.12.22.) – https://nav.gov.hu/sajtoszoba/hirek/Igy_adozunk_jovore ✅
- [S5] NAV – *Multinacionális vállalatcsoport magyar tagvállalatánál a számviteli törvényben előírt könyvvezetési és beszámoló-készítési előírásoknak való megfelelésről* (2018.06.08.; a NAV jelölése szerint 2023.06.10-től archivált) – https://nav.gov.hu/ado/tarsasagi/Multinacionalis_valla20180608 ✅ (régi, de az Szt. szövegét idézi)
- [S6] 1/2018. (VI. 29.) ITM rendelet a digitális archiválás szabályairól – az [S3] 86. lábjegyzete hivatkozik rá ✅; szöveg: https://njt.hu/jogszabaly/2018-1-20-5D ⚠️
- [S7] 23/2014. (VI. 30.) NGM rendelet (Számlarendelet) – az [S3] hivatkozik rá ✅; szöveg: njt.hu ⚠️
- [S8] (EU) 2016/679 rendelet (GDPR) – https://eur-lex.europa.eu/legal-content/HU/TXT/?uri=CELEX:32016R0679 ⚠️ (a lap üresen jött vissza)
- [S9] 2011. évi CXII. törvény (Infotv.) – https://njt.hu/jogszabaly/2011-112-00-00 ⚠️
- [S10] 2017. évi CL. törvény (Art.) – https://njt.hu/jogszabaly/2017-150-00-00 ⚠️

---

## 1. Kettős könyvvitel és alapelvek

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 1.1 | A könyvvezetés **magyar nyelven** történik; a beszámolót is magyar nyelven kell elkészíteni. → A felület, a kimutatások és az exportok magyar nyelvűek. | [S5] (az Szt. 4. § (1)–(4), 20. § (1), 159–160. §-ára hivatkozik) | ✅ az elvre; ⚠️ a pontos bekezdésre |
| 1.2 | A kettős könyvvitelnek az eszközök és források állományát és változását **folyamatosan, zárt rendszerben, áttekinthetően** kell mutatnia, **bizonylatokkal alátámasztva**. → Minden tételhez bizonylat tartozik, a rendszer zárt: nincs könyvelés a rendszeren kívül. | [S5]; Szt. 160. § [S1] | ✅ / ⚠️ |
| 1.3 | A főkönyvet **zárt főkönyvi könyvelési rendszeren belül** kell előállítani (nem lehet például kézzel szerkesztett táblázat). → A főkönyv mindig a naplótételekből számolódik, közvetlenül nem szerkeszthető. | [S5] | ✅ |
| 1.4 | Minden gazdasági művelet tartozik = követel összeggel könyvelendő (**egyensúly**). → A mentés elutasítva, ha Σ tartozik ≠ Σ követel; a hibaüzenet kiírja az eltérést. | Szt. 160–162. § [S1] | ⚠️ |
| 1.5 | Számviteli alapelvek (vállalkozás folytatása, teljesség, valódiság, világosság, következetesség, folytonosság, összemérés, óvatosság, bruttó elszámolás, egyedi értékelés, időbeli elhatárolás, a tartalom elsődlegessége a formával szemben, lényegesség, költség–haszon összevetés). → Elsősorban a felhasználó szakmai felelőssége; a rendszer a **folytonosságot** (nyitó = előző évi záró) és a **bruttó elszámolást** (nincs automatikus nettósítás) technikailag biztosítja. | Szt. 15. § [S1] | ⚠️ |
| 1.6 | A könyvvezetés pénzneme a **forint**; devizában vezetett könyv csak külön feltételekkel. → MVP: HUF; az idegen pénznemű bizonylat devizaösszege és árfolyama tárolható, a könyvelés forintban történik. | Szt. 4. §, 60. § [S1] | ⚠️ ❓ (devizás könyvvezetés kimarad az MVP-ből) |

## 2. Számlarend és számlatükör

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 2.1 | A kettős könyvvitelt vezető gazdálkodó **számlarendet** köteles készíteni, az **egységes számlakeret** figyelembevételével. → A rendszer alapértelmezett számlatükröt ad, és ez cégenként testreszabható. | [S5]; Szt. 161. § [S1] | ✅ az elvre; ⚠️ a bekezdésre |
| 2.2 | A számlarend tartalma: a számlatükör (a főkönyvi számlák jegyzéke), az egyes számlák tartalma, a számlák közötti kapcsolatok, a bizonylati rend és a kapcsolódó szabályzatok. → A számlákhoz leírás („mit könyvelünk ide”) tartozik; a számlarend PDF-ben exportálható. | Szt. 161. § (2) [S1] | ⚠️ |
| 2.3 | Számlaosztályok (egységes számlakeret): **0** Nyilvántartási számlák · **1** Befektetett eszközök · **2** Készletek · **3** Követelések, pénzügyi eszközök, aktív időbeli elhatárolások · **4** Saját tőke, céltartalékok, kötelezettségek, passzív időbeli elhatárolások · **5** Költségnemek · **6** Költséghelyek, általános költségek · **7** Tevékenységek költségei · **8** Értékesítés elszámolt önköltsége és ráfordítások · **9** Értékesítés árbevétele és bevételek. | Szt. 161. § és a kapcsolódó szabályok [S1] | ⚠️ ❓ (az osztályozás pontos jogszabályhelyét az njt.hu-n ellenőrizni kell) |
| 2.4 | Áfa csak főkönyvi számlaként: 466 Előzetesen felszámított áfa, 467 Fizetendő áfa, 468 Áfa elszámolási számla. → Nincs áfamodul, nincs bevallás. | A számlaszámozás szakmai gyakorlat, jogszabály nem írja elő | ❓ (a konkrét számlaszám nem kötelező) |
| 2.5 | A 0. osztály (mérlegen kívüli) számlái nem kerülnek a mérlegbe; az 5–6–7. osztály használata választható (összköltség-eljárás). → MVP: **összköltség-eljárású** eredménykimutatás; a 6–7. osztály opcionális, „5→6→7 átvezetés” nincs. | Szt. 70–76. § [S1] | ⚠️ ❓ |

## 3. Bizonylati elv és bizonylati rend

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 3.1 | **Bizonylati elv:** a könyvviteli nyilvántartásba csak bizonylattal alátámasztott adat kerülhet. → A tétel mentése bizonylat (szám, kelt, típus) nélkül nem lehetséges. | [S5]; Szt. 165. § [S1] | ✅ az elvre; ⚠️ a bekezdésre |
| 3.2 | A számviteli bizonylat fogalma: a gazdasági műveletet rögzítő, a könyvviteli elszámolás alapjául szolgáló okirat; a számla is bizonylat. | Szt. 166. § (1) [S1]; [S3] az Áfa tv. kapcsán hivatkozik rá | ⚠️ |
| 3.3 | A bizonylat **kötelező kellékei**: megnevezés és sorszám (vagy más egyedi azonosító), a kiállító gazdálkodó, az utalványozó és az ellenőrző megjelölése (ahol szükséges), a gazdasági művelet tartalma, mennyiségi és értékadatai, a kiállítás kelte, a **könyvviteli elszámolás módja (kontírozás)**, a könyvelés időpontja és a könyvelést végző azonosítása. → A bizonylat-adatmodell ezeket kötelező mezőként tartalmazza; a kontírozás maga a tétel. | Szt. 167. § [S1]; a kontírozásra: NAV Adóvilág 2014/04 (167. § (7)) | ⚠️ (a kellékek felsorolását ellenőrizni kell) |
| 3.4 | **Helyesbítés:** a bizonylaton és a könyvelésen az eredeti adatnak olvashatónak kell maradnia; javítás csak helyesbítő tétellel, követhetően történhet. → Könyvelt tétel nem törölhető és nem írható felül: **sztornó** (ellentételes) és **helyesbítő** tétel van, mindkettő hivatkozik az eredetire. | Szt. 166–168. § [S1] | ⚠️ |
| 3.5 | Bizonylatok **sorszámozása:** a gazdálkodó által kiállított bizonylatok folyamatos, hézagmentes sorszámozása bizonylattípusonként és üzleti évenként (például BANK-2026-00001). → A sorszámot a rendszer adja, nem írható felül; sztornózott sorszám nem kerül újra kiosztásra. | Szt. 167–168. § (szigorú számadás) [S1] | ⚠️ ❓ |
| 3.6 | Papíralapú bizonylat **elektronikus másolata** csak a hitelességet és a sértetlenséget biztosító eljárással helyettesítheti az eredetit. → MVP: a csatolt fájl (PDF, kép) **nem** minősül hiteles másolatnak; ezt a felületen is jelezzük. | Szt. 169. § (6) [S1]; [S6] | ⚠️ ❓ |

## 4. Napló és főkönyv

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 4.1 | A kettős könyvvitelben a gazdasági műveleteket **időrendben (naplóban)** és **rendszerezve (főkönyvi számlákon)** kell rögzíteni; a napló és a főkönyv adatainak egyezniük kell. → Egy adatforrás: a naplótétel. A főkönyv és a kimutatások lekérdezések, ezért eltérés nem keletkezhet. | Szt. 162. § [S1] | ⚠️ |
| 4.2 | A főkönyvi számlák egyenlegeinek egyeztethetőnek kell lenniük az analitikával (vevők, szállítók, bank, pénztár). → Folyamatos egyeztető kimutatás: analitika összesen = főkönyvi egyenleg. | Szt. 162–163. § [S1] | ⚠️ |
| 4.3 | A **főkönyvi kivonat** a beszámoló alátámasztó dokumentuma, és megőrzendő (lásd 7.1). | Szt. 169. § (1) [S1] | ⚠️ |

## 5. Üzleti év, zárás

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 5.1 | Az **üzleti év** általában a naptári év; eltérő mérlegfordulónap csak meghatározott esetben választható. → Üzleti évenként egyedi kezdő- és záródátum; az első év lehet töredékév. | Szt. 11. § [S1] | ⚠️ |
| 5.2 | Mérlegfordulónap; a mérlegkészítés időpontjáig ismertté vált, a fordulónapra vonatkozó tételeket még könyvelni kell. → A zárási folyamatnak két lépése van: az **időszak (hónap) zárása**, majd az **év zárása**. Év végén „zárlati” tételek rögzíthetők a fordulónapra. | Szt. 3. § (2), 4. § [S1] | ⚠️ |
| 5.3 | A lezárt adatok utólagos módosítása csak **követhető módon** történhet. → Lezárt időszakba új tétel nem rögzíthető, meglévő nem módosítható. Javítás a nyitott időszakban felvitt helyesbítő tétellel lehetséges, amely hivatkozik az eredetire. A zárás csak külön jogosultsággal oldható fel, indoklással és audit naplóval. | Szt. 165–168. § (bizonylati fegyelem, helyesbítés) [S1] | ⚠️ ❓ (a „lezárás” informatikai megoldás, a törvény a követhetőséget írja elő) |
| 5.4 | **Év végi zárás és nyitás:** az eredménytétel-számlák (5–9. osztály) lezárása az eredményszámlára, a mérlegszámlák nyitása a következő évben a záró egyenlegekkel (folytonosság). → Automatikusan generált zárlati és nyitó tételek, előnézettel. | Szt. 15. § (folytonosság), 162. § [S1] | ⚠️ |
| 5.5 | Leltár: a mérleg tételeit leltárral kell alátámasztani. → MVP-n kívül: leltármodul nincs, a leltáreltérés kézi tétellel rögzíthető. | Szt. 69. § [S1] | ⚠️ |

## 6. Beszámoló

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 6.1 | Beszámolóformák: éves beszámoló, egyszerűsített éves beszámoló, mikrogazdálkodói beszámoló. | Szt. 8–9. § [S1] | ⚠️ |
| 6.2 | A **mikrogazdálkodói egyszerűsített éves beszámoló** értékhatárai 2026-tól 20%-kal nőnek: mérlegfőösszeg 150 → **180 millió Ft**, éves nettó árbevétel 300 → **360 millió Ft**. | [S4] | ✅ (a hatálybalépés pontos napját és az átlagos létszámhatárt az Szt.-ben ellenőrizni kell ⚠️) |
| 6.3 | Az egyszerűsített éves beszámoló mérlegének és (összköltség-eljárású) eredménykimutatásának **tagolását** az Szt. mellékletei írják elő. → A rendszer a főkönyvi számlákat a mérleg- és eredménykimutatás-sorokhoz rendeli (sor-hozzárendelés a számlatükörben, alapértelmezéssel). A kimutatás **tájékoztató jellegű**, a hivatalos beszámolót az e-beszámoló felületen kell benyújtani. | Szt. 1–2. melléklet és az egyszerűsített beszámoló mellékletei [S1] | ⚠️ ❓ (a mellékletszámozás és a sorok ellenőrzendők) |
| 6.4 | Letétbe helyezés és közzététel: elektronikusan, általában a mérlegfordulónapot követő **5. hónap utolsó napjáig**. → MVP-n kívül (nincs e-beszámoló beküldés), de a kimutatások exportálhatók. | Szt. 153–154. § [S1] | ⚠️ |

## 7. Adatmegőrzés

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 7.1 | A beszámolót, a leltárt, az értékelést, a **főkönyvi kivonatot**, a **naplót** és a könyvviteli nyilvántartásokat legalább **8 évig** olvasható formában meg kell őrizni. | Szt. 169. § (1) [S1] | ⚠️ |
| 7.2 | A könyvviteli elszámolást közvetlenül és közvetetten alátámasztó **bizonylatokat** legalább **8 évig** olvasható formában, a könyvelési feljegyzések alapján visszakereshető módon meg kell őrizni. | Szt. 169. § (2) [S1]; a NAV 2014-es cikke „minimum 8 év”-et említ | ⚠️ |
| 7.3 | Az elektronikus számlát elektronikus formában kell megőrizni; a megőrzési idő végéig biztosítani kell az **eredet hitelességét, a sértetlenséget és az olvashatóságot**. Ellenőrzéskor az XML-formában tárolt számla a Számlarendelet szerinti adatszerkezetben adandó át. | [S3] (Áfa tv. 179. § (2), Számlarendelet 3–7. §) | ✅ |
| 7.4 | Digitális archiválás: az [S6] rendelet szerint. → Az MVP **nem** hiteles archívum. A rögzített adatok törlése tiltott a megőrzési időn belül; az exportok hash-sel készülnek. A hiteles (elektronikus aláírással, időbélyeggel ellátott) archiválás későbbi modul. | [S6] | ✅ a hivatkozásra; ❓ a megfelelés szintjére |
| 7.5 | Adózási iratok megőrzése az adó megállapításához való jog **elévüléséig** (általában 5 év). Ez rövidebb a 8 évnél, így a 8 év a meghatározó. | Art. 78. § (3) [S10] | ⚠️ |
| 7.6 | → Megvalósítás: üzleti év, bizonylat és tétel a megőrzési idő (az üzleti év zárását követő 8. év vége) előtt **nem törölhető fizikailag**; a törlés helyett sztornó van. | 7.1–7.2-ből levezetve | ⚠️ |

## 8. Naplózás, belső kontroll (audit log)

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 8.1 | A könyvelésnek **követhetőnek** kell lennie: ki, mikor, mit rögzített vagy módosított. → Hozzáfűzéses (append-only) audit napló: felhasználó, időpont, művelet, entitás, régi és új érték. A napló **hash-lánccal** védett, így a módosítás kimutatható. | Szt. 165–167. § (bizonylati fegyelem, a könyvelést végző azonosítása) [S1] | ⚠️ ❓ (a törvény nem nevesít „audit logot”, a követelmény levezetett) |
| 8.2 | Jogosultságok szétválasztása (rögzítő, jóváhagyó vagy zárást végző, olvasó, adminisztrátor). | Belső kontroll; Szt. 167. § (utalványozó, ellenőrző) [S1] | ⚠️ ❓ |
| 8.3 | Belépési és sikertelen belépési események naplózása. | GDPR 32. cikk [S8] | ⚠️ |

## 9. Adatvédelem (GDPR)

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 9.1 | Jogalap: a partnerek (például egyéni vállalkozók, magánszemélyek) adatainak kezelése **jogi kötelezettség teljesítése** (Szt. 169. §). | GDPR 6. cikk (1) c) [S8] | ⚠️ |
| 9.2 | **Törlési jog korlátja:** a megőrzési kötelezettség alatt a könyvelési adatok nem törölhetők. → A törlési kérelem kezelése: a partner „inaktív”, a megőrzési idő lejárta után anonimizálható. | GDPR 17. cikk (3) b) [S8] | ⚠️ |
| 9.3 | Adattakarékosság, beépített adatvédelem: csak a könyveléshez szükséges partneradat tárolható (név, cím, adószám, bankszámla, kapcsolattartó). | GDPR 5. cikk (1) c), 25. cikk [S8] | ⚠️ |
| 9.4 | Biztonság: titkosított kapcsolat (HTTPS), jelszavak erős hash-sel, jogosultságkezelés, mentés, naplózás. A NAV technikai felhasználó jelszava és kulcsai titkosítva tárolandók. | GDPR 32. cikk [S8] | ⚠️ |
| 9.5 | Adatkezelési nyilvántartás és incidenskezelés: az üzemeltető (a könyvelőiroda) feladata; a rendszer az exportot és a naplót biztosítja. | GDPR 30., 33. cikk [S8]; Infotv. [S9] | ⚠️ |

## 10. NAV Online Számla – számlaadatok importálása

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 10.1 | A lekérdezés csak az adózó által a NAV Online Számla felületén létrehozott **technikai felhasználóval** lehetséges. Ehhez login, jelszó, **aláírókulcs** és **cserekulcs** kell, és a technikai felhasználónak lekérdezési jogosultsággal kell rendelkeznie. A tesztkörnyezet kulcsai az éles környezetben nem használhatók. | [S2] Bevezetés, „Adózókra vonatkozó használati követelmények” | ✅ |
| 10.2 | Hitelesítés: `passwordHash` = a jelszó **nagybetűs SHA-512** hash-e; `requestSignature` (lekérdezéseknél) = **nagybetűs SHA3-512**(requestId + timestamp `YYYYMMDDhhmmss` UTC-ben + aláírókulcs). | [S2] 1.3.2, 1.5.2 | ✅ |
| 10.3 | Végpontok: éles `https://api.onlineszamla.nav.gov.hu/invoiceService/v3/…`, teszt `https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3/…`. Használt operációk: `/queryInvoiceDigest` (lista), `/queryInvoiceData` (teljes számla), `/queryInvoiceChainDigest` (módosító láncok), `/queryTaxpayer` (partner-adatok adószám alapján). | [S2] 1.8, 6. fejezet | ✅ |
| 10.4 | `/queryInvoiceDigest`: kötelező az irány (`invoiceDirection` = `OUTBOUND` kimenő / `INBOUND` bejövő). Kötelező egy fő keresési feltétel: kiállítási dátum, feldolgozási időpont vagy eredeti számlaszám. A dátumintervallum **legfeljebb 35 nap**. A lapozást és a lapméretet a szerver határozza meg. | [S2] 1.8.6 | ✅ |
| 10.5 | **Forgalomkorlátozás:** egyes végpontokon (például `/queryInvoiceData`) IP-címenként **1 kérés/másodperc**; a többlet kérések késleltetést kapnak, 60 másodperc várakozás után pedig eldobásra kerülnek. A szinkron hívás timeoutja 60 másodperc; a kérés mérete legfeljebb 10 MB; a válasz lehet GZIP-tömörített. → Sorba állított, lassított importálás, ismételhető feldolgozás. | [S2] 1.6.5, 1.6.6, 1.6.11 | ✅ |
| 10.6 | Felhasználható adatok (digest): számlaszám, művelet (`CREATE`/`MODIFY`/`STORNO`), kategória, kiállítás dátuma, teljesítés dátuma, fizetési határidő, fizetési mód, kiállító és vevő adószáma és neve, pénznem, nettó és áfaösszeg (eredeti pénznemben és HUF-ban), módosítási index, eredeti számlaszám. | [S2] 1.8.6 (`invoiceDigest/*`) | ✅ |
| 10.7 | A NAV-ba küldött **adatszolgáltatás általában nem azonos a számlával**. Csak akkor maga a számla, ha `completenessIndicator = true`. → Az importált adat **könyvelési javaslat** (előkontírozott tervezet). A tétel bizonylata az eredeti számla; ennek száma kötelező, a fájl csatolható. Az import nem könyvel automatikusan, a felhasználó hagyja jóvá. | [S2] 1.8.6, „Elektronikus számla” fejezet | ✅ |
| 10.8 | Módosító és sztornó számlák (`MODIFY`, `STORNO`) az eredeti számlához kapcsolva helyesbítő vagy sztornó tételt javasolnak. Duplikált import kiszűrése (adószám + számlaszám + módosítási index alapján). | [S2] 1.8.3, 1.8.6 | ✅ |
| 10.9 | Az interfész jelenlegi verziója **v3.0**. Azt nem ellenőriztem, hogy van-e bejelentett újabb verzió vagy kivezetési határidő. → Az integrációt külön modulba szervezzük, hogy verzióváltáskor csak az cserélődjön. | [S2] | ❓ |

## 11. Felület (nem jogszabályi, a megbízás alapján)

Magyar nyelv, ÉÉÉÉ.HH.NN. dátumformátum, Ft, ezres tagolás szóközzel, WCAG 2.1 AA, világos és sötét mód, billentyűzetes rögzítés, megerősítés veszélyes műveleteknél. Ezek a feladatleírásból származnak, jogszabályi forrásuk nincs.

---

## Nyitott kérdések jóváhagyáshoz

1. **njt.hu ellenőrzés:** a ⚠️ jelű Szt.-hivatkozásokat (főleg 160–169. §, 8–9. §, 11. §, 153. §, mellékletek) az njt.hu hatályos szövegéből kell véglegesíteni. Ehhez vagy engedélyezi az `njt.hu` domaint a környezet hálózati beállításaiban (felhőkörnyezet menü → Edit → Network access → Allowed domains), vagy elfogadja, hogy ezeket a hivatkozásokat Ön ellenőrzi.
2. **Beszámolóforma:** az MVP az **egyszerűsített éves beszámoló** mérlegét és **összköltség-eljárású** eredménykimutatását állítsa elő (tájékoztató jelleggel)? A forgalmi költség eljárás és a mikrogazdálkodói forma maradjon későbbre?
3. **Deviza:** az MVP csak HUF-os könyvvezetést támogasson (devizás bizonylat forintra átszámítva)?
4. **Hiteles archiválás:** az [S6] szerinti hiteles digitális archiválás maradjon későbbi modul?
