# Követelmények – magyar kettős könyvviteli webalkalmazás

> Állapot: **TERVEZET, jóváhagyásra vár** · Összeállítva: 2026.10.20. · 2. változat
> Hatókör: kizárólag könyvelés. Áfa-bevallás, áfa-analitika és áfa-összesítők **nincsenek** benne; az áfa csak főkönyvi számla (466, 467, 468).

## Jelölések és a kutatás korlátai

| Jel | Jelentés |
|---|---|
| ✅ | Hivatalos forrás szövegéből ellenőrizve |
| ⚠️ | A hivatalos forrás URL-je meg van adva, de a szöveget **még nem láttam**. A jogszabályhely a korábbi ismereteimen alapul, kódolás előtt ellenőrizni kell. |
| ❓ | Bizonytalan, értelmezést igényel vagy változóban van |

**Az njt.hu elérése:** az njt.hu kiszolgáló ebből a felhőkörnyezetből érkező kéréseket nem szolgálja ki (a kapcsolat felépül, de a szerver válasz nélkül bontja; a hálózati beállításban a domain engedélyezve van). Ezért a számviteli törvény szövegét a felhasználó másolta be az njt.hu-ról (2026.10.20.). A bemásolt szöveg az **1. §-tól a 114/D. §-ig** tart. A **150–169. §** (könyvvezetés, bizonylatok, megőrzés, letétbe helyezés) és a **mellékletek** még nincsenek benne, ezért ezek a pontok továbbra is ⚠️ jelűek.

Felhasznált hivatalos források:

- [S1] 2000. évi C. törvény a számvitelről (Szt.) – https://njt.hu/jogszabaly/2000-100-00-00 – 1.–114/D. § ✅ (a felhasználó által bemásolt hatályos szöveg); 150–169. § és mellékletek ⚠️
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
| 1.1 | A könyvvezetés **csak magyar nyelven** történhet; a beszámolót is magyar nyelven kell elkészíteni. → A felület, a kimutatások és az exportok magyar nyelvűek. | Szt. 4. § (1), 12. § (2), 20. § (1) | ✅ |
| 1.2 | Könyvvezetés: a vagyoni, pénzügyi, jövedelmi helyzetre kiható gazdasági eseményekről **folyamatos nyilvántartás**, amelyet az **üzleti év végével le kell zárni**. A könyvvezetés a 159–169. § és a számviteli alapelvek szerint történik. | Szt. 12. § (1)–(2) | ✅ |
| 1.3 | **Kettős könyvvitelt** köteles vezetni minden vállalkozó (kivétel: az egyszerűsített beszámolót készítő, egyszeres könyvvitelt vezető gazdálkodó). → A rendszer csak kettős könyvvitelt támogat. | Szt. 12. § (3)–(4), 8. § (3) | ✅ |
| 1.4 | A beszámolót **bizonylatokkal alátámasztott, szabályszerűen vezetett kettős könyvvitel** adatai alapján kell elkészíteni. A kettős könyvvitelnek **folyamatosan, zárt rendszerben, áttekinthetően** kell működnie. → Minden tételhez bizonylat tartozik; a kimutatások csak a könyvelt tételekből készülnek. | Szt. 20. § (1); [S5] | ✅ |
| 1.5 | A főkönyvet **zárt főkönyvi könyvelési rendszeren belül** kell előállítani. → A főkönyv mindig a naplótételekből számolódik, közvetlenül nem szerkeszthető. | [S5] | ✅ |
| 1.6 | Minden gazdasági művelet tartozik = követel összeggel könyvelendő (**egyensúly**). → A mentés elutasítva, ha Σ tartozik ≠ Σ követel; a hibaüzenet kiírja az eltérést. | A kettős könyvvitel lényegéből; Szt. 160–162. § | ⚠️ (a bekezdés ellenőrzendő) |
| 1.7 | **Számviteli alapelvek:** vállalkozás folytatása, teljesség, valódiság, világosság, következetesség, folytonosság, összemérés, óvatosság, bruttó elszámolás (15. §); egyedi értékelés, időbeli elhatárolás, tartalom elsődlegessége, lényegesség, költség–haszon (16. §). → A rendszer technikailag biztosítja a **folytonosságot** (nyitó adat = előző évi záró adat, 15. § (6)) és a **bruttó elszámolást** (nincs automatikus nettósítás, 15. § (9)). A **teljesség** (15. § (2)) miatt a fordulónap után ismertté vált, az előző évre vonatkozó tételek a mérlegkészítésig még könyvelhetők az előző évre. | Szt. 14. § (1), 15. § (1)–(9), 16. § (1)–(5) | ✅ |
| 1.8 | **Pénznem:** a könyvvezetés és a beszámoló pénzneme a létesítő okiratban rögzített pénznem; devizában (EUR, USD vagy funkcionális pénznem) csak meghatározott feltételekkel. A beszámoló adatai **ezer forintban** (100 milliárd Ft feletti mérlegfőösszegnél millió forintban). → MVP: HUF-os könyvvezetés; devizás bizonylat devizaösszege és árfolyama tárolható, a könyvelés forintban történik. A kimutatások ezer Ft-os nézetben is elkészülnek. | Szt. 20. § (2)–(5b) | ✅ (devizás könyvvezetés kimarad az MVP-ből) |
| 1.9 | **Devizás tételek átszámítása:** a választott hitelintézet vételi és eladási árfolyamának átlaga, vagy az MNB, illetve az EKB hivatalos árfolyama; a számviteli politika alapján az áfatörvény szerinti árfolyam is alkalmazható. → Cégenként beállítható árfolyamforrás; MVP-ben kézi árfolyammegadás. | Szt. 60. § (4)–(5a) | ✅ |
| 1.10 | **Számviteli politika és szabályzatok:** írásba kell foglalni; kötelező a leltárkészítési és leltározási, az értékelési, az önköltségszámítási (bizonyos esetekben mentesül) és a **pénzkezelési szabályzat**. A pénzkezelési szabályzat rendezi többek között a **napi készpénz záróállomány maximumát**. → MVP: cégadatoknál beállítható pénztár-záróegyenleg-maximum, túllépésnél figyelmeztetés. A szabályzatok dokumentumként csatolhatók. | Szt. 14. § (3)–(8), (11) | ✅ |

## 2. Számlarend és számlatükör

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 2.1 | A kettős könyvvitelt vezető gazdálkodó **számlarendet** köteles készíteni, az **egységes számlakeret** figyelembevételével. → A rendszer alapértelmezett számlatükröt ad, és ez cégenként testreszabható. | [S5]; Szt. 161. § | ✅ az elvre; ⚠️ a bekezdésre |
| 2.2 | A számlarend tartalma: a számlatükör, az egyes számlák tartalma, a számlák közötti kapcsolatok, a bizonylati rend. → A számlákhoz leírás („mit könyvelünk ide”) tartozik; a számlarend PDF-ben exportálható. | Szt. 161. § | ⚠️ |
| 2.3 | Számlaosztályok (egységes számlakeret): **0** Nyilvántartási számlák · **1** Befektetett eszközök · **2** Készletek · **3** Követelések, pénzügyi eszközök, aktív időbeli elhatárolások · **4** Saját tőke, céltartalékok, kötelezettségek, passzív időbeli elhatárolások · **5** Költségnemek · **6** Költséghelyek, általános költségek · **7** Tevékenységek költségei · **8** Értékesítés elszámolt önköltsége és ráfordítások · **9** Értékesítés árbevétele és bevételek. Az 1–4. osztály a mérleg (Szt. 24–45. §), az 5., 8. és 9. osztály az összköltséges eredménykimutatás (Szt. 72–85. §) tételeit hordozza. | Szt. 161. § és kapcsolódó szabályok | ⚠️ ❓ (az osztályozás pontos jogszabályhelyét ellenőrizni kell) |
| 2.4 | Áfa csak főkönyvi számlaként: 466 Előzetesen felszámított áfa, 467 Fizetendő áfa, 468 Áfa elszámolási számla. → Nincs áfamodul, nincs bevallás. A bekerülési érték nem tartalmazza a levonható áfát (Szt. 47. § (3)), a nem levonható áfa része a bekerülési értéknek (47. § (2) b)). | Szt. 47. § (2)–(3); a számlaszámozás szakmai gyakorlat | ✅ az áfa kezelésére; ❓ a konkrét számlaszámokra |
| 2.5 | Az eredménykimutatás készülhet **összköltség-eljárással** (2. melléklet) vagy **forgalmi költség eljárással** (3. melléklet). → MVP: összköltség-eljárás; az 5. osztály költségnemei kötelezőek, a 6–7. osztály opcionális. | Szt. 71. § (1)–(2) | ✅ |

## 3. Bizonylati elv és bizonylati rend

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 3.1 | **Bizonylati elv:** a könyvviteli nyilvántartásba csak bizonylattal alátámasztott adat kerülhet. → A tétel mentése bizonylat (szám, kelt, típus) nélkül nem lehetséges. | Szt. 20. § (1) ✅; [S5]; Szt. 165. § ⚠️ | ✅ az elvre; ⚠️ a bekezdésre |
| 3.2 | A számviteli bizonylat fogalma: a gazdasági műveletet rögzítő, a könyvviteli elszámolás alapjául szolgáló okirat; a számla is bizonylat. Az Szt. több helyen a **helyesbítő számviteli bizonylatot** nevesíti (például utólagos engedmény, visszáru). | Szt. 166. § (1) ⚠️; Szt. 73. § (2) ✅ | ⚠️ / ✅ |
| 3.3 | A bizonylat **kötelező kellékei**: megnevezés és sorszám (vagy más egyedi azonosító), a kiállító gazdálkodó, az utalványozó és az ellenőrző megjelölése (ahol szükséges), a gazdasági művelet tartalma, mennyiségi és értékadatai, a kiállítás kelte, a **könyvviteli elszámolás módja (kontírozás)**, a könyvelés időpontja és a könyvelést végző azonosítása. → A bizonylat-adatmodell ezeket kötelező mezőként tartalmazza. | Szt. 167. § | ⚠️ |
| 3.4 | **Helyesbítés:** az eredeti adatnak olvashatónak kell maradnia; javítás csak helyesbítő tétellel, követhetően. → Könyvelt tétel nem törölhető és nem írható felül: **sztornó** és **helyesbítő** tétel van, mindkettő hivatkozik az eredetire. | Szt. 166–168. § | ⚠️ |
| 3.5 | Bizonylatok **sorszámozása:** folyamatos, hézagmentes sorszám bizonylattípusonként és üzleti évenként (például BANK-2026-00001). → A sorszámot a rendszer adja; sztornózott sorszám nem kerül újra kiosztásra. | Szt. 167–168. § | ⚠️ ❓ |
| 3.6 | Papíralapú bizonylat **elektronikus másolata** csak a hitelességet és a sértetlenséget biztosító eljárással helyettesítheti az eredetit. → MVP: a csatolt fájl **nem** minősül hiteles másolatnak; ezt a felületen is jelezzük. | Szt. 169. § (6); [S6] | ⚠️ ❓ |

## 4. Napló, főkönyv, analitika, leltár

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 4.1 | A gazdasági műveleteket **időrendben (napló)** és **rendszerezve (főkönyvi számlák)** kell rögzíteni; a napló és a főkönyv adatainak egyezniük kell. → Egy adatforrás: a naplótétel. A főkönyv és a kimutatások lekérdezések. | Szt. 162. § | ⚠️ |
| 4.2 | Az üzleti év végi záráshoz el kell végezni a **főkönyvi könyvelés és az analitikus nyilvántartások egyeztetését** a mérlegfordulónapra. → Egyeztető kimutatás: vevő-, szállító-, bank- és pénztáranalitika összesen = főkönyvi egyenleg; eltérés esetén az évzárás figyelmeztet. | Szt. 69. § (2) | ✅ |
| 4.3 | A mérleg tételeit **leltárral** kell alátámasztani, amely tételesen tartalmazza a fordulónapi eszközöket és forrásokat mennyiségben és értékben; a csak értékben kimutatott eszközöknél és kötelezettségeknél **egyeztetéssel**. → MVP: nyitott tételes vevő- és szállítólista, bank- és pénztáregyenleg fordulónapra (egyeztetési leltár exportja). Mennyiségi leltár és készletnyilvántartás az MVP-n kívül. | Szt. 69. § (1)–(4) | ✅ |
| 4.4 | Követelés a mérlegben addig szerepel, amíg pénzügyileg vagy egyéb módon (beszámítás, eszközátadás) nem rendezték, el nem engedték, illetve behajthatatlanként le nem írták. → A kiegyenlítés lehet banki, pénztári, beszámításos vagy leírás; a nyitott tétel ennek megfelelően zárul. | Szt. 65. § (6)–(7), 68. § (5) | ✅ |

## 5. Üzleti év, zárás, hibák javítása

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 5.1 | Az **üzleti év** a naptári év, ettől a 11. § (2)–(13) szerinti esetekben lehet eltérni; időtartama általában **12 naptári hónap**, de lehet rövidebb (előtársasági időszak, áttérés, átalakulás, végelszámolás). **Mikrogazdálkodói beszámolót készítőnél az üzleti év nem térhet el a naptári évtől.** → Üzleti évenként egyedi kezdő- és záródátum; az első év lehet töredékév. | Szt. 11. § (1)–(6) | ✅ |
| 5.2 | A teljesség elve miatt a fordulónapot követően, de a **mérlegkészítés időpontjáig** ismertté vált, az üzleti évre vonatkozó eseményeket még könyvelni kell. → Az évzárás kétlépcsős: a **fordulónap után** az év „zárlati” állapotba kerül (csak zárlati tételek rögzíthetők a fordulónapra), majd a beszámoló elkészülte után **véglegesen lezárul**. A havi időszakok közben külön zárhatók. | Szt. 3. § (6) 1., 15. § (2) | ✅ |
| 5.3 | Lezárt időszakba új tétel nem rögzíthető, meglévő nem módosítható. Javítás a nyitott időszakban felvitt helyesbítő tétellel, amely hivatkozik az eredetire. A zárás feloldása csak külön jogosultsággal, indoklással és audit naplóval. | Szt. 12. § (1) (év végén lezárja) ✅; 165–168. § ⚠️ | ✅ / ⚠️ ❓ (a havi lezárás informatikai megoldás) |
| 5.4 | **Beszámolóval lezárt évet érintő hiba:** az ellenőrzés (önellenőrzés is) megállapítását a feltárás évében kell könyvelni. **Jelentős összegű** a hiba, ha az egy évet érintő hibák abszolút összege meghaladja a számviteli politikában rögzített határt, de mindenképp, ha meghaladja a mérlegfőösszeg 2%-át, illetve ha az nem haladja meg az 1 millió Ft-ot, akkor az 1 millió Ft-ot. A jelentős hibák hatását a mérlegben és az eredménykimutatásban **külön oszlopban** kell bemutatni; az előző évek eredményét érintő jelentős hiba az eredménytartalékon keresztül számolandó el; a nem jelentős hiba a tárgyévi adatok között szerepel. → A helyesbítő tételnél megjelölhető, hogy „előző évet érintő hiba (melyik év)”; a rendszer összesíti évenként, kiszámolja a jelentősségi küszöböt, és a kimutatásban külön oszlopban mutatja. | Szt. 3. § (3) 1–4., 19. § (3), 37. § (5), 71. § (3) | ✅ |
| 5.5 | **Év végi zárás és nyitás:** az eredménytétel-számlák lezárása, a mérlegszámlák nyitása a következő évben a záró egyenlegekkel (folytonosság). Az előző év adózott eredménye az eredménytartalékba kerül. → Automatikusan generált zárlati és nyitó tételek, előnézettel. | Szt. 15. § (6), 37. § (1) a), (2) a) | ✅ |
| 5.6 | **Közbenső mérleg:** a fordulónapra a nyilvántartásokat nem lehet lezárni, az értékelési korrekciók csak a közbenső mérlegben szerepelhetnek. → Kimutatás bármely napra elkészíthető zárás nélkül; MVP-ben nincs külön közbenső-mérleg-korrekció. | Szt. 21. § (4) | ✅ |

## 6. Beszámoló

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 6.1 | Beszámolóformák: éves beszámoló, egyszerűsített éves beszámoló, összevont (konszolidált) éves beszámoló, egyszerűsített beszámoló; ezen belül választható a **mikrogazdálkodói egyszerűsített éves beszámoló**. | Szt. 8. § (2), 9. § (6) | ✅ |
| 6.2 | **Egyszerűsített éves beszámoló** készíthető, ha két egymást követő évben a fordulónapon a három mutató közül bármelyik kettő nem haladja meg: mérlegfőösszeg **2000 millió Ft**, nettó árbevétel **4000 millió Ft**, átlagos létszám **50 fő**. **Mikrogazdálkodói** változat (könyvvizsgálatra nem kötelezettnek): **180 millió Ft**, **360 millió Ft**, **10 fő**. A mikro választásától legkorábban 3 lezárt év után lehet eltérni. → Tájékoztató értékhatár-ellenőrzés a cég adatai alapján. | Szt. 9. § (2), (6), (8)–(9); [S4] | ✅ |
| 6.3 | **Egyszerűsített éves beszámoló:** mérleg + eredménykimutatás + kiegészítő melléklet; üzleti jelentés nem kell. A mérleg az 1. melléklet „A” vagy „B” változatának, az eredménykimutatás a 2. vagy 3. mellékletnek a **nagybetűvel és római számmal jelölt tételeit** tartalmazza. Minden tételnél fel kell tüntetni az **előző év adatát**. → A számlatükörben a főkönyvi számlák mérleg-, illetve eredménykimutatás-sorokhoz rendelhetők (alapértelmezett hozzárendeléssel). A kimutatás tárgyév + előző év oszloppal, Ft-ban és ezer Ft-ban. A kimutatás **tájékoztató jellegű**, a hivatalos beszámolót az e-beszámoló felületen kell benyújtani. | Szt. 17. § (2), 19. § (3), 20. § (2), 22. § (1), 96. § (1)–(3) | ✅ az elvekre; ⚠️ az 1–2. melléklet sorainak pontos szövegére |
| 6.4 | A mérleget, az eredménykimutatást és a kiegészítő mellékletet a képviseletre jogosult a hely és a kelet feltüntetésével aláírja. → A PDF-export aláírási blokkot tartalmaz (hely, kelet, képviselő neve). | Szt. 20. § (6) | ✅ |
| 6.5 | Letétbe helyezés és közzététel: elektronikusan, általában a mérlegfordulónapot követő **5. hónap utolsó napjáig**. → MVP-n kívül (nincs e-beszámoló-beküldés), de a kimutatások exportálhatók. | Szt. 153–154. § | ⚠️ |

## 7. Adatmegőrzés

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 7.1 | A beszámolót, a leltárt, az értékelést, a **főkönyvi kivonatot**, a **naplót** és a könyvviteli nyilvántartásokat legalább **8 évig** olvasható formában meg kell őrizni. A leltár megőrzését az Szt. 69. § (1) is előírja („e törvény előírásai szerint megőrizni”). | Szt. 169. § (1) ⚠️; 69. § (1) ✅ | ⚠️ |
| 7.2 | A könyvviteli elszámolást közvetlenül és közvetetten alátámasztó **bizonylatokat** legalább **8 évig** olvasható formában, a könyvelési feljegyzések alapján visszakereshető módon meg kell őrizni. | Szt. 169. § (2) | ⚠️ |
| 7.3 | Az elektronikus számlát elektronikus formában kell megőrizni; a megőrzési idő végéig biztosítani kell az **eredet hitelességét, a sértetlenséget és az olvashatóságot**. | [S3] (Áfa tv. 179. § (2), Számlarendelet 3–7. §) | ✅ |
| 7.4 | Digitális archiválás: az [S6] rendelet szerint. → Az MVP **nem** hiteles archívum. A rögzített adatok a megőrzési időn belül nem törölhetők; az exportok hash-sel készülnek. A hiteles archiválás későbbi modul. | [S6] | ✅ a hivatkozásra; ❓ a megfelelés szintjére |
| 7.5 | Adózási iratok megőrzése az adó megállapításához való jog **elévüléséig** (általában 5 év). A 8 év a meghatározó. | Art. 78. § (3) [S10] | ⚠️ |
| 7.6 | → Megvalósítás: üzleti év, bizonylat és tétel a megőrzési idő (az üzleti év zárását követő 8. év vége) előtt **nem törölhető fizikailag**; a törlés helyett sztornó van. | 7.1–7.2-ből levezetve | ⚠️ |

## 8. Naplózás, belső kontroll (audit log)

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 8.1 | A könyvelésnek **követhetőnek** kell lennie: ki, mikor, mit rögzített vagy módosított. → Hozzáfűzéses (append-only) audit napló: felhasználó, időpont, művelet, entitás, régi és új érték. Hash-lánccal védett. | Szt. 15. § (3) (valódiság: kívülálló által megállapítható) ✅; 165–167. § ⚠️ | ❓ (a törvény nem nevesít „audit logot”, a követelmény levezetett) |
| 8.2 | Jogosultságok szétválasztása (rögzítő, zárást végző, olvasó, adminisztrátor). | Belső kontroll; Szt. 167. § (utalványozó, ellenőrző) | ⚠️ ❓ |
| 8.3 | Belépési és sikertelen belépési események naplózása. | GDPR 32. cikk [S8] | ⚠️ |

## 9. Adatvédelem (GDPR)

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 9.1 | Jogalap: a partnerek adatainak kezelése **jogi kötelezettség teljesítése** (Szt. 169. §). | GDPR 6. cikk (1) c) [S8] | ⚠️ |
| 9.2 | **Törlési jog korlátja:** a megőrzési kötelezettség alatt a könyvelési adatok nem törölhetők. → Törlési kérelemnél a partner „inaktív”, a megőrzési idő lejárta után anonimizálható. | GDPR 17. cikk (3) b) [S8] | ⚠️ |
| 9.3 | Adattakarékosság, beépített adatvédelem: csak a könyveléshez szükséges partneradat (név, cím, adószám, bankszámla, kapcsolattartó). | GDPR 5. cikk (1) c), 25. cikk [S8] | ⚠️ |
| 9.4 | Biztonság: HTTPS, jelszavak erős hash-sel, jogosultságkezelés, mentés, naplózás. A NAV technikai felhasználó jelszava és kulcsai titkosítva tárolandók. | GDPR 32. cikk [S8] | ⚠️ |
| 9.5 | Adatkezelési nyilvántartás és incidenskezelés: az üzemeltető feladata; a rendszer az exportot és a naplót biztosítja. | GDPR 30., 33. cikk [S8]; Infotv. [S9] | ⚠️ |

## 10. NAV Online Számla – számlaadatok importálása

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 10.1 | A lekérdezés csak az adózó által a NAV Online Számla felületén létrehozott **technikai felhasználóval** lehetséges (login, jelszó, **aláírókulcs**, **cserekulcs**, lekérdezési jogosultság). A tesztkörnyezet kulcsai éles környezetben nem használhatók. | [S2] Bevezetés | ✅ |
| 10.2 | Hitelesítés: `passwordHash` = a jelszó **nagybetűs SHA-512** hash-e; `requestSignature` (lekérdezéseknél) = **nagybetűs SHA3-512**(requestId + timestamp `YYYYMMDDhhmmss` UTC + aláírókulcs). | [S2] 1.3.2, 1.5.2 | ✅ |
| 10.3 | Végpontok: éles `https://api.onlineszamla.nav.gov.hu/invoiceService/v3/…`, teszt `https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3/…`. Operációk: `/queryInvoiceDigest`, `/queryInvoiceData`, `/queryInvoiceChainDigest`, `/queryTaxpayer`. | [S2] 1.8, 6. fejezet | ✅ |
| 10.4 | `/queryInvoiceDigest`: kötelező irány (`OUTBOUND` / `INBOUND`) és egy fő keresési feltétel (kiállítási dátum, feldolgozási időpont vagy eredeti számlaszám). Dátumintervallum **legfeljebb 35 nap**. A lapozást a szerver határozza meg. | [S2] 1.8.6 | ✅ |
| 10.5 | **Forgalomkorlátozás:** egyes végpontokon IP-címenként **1 kérés/másodperc**; 60 másodperc várakozás után a kérés eldobásra kerül. Timeout 60 s; kérés legfeljebb 10 MB; a válasz lehet GZIP-tömörített. → Sorba állított, lassított, ismételhető importálás. | [S2] 1.6.5, 1.6.6, 1.6.11 | ✅ |
| 10.6 | Felhasználható adatok: számlaszám, művelet (`CREATE`/`MODIFY`/`STORNO`), kategória, kiállítás és teljesítés dátuma, fizetési határidő és mód, kiállító és vevő adószáma, neve, pénznem, nettó és áfaösszeg (eredeti pénznemben és HUF-ban), módosítási index, eredeti számlaszám. | [S2] 1.8.6 | ✅ |
| 10.7 | Az adatszolgáltatás általában **nem azonos a számlával** (csak `completenessIndicator = true` esetén). → Az importált adat **könyvelési javaslat**; a tétel bizonylata az eredeti számla. Az import nem könyvel automatikusan, a felhasználó hagyja jóvá. | [S2] 1.8.6 | ✅ |
| 10.8 | Módosító és sztornó számlák az eredeti számlához kapcsolva helyesbítő vagy sztornó tételt javasolnak. A helyesbítő bizonylat az árbevételt az Szt. szerinti időpontra helyesbíti. Duplikált import kiszűrése (adószám + számlaszám + módosítási index). | [S2] 1.8.3, 1.8.6; Szt. 73. § (2)–(3) | ✅ |
| 10.9 | Az interfész jelenlegi verziója **v3.0**; újabb verzió bejelentését nem ellenőriztem. → Az integráció külön modul. | [S2] | ❓ |

## 11. Felület (nem jogszabályi, a megbízás alapján)

Magyar nyelv, ÉÉÉÉ.HH.NN. dátumformátum, Ft, ezres tagolás szóközzel, WCAG 2.1 AA, világos és sötét mód, billentyűzetes rögzítés, megerősítés veszélyes műveleteknél.

---

## Még hiányzó szövegek (az njt.hu-ról bemásolandó)

1. **Szt. 150–169. §** – a könyvvizsgálat utáni rész: letétbe helyezés és közzététel (153–154. §), könyvvezetés (159–164. §: kettős könyvvitel, számlarend, napló, főkönyv), bizonylati elv és fegyelem, bizonylat kellékei, helyesbítés, szigorú számadás, megőrzés (165–169. §).
2. **Szt. 1. számú melléklet** (mérleg „A” változat) és **2. számú melléklet** (összköltség-eljárású eredménykimutatás) – a kimutatások sorainak pontos szövegéhez.

## Döntések (a megrendelő jóváhagyásával, 2026.10.20.)

1. **Beszámoló:** az MVP tájékoztató jelleggel az **egyszerűsített éves beszámoló** mérlegét („A” változat) és **összköltség-eljárású** eredménykimutatását állítja elő.
2. **Pénznem:** az MVP forintban vezeti a könyveket. A devizás bizonylatoknál az **eredeti devizanemet, a devizaösszeget, az alkalmazott árfolyamot, annak forrását és dátumát** is tárolni kell, hogy a devizás könyvvezetés később bővíthető legyen.
3. **Hiteles archiválás:** későbbi modul, de az **adatmodellnek fel kell rá készülnie** (megőrzési határidő, tartalmi hash, hitelesítési mezők).
4. **Régi kód:** a repository meglévő kódja érintetlen marad; az új projekt a `konyvelo/` könyvtárban készül.
