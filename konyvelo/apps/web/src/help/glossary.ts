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
  maganszemely: {
    title: "Magánszemély partner",
    text: "Magánszemélynél csak a könyveléshez szükséges adatokat tároljuk (adattakarékosság, GDPR 5. cikk (1) c)); adószámot nem. A megőrzési idő alatt az adatai nem törölhetők.",
  },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
