/**
 * Súgószövegek a szakkifejezésekhez. Egy helyen vannak, hogy könnyen
 * bővíthetők és ellenőrizhetők legyenek. A felületen a ⓘ ikon mutatja őket.
 */
export const GLOSSARY = {
  uzletiEv: {
    title: "Üzleti év",
    text: "Az az időszak, amelyről a beszámolót készíteni kell. Általában megegyezik a naptári évvel (január 1. – december 31.), és legfeljebb 12 hónap (Szt. 11. §).",
  },
  merlegfordulonap: {
    title: "Mérlegfordulónap",
    text: "Az üzleti év utolsó napja. Erre a napra készül a mérleg. Naptári évnél december 31.",
  },
  idoszak: {
    title: "Időszak",
    text: "Az üzleti év egy hónapja. A havi időszakok külön lezárhatók; lezárt időszakba nem lehet könyvelni, a javítás helyesbítő tétellel történik.",
  },
  kivetelesEv: {
    title: "12 hónapnál hosszabb üzleti év",
    text: "Csak kivételes esetben lehetséges, pl. az alapítás előtti, ún. előtársasági időszakban (Szt. 11. § (5)). Ilyenkor az indoklást rögzíteni kell.",
  },
  adoszam: {
    title: "Adószám",
    text: "A cég 11 jegyű adószáma (12345678-1-12). Az első 8 jegy a törzsszám, ennek utolsó jegye ellenőrző számjegy – a rendszer ezt automatikusan ellenőrzi.",
  },
  beszamoloForma: {
    title: "Beszámolóforma",
    text: "Egyszerűsített éves beszámolót az a vállalkozó készíthet, amelynél két egymást követő évben a mérlegfőösszeg (2000 millió Ft), a nettó árbevétel (4000 millió Ft) és az átlagos létszám (50 fő) közül legalább kettő nem lépi túl a határt. A mikrogazdálkodói változat határai: 180 millió Ft, 360 millió Ft, 10 fő (Szt. 9. §).",
  },
  jelentosHiba: {
    title: "Jelentős összegű hiba értékhatára",
    text: "A számviteli politikában rögzített határ. Jelentős a hiba, ha az egy évet érintő hibák együttes összege meghaladja ezt – de mindenképp jelentős, ha meghaladja a mérlegfőösszeg 2%-át, illetve legalább az 1 millió Ft-ot (Szt. 3. § (3) 3.).",
  },
  arfolyamForras: {
    title: "Árfolyamforrás",
    text: "A devizás tételek forintra számításához használt árfolyam: a választott hitelintézet vételi és eladási árfolyamának átlaga, az MNB vagy az EKB hivatalos árfolyama, vagy – a számviteli politika szerint – az áfatörvény szerinti árfolyam (Szt. 60. §).",
  },
  konyvPenzneme: {
    title: "A könyvvezetés pénzneme",
    text: "A rendszer forintban vezeti a könyveket. Devizás bizonylatnál az eredeti devizaösszeg és az alkalmazott árfolyam is tárolódik.",
  },
  szerepkor: {
    title: "Szerepkörök",
    text: "Adminisztrátor: mindent megtehet. Vezető könyvelő: könyvel, kezeli az üzleti éveket, lezárja az időszakokat. Könyvelő: rögzít és könyvel. Megtekintő: csak olvas.",
  },
  auditNaplo: {
    title: "Audit napló",
    text: "Minden módosítás nyoma: ki, mikor, mit változtatott. A bejegyzések láncba fűzött ellenőrzőkóddal (hash) védettek, így egy utólagos módosítás kimutatható. A naplót nem lehet törölni vagy átírni.",
  },
  kezdoJelszo: {
    title: "Kezdő jelszó",
    text: "Új felhasználónál Ön adja meg a kezdő jelszót, és biztonságos úton közli vele. Első belépéskor a rendszer kéri a jelszó cseréjét.",
  },
  szamlatukor: {
    title: "Számlatükör",
    text: "A cég főkönyvi számláinak jegyzéke az egységes számlakeret 0–9. számlaosztálya szerint. Az új cég egy alapértelmezett mintával indul, amelyet a cég számlarendje szerint szabadon módosíthat (Szt. 161. §).",
  },
  gyujtoszamla: {
    title: "Gyűjtőszámla",
    text: "Olyan számla, amelynek alszámlái vannak (pl. a 38 Pénzeszközök). Gyűjtőszámlára nem lehet könyvelni, csak a legalsó szintű alszámlákra.",
  },
  analitika: {
    title: "Analitika",
    text: "Részletező nyilvántartás egy főkönyvi számlához: vevőknél és szállítóknál partnerenként és számlánként (nyitott tételek), banknál bankszámlánként, pénztárnál pénztáranként. Év végén egyeztetni kell a főkönyvvel (Szt. 69. § (2)).",
  },
  szokasosEgyenleg: {
    title: "Szokásos egyenleg",
    text: "Melyik oldalon szokott egyenlege lenni a számlának: eszközök és költségek tartozik, források és bevételek követel oldalon. Az értékcsökkenést és értékvesztést gyűjtő eszköz-ellenszámlák követel egyenlegűek.",
  },
  szamlaJelleg: {
    title: "Számla jellege",
    text: "Meghatározza, hová kerül a számla a kimutatásokban: eszköz és forrás a mérlegbe, költség és bevétel az eredménykimutatásba. A nyilvántartási (0.) és az évnyitó/évzáró (49.) számlák egyikbe sem.",
  },
  alapertelmezettKontirozas: {
    title: "Alapértelmezett kontírozás",
    text: "A partner tételeinek rögzítésekor ezeket a számlákat javasolja a rendszer (pl. a szállítónál 454 Szállítók és a szokásos költségszámla). Rögzítéskor bármikor módosíthatók.",
  },
  kimutatasSor: {
    title: "Kimutatássor",
    text: "Hová kerül a számla egyenlege a beszámolóban: a mérleg „A” változatának (Szt. 1. számú melléklet), illetve az összköltséges eredménykimutatásnak (Szt. 2. számú melléklet) melyik sorába. A mérlegsor függhet az egyenleg oldalától (pl. bankszámla követel egyenlege = rövid lejáratú hitel).",
  },
  maganszemely: {
    title: "Magánszemély partner",
    text: "Magánszemélynél csak a könyveléshez szükséges adatokat tároljuk (adattakarékosság, GDPR 5. cikk (1) c)); adószámot nem. A megőrzési idő alatt az adatai nem törölhetők.",
  },
  bizonylat: {
    title: "Bizonylat",
    text: "A gazdasági műveletet alátámasztó irat (számla, bankkivonat, pénztárbizonylat, belső bizonylat). Könyvelni csak szabályszerű bizonylat alapján lehet (Szt. 165–167. §). Könyveléskor a rendszer típusonként és üzleti évenként folyamatos sorszámot ad.",
  },
  kelt: {
    title: "Kelt",
    text: "A bizonylat kiállításának napja (Szt. 167. § (1) d)). Számlánál a számla kelte, bankkivonatnál a kivonat napja.",
  },
  teljesites: {
    title: "Teljesítés",
    text: "Az a nap vagy időszak, amikor a gazdasági művelet megtörtént (pl. a szolgáltatás teljesítése). A rögzítési határidő ettől számít (Szt. 165. § (3)).",
  },
  konyvelesDatuma: {
    title: "Könyvelés dátuma",
    text: "Erre a napra kerül a tétel a naplóba és a főkönyvbe; ez határozza meg az üzleti évet és a havi időszakot. Lezárt időszakra nem lehet könyvelni.",
  },
  tartozikKovetel: {
    title: "Tartozik és követel",
    text: "A kettős könyvvitelben minden gazdasági műveletet két (vagy több) számlán, ellentétes oldalon kell könyvelni. A tartozik oldal a számla bal, a követel a jobb oldala. Egy bizonylaton a tartozik és a követel összegnek egyeznie kell.",
  },
  sztorno: {
    title: "Sztornó",
    text: "Egy könyvelt bizonylat teljes visszavezetése: új, saját sorszámú bizonylat ugyanazokkal a tételekkel – a cég beállítása szerint fordított oldalon vagy negatív előjellel. Az eredeti bizonylat változatlanul látható marad (Szt. 165. § (2), 167. § (7)).",
  },
  sztornoModja: {
    title: "A sztornó módja",
    text: "Fordított oldalon: a sztornó ugyanazokat az összegeket a másik oldalra könyveli (a számlák forgalma mindkét oldalon nő). Negatív előjellel („piros sztornó”): ugyanazon az oldalon, mínusz összeggel könyvel, így a forgalom nem nő. A törvény egyiket sem írja elő; a számviteli politikában kell rögzíteni.",
  },
  helyesbito: {
    title: "Helyesbítő bizonylat",
    text: "Egy könyvelt bizonylat részleges javítása: csak a különbözetet könyveli, és hivatkozik az eredetire. Ha az eredeti egy korábbi üzleti évbe tartozik, a rendszer előző évet érintő hibaként jelöli (Szt. 3. § (3)).",
  },
  kiegyenlites: {
    title: "Kiegyenlítés (párosítás)",
    text: "Melyik fizetés melyik számlát egyenlíti ki. A nyitott tétel a még ki nem fizetett számla (vevőnél követelés, szállítónál tartozás). Egy fizetés több számlát, egy számlát több részfizetés is kiegyenlíthet; a párosítatlan rész túlfizetésként marad (Szt. 65. § (6)).",
  },
  rogzitesiHatarido: {
    title: "Rögzítési határidő",
    text: "Pénztári tételt a pénzmozgással egyidejűleg, banki tételt a kivonat megérkezésekor (a rendszer legkésőbb a tárgyhót követő hó 15-ét figyeli), egyéb bizonylatot legkésőbb a tárgynegyedévet követő hó végéig kell könyvelni (Szt. 165. § (3)).",
  },
  kontirozasiSablon: {
    title: "Kontírozási sablon",
    text: "Gyakori könyvelések mintája (pl. szállítói számla: költség tartozik nettó, 466 tartozik áfa, 454 követel bruttó). Rögzítéskor az Alt+L-lel választható; a beírt összegből kitölti a sorokat.",
  },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
