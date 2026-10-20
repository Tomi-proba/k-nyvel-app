# Követelmények – magyar kettős könyvviteli webalkalmazás

> Állapot: **jóváhagyva** (a döntéseket lásd a végén) · Összeállítva: 2026.10.20. · 3. változat – a 150–169. § és az 1–2. melléklet hatályos szövege alapján pontosítva
> Hatókör: kizárólag könyvelés. Áfa-bevallás, áfa-analitika és áfa-összesítők **nincsenek** benne; az áfa csak főkönyvi számla (466, 467, 468).

## Jelölések és a kutatás korlátai

| Jel | Jelentés |
|---|---|
| ✅ | Hivatalos forrás szövegéből ellenőrizve |
| ⚠️ | A hivatalos forrás URL-je meg van adva, de a szöveget **még nem láttam**. A jogszabályhely a korábbi ismereteimen alapul, kódolás előtt ellenőrizni kell. |
| ❓ | Bizonytalan, értelmezést igényel vagy változóban van |

**Az njt.hu elérése:** az njt.hu kiszolgáló ebből a felhőkörnyezetből érkező kéréseket nem szolgálja ki. Ezért a számviteli törvény **teljes hatályos szövegét** a felhasználó töltötte le az njt.hu-ról, és PDF-ben adta át (nyomtatási nézet, „Hatályos: 2026. 02. 28. –”, lekérdezés ideje: 2026.10.20 14:55:20). A 3. változat minden Szt.-hivatkozása ebből a szövegből ellenőrzött.

**Javított hivatkozások a 2. változathoz képest** (a korábbi, emlékezetből adott jogszabályhelyek egy része hibás volt):

| Téma | 2. változatban | Helyesen |
|---|---|---|
| Napló, főkönyv, zárt rendszer | 162. § | **159. §** (zárt rendszer), **164. § (2)** (főkönyvi kivonat), **169. § (1)** (naplófőkönyv megőrzése). A 162. § az **egyszeres** könyvvitelről szól. |
| Egységes számlakeret, számlaosztályok | 161. § | **160. § (1)–(5)** |
| Számlarend tartalma | 161. § (általánosan) | **161. § (2) a)–d)**; analitika–főkönyv kapcsolat: **161. § (3)** |
| Egyensúly (tartozik = követel) | 160–162. § | A törvény **nem mondja ki** szó szerint; a 159. § (zárt rendszer) és a 165. § (4) (logikailag zárt egyeztethetőség) alapján levezetett |
| Helyesbítés | 166–168. § | **165. § (2)** („előírásszerűen javították”) és **167. § (7)** (utólagos módosítás kizárása); a javítás módszerét a törvény nem írja elő |
| Hézagmentes sorszámozás | 167–168. § | A törvény csak **„sorszáma vagy egyéb más azonosítója”**-t ír elő (167. § (1) a)); a szigorú számadás (168. §) a **készpénzkezelési** és hasonló bizonylatokra elszámoltatható nyilvántartást kér. A hézagmentesség tervezési döntés. |
| Elektronikus másolat | 169. § (6) + ITM-rendelet | 169. § (6) a **papíralapú dokumentumok elektronikus másolatáról** szóló jogszabályra utal; az ITM-rendelet (digitális archiválás) a 169. § (5)-höz tartozik |

Felhasznált hivatalos források:

- [S1] 2000. évi C. törvény a számvitelről (Szt.) – https://njt.hu/jogszabaly/2000-100-00-00 – teljes hatályos szöveg (hatályos 2026.02.28-tól, lekérdezve 2026.10.20.), a mellékletekkel együtt ✅
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
| 1.2a | A kettős könyvvitelt vezető gazdálkodó olyan nyilvántartást vezet, amely az eszközökben és forrásokban bekövetkezett változásokat **a valóságnak megfelelően, folyamatosan, zárt rendszerben, áttekinthetően** mutatja. | Szt. 159. § | ✅ |
| 1.3 | **Kettős könyvvitelt** köteles vezetni minden vállalkozó (kivétel: az egyszerűsített beszámolót készítő, egyszeres könyvvitelt vezető gazdálkodó). → A rendszer csak kettős könyvvitelt támogat. | Szt. 12. § (3)–(4), 8. § (3) | ✅ |
| 1.4 | A beszámolót **bizonylatokkal alátámasztott, szabályszerűen vezetett kettős könyvvitel** adatai alapján kell elkészíteni. A kettős könyvvitelnek **folyamatosan, zárt rendszerben, áttekinthetően** kell működnie. → Minden tételhez bizonylat tartozik; a kimutatások csak a könyvelt tételekből készülnek. | Szt. 20. § (1), 159. §; [S5] | ✅ |
| 1.5 | A főkönyvet **zárt főkönyvi könyvelési rendszeren belül** kell előállítani. → A főkönyv mindig a naplótételekből számolódik, közvetlenül nem szerkeszthető. | Szt. 159. §; [S5] | ✅ |
| 1.6 | Minden gazdasági művelet tartozik = követel összeggel könyvelendő (**egyensúly**). → A mentés elutasítva, ha Σ tartozik ≠ Σ követel; a hibaüzenet kiírja az eltérést. | A kettős könyvvitel lényegéből; Szt. 159. § (zárt rendszer), 165. § (4) (logikailag zárt egyeztethetőség) | ✅ a zárt rendszerre; ❓ az egyensúlyi szabályt a törvény szó szerint nem mondja ki (szakmai alapszabály) |
| 1.7 | **Számviteli alapelvek:** vállalkozás folytatása, teljesség, valódiság, világosság, következetesség, folytonosság, összemérés, óvatosság, bruttó elszámolás (15. §); egyedi értékelés, időbeli elhatárolás, tartalom elsődlegessége, lényegesség, költség–haszon (16. §). → A rendszer technikailag biztosítja a **folytonosságot** (nyitó adat = előző évi záró adat, 15. § (6)) és a **bruttó elszámolást** (nincs automatikus nettósítás, 15. § (9)). A **teljesség** (15. § (2)) miatt a fordulónap után ismertté vált, az előző évre vonatkozó tételek a mérlegkészítésig még könyvelhetők az előző évre. | Szt. 14. § (1), 15. § (1)–(9), 16. § (1)–(5) | ✅ |
| 1.8 | **Pénznem:** a könyvvezetés és a beszámoló pénzneme a létesítő okiratban rögzített pénznem; devizában (EUR, USD vagy funkcionális pénznem) csak meghatározott feltételekkel. A beszámoló adatai **ezer forintban** (100 milliárd Ft feletti mérlegfőösszegnél millió forintban). → MVP: HUF-os könyvvezetés; devizás bizonylat devizaösszege és árfolyama tárolható, a könyvelés forintban történik. A kimutatások ezer Ft-os nézetben is elkészülnek. | Szt. 20. § (2)–(5b) | ✅ (devizás könyvvezetés kimarad az MVP-ből) |
| 1.9 | **Devizás tételek átszámítása:** a választott hitelintézet vételi és eladási árfolyamának átlaga, vagy az MNB, illetve az EKB hivatalos árfolyama; a számviteli politika alapján az áfatörvény szerinti árfolyam is alkalmazható. → Cégenként beállítható árfolyamforrás; MVP-ben kézi árfolyammegadás. | Szt. 60. § (4)–(5a) | ✅ |
| 1.10 | **Számviteli politika és szabályzatok:** írásba kell foglalni; kötelező a leltárkészítési és leltározási, az értékelési, az önköltségszámítási (bizonyos esetekben mentesül) és a **pénzkezelési szabályzat**. A pénzkezelési szabályzat rendezi többek között a **napi készpénz záróállomány maximumát**. → MVP: cégadatoknál beállítható pénztár-záróegyenleg-maximum, túllépésnél figyelmeztetés. A szabályzatok dokumentumként csatolhatók. | Szt. 14. § (3)–(8), (11) | ✅ |

## 2. Számlarend és számlatükör

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 2.1 | A kettős könyvvitelt vezető gazdálkodó **számlarendet** köteles készíteni, az **egységes számlakeret** figyelembevételével. A számlarendet az új gazdálkodó a megalakulástól számított **90 napon belül** köteles elkészíteni; a számlarend összeállításáért a képviseletre jogosult a felelős. → A rendszer alapértelmezett számlatükröt ad, és ez cégenként testreszabható. | Szt. 161. § (1), (4)–(5) | ✅ |
| 2.2 | A számlarend tartalma: a) minden alkalmazásra kijelölt számla **számjele és megnevezése**; b) a számla **tartalma** (ha a névből nem egyértelmű), növekedésének és csökkenésének jogcímei, a számlák közötti kapcsolatok; c) a **főkönyvi számla és az analitikus nyilvántartás kapcsolata**; d) az alátámasztó **bizonylati rend**. → A számlához leírás („mit könyvelünk ide”) és analitikatípus tartozik; a számlarend PDF-ben exportálható. | Szt. 161. § (2) | ✅ |
| 2.2a | Az analitikus nyilvántartásoknak **szoros kapcsolatban** kell lenniük a főkönyvi könyveléssel, és **biztosítani kell az értékadatok számszerű egyeztetésének lehetőségét**. → Analitika–főkönyv egyeztető kimutatás bármely napra. | Szt. 161. § (3) | ✅ |
| 2.3 | Számlaosztályok (egységes számlakeret): **0** Nyilvántartási számlák · **1** Befektetett eszközök · **2** Készletek · **3** Követelések, pénzügyi eszközök, aktív időbeli elhatárolások · **4** Saját tőke, céltartalékok, kötelezettségek, passzív időbeli elhatárolások · **5** Költségnemek · **6** Költséghelyek, általános költségek · **7** Tevékenységek költségei · **8** Értékesítés elszámolt önköltsége és ráfordítások · **9** Értékesítés árbevétele és bevételek. Az 1–4. osztály a mérleg (Szt. 24–45. §), az 5., 8. és 9. osztály az összköltséges eredménykimutatás (Szt. 72–85. §) tételeit hordozza. A **6–7. osztály** használata a gazdálkodó döntése (vezetői információk). A **0. osztály** nyilvántartási számlái az eredményt és a saját tőkét közvetlenül nem befolyásolják (mérlegen kívüli tételek). → A 0., 6. és 7. osztály számlái nem kerülnek a mérlegbe és az eredménykimutatásba. | Szt. 160. § (2)–(5) | ✅ |
| 2.4 | Áfa csak főkönyvi számlaként: 466 Előzetesen felszámított áfa, 467 Fizetendő áfa, 468 Áfa elszámolási számla. → Nincs áfamodul, nincs bevallás. A bekerülési érték nem tartalmazza a levonható áfát (Szt. 47. § (3)), a nem levonható áfa része a bekerülési értéknek (47. § (2) b)). | Szt. 47. § (2)–(3); a számlaszámozás szakmai gyakorlat | ✅ az áfa kezelésére; ❓ a konkrét számlaszámokra |
| 2.5 | Az eredménykimutatás készülhet **összköltség-eljárással** (2. melléklet) vagy **forgalmi költség eljárással** (3. melléklet). Az 5. osztály a költségeket költségnemek szerint tartalmazza (anyagköltség, igénybe vett szolgáltatások, egyéb szolgáltatások, bérköltség, személyi jellegű egyéb kifizetések, bérjárulékok, értékcsökkenési leírás); összköltség-eljárásnál itt kell elkülöníteni az aktivált saját teljesítmények értékét is. → MVP: összköltség-eljárás; az 5. osztály kötelező, a 6–7. osztály opcionális. | Szt. 71. § (1)–(2), 160. § (3)–(4) | ✅ |

## 3. Bizonylati elv és bizonylati rend

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 3.1 | **Bizonylati elv:** minden olyan gazdasági műveletről, amely az eszközök vagy források állományát, összetételét megváltoztatja, **bizonylatot kell kiállítani**, és az összes bizonylat adatait rögzíteni kell. A nyilvántartásba **csak szabályszerűen kiállított bizonylat alapján** szabad adatot bejegyezni. Szabályszerű a bizonylat, ha a valóságnak megfelelően, hiánytalanul tartalmazza az adatokat, megfelel az alaki és tartalmi követelményeknek, és hiba esetén előírásszerűen javították. → A tétel mentése bizonylat (szám, kelt, típus) nélkül nem lehetséges. | Szt. 165. § (1)–(2) | ✅ |
| 3.2 | **Számviteli bizonylat** minden olyan okmány (számla, szerződés, megállapodás, kimutatás, hitelintézeti bizonylat, bankkivonat, jogszabályi rendelkezés, egyéb irat), amely a gazdasági esemény elszámolását alátámasztja. Adatainak **hitelesnek, megbízhatónak és helytállónak** kell lenniük. A bizonylatot a művelet időpontjában, **magyar nyelven** kell kiállítani; idegen nyelvű bizonylaton a könyveléshez szükséges adatokat rögzítés előtt magyarul is fel kell tüntetni. Az adatok időtállóságát a megőrzési időn belül biztosítani kell. Az Szt. a **helyesbítő számviteli bizonylatot** is nevesíti (például utólagos engedmény, visszáru). → Bizonylattípusok: kimenő és bejövő számla, bankkivonat, pénztárbizonylat, vegyes (belső) bizonylat, helyesbítő bizonylat. A bizonylaton megjegyzés (magyar megfeleltetés) rögzíthető. | Szt. 166. § (1)–(4), (6); 73. § (2) | ✅ |
| 3.3 | A bizonylat **általános alaki és tartalmi kellékei**: a) megnevezés és **sorszám vagy egyéb azonosító**; b) a kiállító gazdálkodó (szervezeti egység); c) az elrendelő, az **utalványozó**, a végrehajtást igazoló és (szervezettől függően) az **ellenőr** aláírása, pénzkezelési bizonylaton az átvevő, illetve befizető aláírása; d) a kiállítás időpontja, illetve a **teljesítés** időpontja vagy időszaka; e) a művelet tartalma, mennyiségi, minőségi és értékadatai; f) külső bizonylatnál a kiállító neve és címe; g) összesítő bizonylatnál az összesített bizonylatok köre és időszaka; h) **a könyvelés módja, az érintett könyvviteli számlák** (kontírozás); i) a **rögzítés időpontja és igazolása**; j) minden jogszabály által előírt adat. Elektronikus dokumentum is lehet bizonylat. → A bizonylat-adatmodell ezeket mezőként tartalmazza: a kiállítás, a teljesítés és a könyvelés dátuma külön mező; a kontírozás a tételsorokban van; a rögzítő és az időpont automatikus. | Szt. 167. § (1) a)–j), (5) | ✅ |
| 3.3a | A h) és i) pontot (kontírozás, rögzítés igazolása) úgy is lehet teljesíteni, hogy ezeket az adatokat az eredeti bizonylathoz **egyértelműen, az utólagos módosítást kizáró módon, logikailag** rendeljük hozzá; ez elektronikus nyilvántartással is teljesíthető. → A könyvelt tétel a bizonylathoz kötött, nem módosítható; a rögzítés adatait (ki, mikor) a rendszer és az audit napló igazolja. Nem kell papíron kontírozni. | Szt. 167. § (7) | ✅ |
| 3.4 | **Helyesbítés:** a szabályszerű bizonylatot hiba esetén **előírásszerűen** kell javítani; a rögzítés adatainál az utólagos módosítás lehetőségét ki kell zárni. A javítás konkrét módszerét (például áthúzás, sztornó) a törvény **nem** írja elő. → Könyvelt tétel nem törölhető és nem írható felül: **sztornó** és **helyesbítő** tétel van, mindkettő hivatkozik az eredetire, így az eredeti adat mindig látható. | Szt. 165. § (2), 167. § (7) | ✅ az elvre; ❓ a módszer tervezési döntés |
| 3.5 | Bizonylat-azonosítás: a törvény **sorszámot vagy egyéb azonosítót** ír elő. A **készpénzkezeléshez** kapcsolódó bizonylatok (pénztárbizonylatok, számla, nyugta) **szigorú számadás** alá tartoznak: a kibocsátónak olyan nyilvántartást kell vezetnie, amely biztosítja az elszámoltatásukat; a **rontott példányokat is meg kell őrizni**. → A belső bizonylatok (pénztár, vegyes, helyesbítő) sorszámát a rendszer adja **folyamatosan és hézagmentesen**, bizonylattípusonként és üzleti évenként (például PT-2026-00001); a kiadott sorszám nem törölhető, a hibás bizonylat sztornózva megmarad. Külső bizonylatnál (bejövő számla, bankkivonat) a partner sorszáma is tárolódik. | Szt. 167. § (1) a), 168. § (1)–(3), 169. § (3) | ✅ a szigorú számadásra; ❓ a hézagmentes számozás tervezési döntés (a szigorú számadás elszámoltathatóságát szolgálja) |
| 3.6 | Papíralapú bizonylatról készített **elektronikus másolattal** a megőrzési kötelezettség csak akkor teljesíthető, ha a másolatkészítés (a papíralapú dokumentumok elektronikus másolatáról szóló jogszabály szerint) biztosítja az összes adat **késedelem nélküli előállítását, folyamatos olvashatóságát**, és **kizárja az utólagos módosítást**. → MVP: a csatolt fájl **nem** minősül ilyen másolatnak; ezt a felületen is jelezzük. A csatolmány tartalmi hash-e tárolódik (felkészülés a későbbi archiválási modulra). | Szt. 169. § (6) | ✅ a szabályra; ⚠️ a másolatkészítési rendelet szövegét nem ellenőriztem |
| 3.7 | **Rögzítési határidők:** a pénzeszközöket érintő bizonylatokat **késedelem nélkül** kell könyvelni: készpénznél a pénzmozgással egyidejűleg, bankszámlánál a hitelintézeti értesítés megérkezésekor, egyéb pénzeszközöknél legkésőbb a **tárgyhót követő hó 15-éig**. Az egyéb bizonylatokat legalább **negyedévenként**, a számviteli politikában rögzített időpontig, legkésőbb a **tárgynegyedévet követő hó végéig** kell rögzíteni. → A rendszer figyelmeztet, ha egy tétel könyvelési dátuma a teljesítés után a határidőn túl van; a pénztárban a napi rögzítést segíti. A rögzítés időpontja minden tételnél tárolódik. | Szt. 165. § (3) a)–b) | ✅ |
| 3.8 | A főkönyvi könyvelés, az analitikus nyilvántartások és a bizonylatok közötti **egyeztetés és ellenőrzés lehetőségét logikailag zárt rendszerrel** kell biztosítani. → Minden tétel bizonylathoz, minden analitikus tétel főkönyvi tételhez kötött; a hivatkozások adatbázis-szinten kényszerítettek. | Szt. 165. § (4) | ✅ |

## 4. Napló, főkönyv, analitika, leltár

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 4.1 | A nyilvántartásnak a változásokat folyamatosan, **zárt rendszerben** kell mutatnia; a megőrzendő iratok között a törvény a **naplófőkönyvet vagy más, a törvény követelményeinek megfelelő nyilvántartást**, a **főkönyvi kivonatot**, valamint a főkönyvi számlákat és az analitikus nyilvántartásokat nevesíti. A napló és a főkönyv külön formáját a törvény nem írja elő. → Egy adatforrás: a naplótétel. A naplófőkönyv, a főkönyvi kivonat, a karton és a kimutatások ebből készülő lekérdezések. | Szt. 159. §, 169. § (1)–(2) | ✅ |
| 4.1a | **Főkönyvi kivonatot** a választott időszakonként, de legalább a beszámoló elkészítése és a számviteli adatokon alapuló adatszolgáltatás előtt kell készíteni, annak alátámasztására. → Főkönyvi kivonat bármely időszakra; az évzárás előfeltétele, hogy elkészüljön és mentésre kerüljön. | Szt. 164. § (2) | ✅ |
| 4.2 | Az üzleti év végi záráshoz el kell végezni a **főkönyvi könyvelés és az analitikus nyilvántartások egyeztetését** a mérlegfordulónapra. → Egyeztető kimutatás: vevő-, szállító-, bank- és pénztáranalitika összesen = főkönyvi egyenleg; eltérés esetén az évzárás figyelmeztet. | Szt. 69. § (2), 161. § (3) | ✅ |
| 4.3 | A mérleg tételeit **leltárral** kell alátámasztani, amely tételesen tartalmazza a fordulónapi eszközöket és forrásokat mennyiségben és értékben; a csak értékben kimutatott eszközöknél és kötelezettségeknél **egyeztetéssel**. → MVP: nyitott tételes vevő- és szállítólista, bank- és pénztáregyenleg fordulónapra (egyeztetési leltár exportja). Mennyiségi leltár és készletnyilvántartás az MVP-n kívül. | Szt. 69. § (1)–(4) | ✅ |
| 4.4 | Követelés a mérlegben addig szerepel, amíg pénzügyileg vagy egyéb módon (beszámítás, eszközátadás) nem rendezték, el nem engedték, illetve behajthatatlanként le nem írták. → A kiegyenlítés lehet banki, pénztári, beszámításos vagy leírás; a nyitott tétel ennek megfelelően zárul. | Szt. 65. § (6)–(7), 68. § (5) | ✅ |

## 5. Üzleti év, zárás, hibák javítása

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 5.1 | Az **üzleti év** a naptári év, ettől a 11. § (2)–(13) szerinti esetekben lehet eltérni; időtartama általában **12 naptári hónap**, de lehet rövidebb (előtársasági időszak, áttérés, átalakulás, végelszámolás). **Mikrogazdálkodói beszámolót készítőnél az üzleti év nem térhet el a naptári évtől.** → Üzleti évenként egyedi kezdő- és záródátum; az első év lehet töredékév. | Szt. 11. § (1)–(6) | ✅ |
| 5.2 | A teljesség elve miatt a fordulónapot követően, de a **mérlegkészítés időpontjáig** ismertté vált, az üzleti évre vonatkozó eseményeket még könyvelni kell. → Az évzárás kétlépcsős: a **fordulónap után** az év „zárlati” állapotba kerül (csak zárlati tételek rögzíthetők a fordulónapra), majd a beszámoló elkészülte után **véglegesen lezárul**. A havi időszakok közben külön zárhatók. | Szt. 3. § (6) 1., 15. § (2) | ✅ |
| 5.2a | A **könyvviteli zárlathoz** az üzleti év végén végzett kiegészítő, helyesbítő, egyeztető, összesítő könyvelési munkák és a **számlák technikai lezárása** tartoznak. → A zárlati tételek külön jelölést (zárlati tétel) kapnak; a technikai lezárás az 5.5 szerinti zárótételekkel történik. | Szt. 164. § (1) | ✅ |
| 5.3 | Lezárt időszakba új tétel nem rögzíthető, meglévő nem módosítható. Javítás a nyitott időszakban felvitt helyesbítő tétellel, amely hivatkozik az eredetire. A zárás feloldása csak külön jogosultsággal, indoklással és audit naplóval. | Szt. 12. § (1), 164. § (1), 165. § (2), 167. § (7) | ✅ az év végi lezárásra és a javítás követhetőségére; ❓ a havi lezárás informatikai megoldás |
| 5.4 | **Beszámolóval lezárt évet érintő hiba:** az ellenőrzés (önellenőrzés is) megállapítását a feltárás évében kell könyvelni. **Jelentős összegű** a hiba, ha az egy évet érintő hibák abszolút összege meghaladja a számviteli politikában rögzített határt, de mindenképp, ha meghaladja a mérlegfőösszeg 2%-át, illetve ha az nem haladja meg az 1 millió Ft-ot, akkor az 1 millió Ft-ot. A jelentős hibák hatását a mérlegben és az eredménykimutatásban **külön oszlopban** kell bemutatni; az előző évek eredményét érintő jelentős hiba az eredménytartalékon keresztül számolandó el; a nem jelentős hiba a tárgyévi adatok között szerepel. → A helyesbítő tételnél megjelölhető, hogy „előző évet érintő hiba (melyik év)”; a rendszer összesíti évenként, kiszámolja a jelentősségi küszöböt, és a kimutatásban külön oszlopban mutatja. | Szt. 3. § (3) 1–4., 19. § (3), 37. § (5), 71. § (3) | ✅ |
| 5.5 | **Év végi zárás és nyitás:** az eredménytétel-számlák lezárása, a mérlegszámlák nyitása a következő évben a záró egyenlegekkel (folytonosság). Az előző év adózott eredménye az eredménytartalékba kerül. → Automatikusan generált zárlati és nyitó tételek, előnézettel. | Szt. 15. § (6), 37. § (1) a), (2) a) | ✅ |
| 5.6 | **Közbenső mérleg:** a fordulónapra a nyilvántartásokat nem lehet lezárni, az értékelési korrekciók csak a közbenső mérlegben szerepelhetnek. → Kimutatás bármely napra elkészíthető zárás nélkül; MVP-ben nincs külön közbenső-mérleg-korrekció. | Szt. 21. § (4) | ✅ |

## 6. Beszámoló

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 6.1 | Beszámolóformák: éves beszámoló, egyszerűsített éves beszámoló, összevont (konszolidált) éves beszámoló, egyszerűsített beszámoló; ezen belül választható a **mikrogazdálkodói egyszerűsített éves beszámoló**. | Szt. 8. § (2), 9. § (6) | ✅ |
| 6.2 | **Egyszerűsített éves beszámoló** készíthető, ha két egymást követő évben a fordulónapon a három mutató közül bármelyik kettő nem haladja meg: mérlegfőösszeg **2000 millió Ft**, nettó árbevétel **4000 millió Ft**, átlagos létszám **50 fő**. **Mikrogazdálkodói** változat (könyvvizsgálatra nem kötelezettnek): **180 millió Ft**, **360 millió Ft**, **10 fő**. A mikro választásától legkorábban 3 lezárt év után lehet eltérni. → Tájékoztató értékhatár-ellenőrzés a cég adatai alapján. | Szt. 9. § (2), (6), (8)–(9); [S4] | ✅ |
| 6.3 | **Egyszerűsített éves beszámoló:** mérleg + eredménykimutatás + kiegészítő melléklet; üzleti jelentés nem kell. A mérleg az 1. melléklet „A” vagy „B” változatának, az eredménykimutatás a 2. vagy 3. mellékletnek a **nagybetűvel és római számmal jelölt tételeit** tartalmazza. Minden tételnél fel kell tüntetni az **előző év adatát**. → A számlatükörben a főkönyvi számlák mérleg-, illetve eredménykimutatás-sorokhoz rendelhetők (alapértelmezett hozzárendeléssel). A kimutatás tárgyév + előző év oszloppal, Ft-ban és ezer Ft-ban. A kimutatás **tájékoztató jellegű**, a hivatalos beszámolót az e-beszámoló felületen kell benyújtani. | Szt. 17. § (2), 19. § (3), 20. § (2), 22. § (1), 96. § (1)–(3) | ✅ |
| 6.3a | A mérleg és az eredménykimutatás sorainak **szövege és jelölése** az 1. melléklet („A” változat) és a 2. melléklet (összköltség-eljárás) szerint: mérleg A–C eszköz- és D–G forrásoldal (például A.I. Immateriális javak, B.II. Követelések, D.I. Jegyzett tőke, F.III. Rövid lejáratú kötelezettségek); eredménykimutatás I–X. sor, A. üzemi eredmény, B. pénzügyi eredmény, C. adózás előtti eredmény, D. adózott eredmény. → A sorok kódja és szövege a `packages/domain/src/report-lines.ts`-ben a melléklet szerint; az alapértelmezett számla–sor hozzárendelés a `report-mapping.ts`-ben; a hozzárendelés számlánként módosítható, a nem hozzárendelt számlákra a rendszer figyelmeztet. | Szt. 1. és 2. melléklet | ✅ |
| 6.4 | A mérleget, az eredménykimutatást és a kiegészítő mellékletet a képviseletre jogosult a hely és a kelet feltüntetésével aláírja. → A PDF-export aláírási blokkot tartalmaz (hely, kelet, képviselő neve). | Szt. 20. § (6) | ✅ |
| 6.5 | **Letétbe helyezés és közzététel:** a cégjegyzékbe bejegyzett, kettős könyvvitelt vezető vállalkozó az elfogadott (egyszerűsített) éves beszámolót a mérlegfordulónapot követő **5. hónap utolsó napjáig** köteles letétbe helyezni, és közzétenni. Ha a beszámolót könyvvizsgáló nem ellenőrizte, a mérlegen, az eredménykimutatáson és a kiegészítő mellékleten fel kell tüntetni: **„A közzétett adatok könyvvizsgálattal nincsenek alátámasztva.”** → MVP-n kívül (nincs e-beszámoló-beküldés). A tájékoztató kimutatás PDF-je beállítástól függően tartalmazza ezt a szöveget; a cégadatoknál jelölhető, hogy van-e könyvvizsgáló. Az évzárásnál a rendszer kiírja a letétbe helyezési határidőt. | Szt. 153. § (1), 154. § (1), (3) | ✅ |

## 7. Adatmegőrzés

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 7.1 | A beszámolót, a leltárt, az értékelést, a **főkönyvi kivonatot**, a **naplót** és a könyvviteli nyilvántartásokat legalább **8 évig** olvasható formában meg kell őrizni. A leltár megőrzését az Szt. 69. § (1) is előírja („e törvény előírásai szerint megőrizni”). | Szt. 169. § (1); 69. § (1) | ✅ |
| 7.2 | A könyvviteli elszámolást közvetlenül és közvetetten alátámasztó **bizonylatokat** (ideértve a főkönyvi számlákat, az analitikus és részletező nyilvántartásokat is) legalább **8 évig** olvasható formában, **a könyvelési feljegyzések hivatkozása alapján visszakereshető** módon meg kell őrizni. A szigorú számadású bizonylatok rontott példányaira is vonatkozik. Szervezeti változás (jogutód nélküli megszűnés is) nem szünteti meg a kötelezettséget. → Minden tételből a bizonylat egy kattintással elérhető, és fordítva; a cég megszüntetésekor teljes export készíthető. | Szt. 169. § (2)–(4) | ✅ |
| 7.2a | Az **elektronikus formában kiállított bizonylatot** elektronikus formában kell megőrizni (a digitális archiválásról szóló jogszabály figyelembevételével), úgy, hogy az összes adat késedelem nélkül előállítható, folyamatosan olvasható legyen, és az utólagos módosítás ki legyen zárva. | Szt. 169. § (5); [S6] | ✅ a szabályra; ⚠️ az [S6] részleteire |
| 7.3 | Az elektronikus számlát elektronikus formában kell megőrizni; a megőrzési idő végéig biztosítani kell az **eredet hitelességét, a sértetlenséget és az olvashatóságot**. | [S3] (Áfa tv. 179. § (2), Számlarendelet 3–7. §) | ✅ |
| 7.4 | Digitális archiválás: az [S6] rendelet szerint. → Az MVP **nem** hiteles archívum. A rögzített adatok a megőrzési időn belül nem törölhetők; az exportok hash-sel készülnek. A hiteles archiválás későbbi modul. | [S6] | ✅ a hivatkozásra; ❓ a megfelelés szintjére |
| 7.5 | Adózási iratok megőrzése az adó megállapításához való jog **elévüléséig** (általában 5 év). A 8 év a meghatározó. | Art. 78. § (3) [S10] | ⚠️ |
| 7.6 | → Megvalósítás: üzleti év, bizonylat és tétel a megőrzési idő előtt **nem törölhető fizikailag**; a törlés helyett sztornó van. A megőrzési határidőt a rendszer óvatosan számolja: a beszámoló elfogadását (ennek hiányában az üzleti év végét) követő 8. naptári év vége. | Szt. 169. § (1)–(2)-ből levezetve | ✅ a 8 évre; ❓ a törvény nem határozza meg a 8 év kezdőnapját, ezért óvatos becslés |

## 8. Naplózás, belső kontroll (audit log)

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 8.1 | A könyvelésnek **követhetőnek** kell lennie: ki, mikor, mit rögzített vagy módosított. → Hozzáfűzéses (append-only) audit napló: felhasználó, időpont, művelet, entitás, régi és új érték. Hash-lánccal védett. | Szt. 15. § (3) (valódiság: kívülálló által megállapítható); 167. § (1) i) (a rögzítés időpontja, igazolása); 167. § (7) (az utólagos módosítás kizárása) | ✅ a forrásokra; ❓ a törvény nem nevesít „audit logot”, a megoldás levezetett |
| 8.2 | Jogosultságok szétválasztása (rögzítő, zárást végző, olvasó, adminisztrátor). | Belső kontroll; Szt. 167. § (1) c) (elrendelő, utalványozó, ellenőr elkülönítése) | ✅ a forrásra; ❓ a szerepkörök kialakítása tervezési döntés |
| 8.3 | Belépési és sikertelen belépési események naplózása. | GDPR 32. cikk [S8] | ⚠️ |

## 9. Adatvédelem (GDPR)

| # | Követelmény | Forrás | Jel |
|---|---|---|---|
| 9.1 | Jogalap: a partnerek adatainak kezelése **jogi kötelezettség teljesítése** (Szt. 169. § ✅). | GDPR 6. cikk (1) c) [S8] | ⚠️ |
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

## Még nyitott források

Az Szt. szövege teljes. Továbbra sem láttam a következők szövegét (a rájuk épülő pontok ⚠️ jelűek, egyik sem az MVP könyvelési magja):

1. GDPR [S8] és Infotv. [S9] – a 9. fejezethez.
2. Art. 78. § [S10] – a 7.5 ponthoz (a 8 éves Szt.-megőrzés úgyis hosszabb).
3. 1/2018. ITM rendelet [S6] és a papíralapú dokumentumok elektronikus másolatáról szóló rendelet – a későbbi archiválási modulhoz.
4. Számlarendelet [S7] – csak a NAV-import részleteihez.

## Döntések (a megrendelő jóváhagyásával, 2026.10.20.)

1. **Beszámoló:** az MVP tájékoztató jelleggel az **egyszerűsített éves beszámoló** mérlegét („A” változat) és **összköltség-eljárású** eredménykimutatását állítja elő.
2. **Pénznem:** az MVP forintban vezeti a könyveket. A devizás bizonylatoknál az **eredeti devizanemet, a devizaösszeget, az alkalmazott árfolyamot, annak forrását és dátumát** is tárolni kell, hogy a devizás könyvvezetés később bővíthető legyen.
3. **Hiteles archiválás:** későbbi modul, de az **adatmodellnek fel kell rá készülnie** (megőrzési határidő, tartalmi hash, hitelesítési mezők).
4. **Régi kód:** a repository meglévő kódja érintetlen marad; az új projekt a `konyvelo/` könyvtárban készül.
