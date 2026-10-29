/**
 * Felhasználói súgó kezdőknek (K8.3): a fő műveletek lépésről lépésre, egyszerű magyar nyelven.
 * A gombok és mezők neve pontosan az, ami a képernyőn látszik. Ha a felület változik, itt is javítani kell.
 */

export type GuideTopic = {
  id: string;
  title: string;
  /** Mire jó, egy-két mondatban. */
  intro: string;
  steps: string[];
  /** Jó tudni: tipp vagy figyelmeztetés. */
  tips?: string[];
  /** Hová visz a „Megnyitás” gomb. */
  link?: { to: string; label: string };
};

export const GUIDE: GuideTopic[] = [
  {
    id: "elso-lepesek",
    title: "Első lépések",
    intro: "Mielőtt könyvelni kezd, a programnak tudnia kell, melyik cégről és melyik évről van szó.",
    steps: [
      "Kattintson a Beállítások menüpontra, majd az „Új cég felvétele” pontra. Írja be a cég nevét és adószámát, majd mentse.",
      "Beállítások → Üzleti évek: hozza létre az üzleti évet. Általában január 1-jétől december 31-ig tart; a program ezt javasolja.",
      "Beállítások → Számlatükör: a program betölt egy kész számlatükröt. Ezt elég átnézni; új alszámlát akkor vegyen fel, ha szüksége van rá.",
      "Partnerek → Új partner: vegye fel a vevőket és a szállítókat. Ha megadja a partnernél a szokásos könyvelési számlákat, később a program ezeket ajánlja.",
    ],
    tips: ["A fejlécben mindig látszik, melyik cég és melyik üzleti év van kiválasztva. Több cég esetén ott válthat."],
    link: { to: "/beallitasok/uzleti-evek", label: "Üzleti évek megnyitása" },
  },
  {
    id: "szallitoi-szamla",
    title: "Szállítói számla rögzítése (amit a cég kapott)",
    intro: "Minden kapott számlát bizonylatként kell rögzíteni. A program kiszámolja, hogy egyezik-e a két oldal.",
    steps: [
      "Kattintson a fejlécben az „Új tétel” gombra (vagy nyomja meg az F2 billentyűt).",
      "A „Bizonylat típusa” mezőben válassza a „Szállítói számla (bejövő)” típust.",
      "A „Partner” mezőbe kezdje el beírni a szállító nevét, és válassza ki a listából.",
      "Írja be a szállító számlaszámát, a leírást és a kelt dátumát. A teljesítés és a könyvelés dátuma magától kitöltődik.",
      "Nyomja meg az Alt+L billentyűt, válassza a partner szokásos kontírozását vagy egy sablont, és írja be a bruttó összeget. A sorok kitöltődnek.",
      "Nézze meg a táblázat alján: „A tartozik és követel oldal egyezik.” Ha nem egyezik, a program kiírja az eltérést.",
      "Ctrl+Enter: megjelenik az előnézet. Ha minden rendben, nyomja meg az Entert, és a bizonylat könyvelve van.",
    ],
    tips: [
      "Ha még nem biztos valamiben, mentse piszkozatként. A piszkozat bármikor módosítható vagy törölhető; a könyvelt bizonylat már nem.",
      "A Kezdőlap Teendői figyelmeztetnek, ha egy piszkozatot a törvény szerint már könyvelni kellett volna.",
    ],
  },
  {
    id: "csatolmany",
    title: "A számla PDF-jének vagy fényképének csatolása",
    intro: "A bizonylathoz feltöltheti az eredeti számla beszkennelt PDF-jét vagy fényképét, így később egy kattintással megnézheti.",
    steps: [
      "Mentse a bizonylatot piszkozatként (vagy nyisson meg egy már könyvelt bizonylatot).",
      "A „Csatolmányok” részben kattintson a „Fájl feltöltése” gombra, és válassza ki a fájlt. PDF, JPEG vagy PNG lehet.",
      "A feltöltött fájl megjelenik a listában. A nevére vagy az „Előnézet” gombra kattintva ugyanezen az oldalon megnyílik; az Esc billentyű bezárja.",
      "Ha könyvelés előtt rossz fájlt töltött fel, a „Törlés” gombbal eltávolíthatja.",
    ],
    tips: [
      "A program a fájl tartalmát is ellenőrzi: ha egy fájl csak át lett nevezve (pl. egy kép .pdf végződéssel), nem fogadja el.",
      "Könyvelt bizonylat csatolmánya már nem törölhető (a törvény szerint az eredetinek meg kell maradnia), de újabb csatolmány feltölthető mellé.",
      "Minden csatolmány ujjlenyomatot (SHA-256) kap. Beállítások → Audit napló → „Sértetlenség ellenőrzése”: kiderül, ha egy fájlt utólag kicseréltek.",
    ],
  },
  {
    id: "integracio",
    title: "A Készletből érkező tételek jóváhagyása",
    intro: "Ha a cég Készletfigyelője össze van kötve a Könyvelővel, a Készletben véglegesített beszerzésekből és eladásokból itt piszkozat lesz. Ezeket Önnek kell jóváhagynia.",
    steps: [
      "Első alkalommal: Beállítások → Integráció → „Kapcsolódási kód készítése”. A kódot adja meg a közös felületen (vagy az üzemeltetőnek). Az adószám önmagában nem elég.",
      "Ugyanitt ellenőrizze a számla-hozzárendelést (pl. Áruk: 261, ELÁBÉ: 814). A program az alapértelmezett számlatükörből előre kitölti.",
      "Ha tételek érkeztek, a Kezdőlapon megjelenik: „… tétel érkezett a Készletből jóváhagyásra”. Kattintson rá.",
      "A tételek napra és fajtára (beszerzés, ELÁBÉ, sztornó) csoportosítva látszanak. A hiányos tételnél az ok is ott van; a nevére kattintva javíthatja.",
      "Jelölje ki a hiánytalan tételeket (egyenként, vagy a csoport összes hiánytalan tételét egyszerre).",
      "Ha a beszerzésnél a bevételezés és a számla dátuma eltér, válassza ki, melyik legyen a könyvelés dátuma.",
      "Kattintson „A kijelölt … tétel könyvelése” gombra, nézze át az összesítést, majd „Könyvelés”.",
    ],
    tips: [
      "Az első hónapban minden beérkező tétel piszkozat („csak piszkozat” mód). Utána a program emlékeztet, de magától nem kapcsol át.",
      "Az ELÁBÉ mindig az Ön jóváhagyásával könyvelődik, akkor is, ha automatikus módra kapcsol.",
      "Minden ilyen bizonylaton látszik, honnan jött („Kapcsolat a többi programmal”).",
    ],
    link: { to: "/konyveles/jovahagyas", label: "Jóváhagyás megnyitása" },
  },
  {
    id: "vevoszamla",
    title: "Vevőszámla rögzítése (amit a cég kiállított)",
    intro: "Ugyanúgy megy, mint a szállítói számla, csak a típus és a partner más.",
    steps: [
      "„Új tétel” → „Bizonylat típusa”: „Vevőszámla (kimenő)”.",
      "Válassza ki a vevőt, írja be a számlaszámot, a keltet és a fizetési határidőt.",
      "Alt+L: válasszon sablont, és írja be a bruttó összeget (vevőszámlánál: vevő tartozik, árbevétel és fizetendő áfa követel).",
      "Ctrl+Enter, majd Enter: könyvelés.",
    ],
  },
  {
    id: "bank",
    title: "Banki kifizetés vagy jóváírás, a számla kiegyenlítése",
    intro: "Amikor a cég kifizet egy számlát, vagy a vevő fizet, banki bizonylatot kell rögzíteni, és megjelölni, melyik számlát egyenlíti ki.",
    steps: [
      "„Új tétel” → „Bizonylat típusa”: „Banki bizonylat (kivonat)”.",
      "Válassza ki a partnert. A program felajánlja a partner nyitott (még ki nem fizetett) számláit.",
      "Jelölje ki, melyik számlát egyenlíti ki a fizetés. A tételsorokat a program kitölti.",
      "Ctrl+Enter, majd Enter: könyvelés. A számla ezután már nem szerepel a nyitott tételek között.",
    ],
    tips: ["Könyvelés → Bank és pénztár: itt látja a bankszámla mozgásait, és összevetheti a bankkivonat záró egyenlegével."],
    link: { to: "/konyveles/penzeszkozok", label: "Bank és pénztár megnyitása" },
  },
  {
    id: "penztar",
    title: "Készpénz: pénztárbizonylat",
    intro: "Készpénzes bevételhez pénztárbevételi, kiadáshoz pénztárkiadási bizonylat kell.",
    steps: [
      "„Új tétel” → „Pénztárbevételi bizonylat” vagy „Pénztárkiadási bizonylat”.",
      "Töltse ki a leírást, a dátumot és a sorokat, majd könyvelje.",
    ],
    tips: ["A pénztár egyenlege nem lehet negatív: a program nem engedi kiadni azt a pénzt, ami még nincs a pénztárban."],
  },
  {
    id: "javitas",
    title: "Hibás bizonylat javítása",
    intro: "Könyvelt bizonylatot a törvény szerint nem lehet átírni vagy törölni. A javítás két módja a sztornó és a helyesbítés.",
    steps: [
      "Nyissa meg a hibás bizonylatot a Könyvelés listájából.",
      "Ha az egész bizonylat téves (például kétszer rögzítették): „Sztornózás”. Adja meg az okát; a program fordított tételekkel ellenkönyveli.",
      "Ha csak egy összeg változott (például árengedmény): „Helyesbítő bizonylat”. Csak a különbözetet kell rögzíteni.",
    ],
    tips: ["Mindkét bizonylat hivatkozik az eredetire, így később is látszik, mi történt."],
  },
  {
    id: "nav-import",
    title: "NAV-ból jött számlák átvétele",
    intro: "A NAV-hoz beküldött számlákat a program le tudja kérni, és javaslatot tesz a könyvelésükre. Könyvelt bizonylat csak az Ön jóváhagyásával lesz belőlük.",
    steps: [
      "Egyszer: a cég eÁFA-felületén készítsen kapcsolódási kódot (Ügyfél → Könyvelő-hozzáférés), majd itt: Beállítások → NAV-kapcsolat, írja be a kódot, és nyomja meg az „Összekapcsolás” gombot.",
      "Könyvelés → NAV-import: válassza ki, hogy bejövő vagy kimenő számlákat kér, és adja meg az időszakot. Nyomja meg a „Lekérdezés indítása” gombot.",
      "Kattintson egy számlára. Nézze át a javaslatot: partner, költség- vagy árbevétel-számla, összegek.",
      "Ha rendben van: „Jóváhagyás és könyvelés”. Ha még javítana rajta: „Átvétel piszkozatként”, és szerkessze a bizonylatok között.",
    ],
    tips: [
      "A NAV-adat nem mindig azonos a papír számlával. A bizonylat mindig az eredeti számla; vesse össze vele.",
      "Ha a NAV-kapcsolat elromlik (például lejárt a jelszó az eÁFA-ban), a Kezdőlap Teendői között megjelenik.",
    ],
    link: { to: "/konyveles/nav-import", label: "NAV-import megnyitása" },
  },
  {
    id: "kimutatasok",
    title: "Kimutatások: főkönyvi kivonat, mérleg, eredmény",
    intro: "A kimutatásokat a program mindig a könyvelt bizonylatokból számolja.",
    steps: [
      "Kattintson a Kimutatások menüpontra. Elsőként a főkönyvi kivonat látszik.",
      "Fent válassza ki az időszakot. A felső fülekkel válthat a naplófőkönyv, a karton, a mérleg és az eredménykimutatás között.",
      "Az „Excel (.xlsx)”, a „CSV” és a „Nyomtatás / PDF” gombbal a kimutatás menthető vagy nyomtatható.",
    ],
    link: { to: "/kimutatasok", label: "Kimutatások megnyitása" },
  },
  {
    id: "havi-zaras",
    title: "Havi zárás",
    intro: "Ha egy hónap könyvelése kész, zárja le, hogy oda tévedésből ne lehessen könyvelni.",
    steps: [
      "Kattintson a Zárás menüpontra. A „Havi időszakok” részben látszik minden hónap állapota.",
      "A lezárandó hónapnál nyomja meg a „Lezárás” gombot. A program előtte ellenőrzi, maradt-e piszkozat.",
      "Ha mégis javítani kell, az Adminisztrátor indoklással feloldhatja („Feloldás”).",
    ],
    link: { to: "/zaras", label: "Zárás megnyitása" },
  },
  {
    id: "evzaras",
    title: "Évzárás és az új év nyitása",
    intro: "Az év végén a program elkészíti a záró és a következő év nyitó bizonylatát.",
    steps: [
      "Előbb hozza létre a következő üzleti évet (Beállítások → Üzleti évek).",
      "Zárás → „Zárlat indítása”: ettől kezdve csak a fordulónapra lehet zárlati tételt könyvelni (például értékcsökkenés, adó).",
      "Nézze át az ellenőrzéseket és a záró bizonylat előnézetét.",
      "Az „Évzárás véglegesítése” gombbal zárja le az évet; megerősítésként be kell írni a cég rövid nevét.",
    ],
    tips: ["Lezárt évet csak az Adminisztrátor nyithat újra, indoklással; ilyenkor a program sztornózza a záró és a nyitó bizonylatot."],
  },
  {
    id: "mentes",
    title: "Mentés és cégexport",
    intro: "Kétféle biztonsági másolat van. A teljes mentés az egész programról készül, és az üzemeltető állítja be. A cégexport egy cég összes adata egy letölthető csomagban.",
    steps: [
      "Beállítások → Mentés és export → „Cégexport letöltése”. Egy ZIP-fájlt kap, benne táblázatokkal (Excelben megnyithatók) és egy tartalomjegyzékkel.",
      "Tegye a fájlt biztos helyre, például egy külső lemezre.",
      "Később ugyanitt az „Export ellenőrzése” résznél kiválaszthatja a fájlt. A program megmondja, hogy sértetlen-e, és hogy ez a program készítette-e.",
    ],
    tips: ["A teljes mentést és a visszaállítást az üzemeltető végzi (npm run backup, npm run restore). A leírás a README-ben van."],
    link: { to: "/beallitasok/mentes", label: "Mentés és export megnyitása" },
  },
  {
    id: "gyorsbillentyuk",
    title: "Gyorsbillentyűk",
    intro: "A legtöbb munka egérrel és billentyűzettel is elvégezhető. A gyorsbillentyűk listáját bármikor megnyithatja a ? billentyűvel.",
    steps: [
      "F2 vagy Alt+N: új tétel (ha nem egy beviteli mezőben áll, az N billentyű is jó).",
      "Alt+L: kontírozási sablon választása rögzítés közben.",
      "Ctrl+Enter: előnézet, majd Enter: könyvelés.",
      "Esc: mégse. A tételsorokban Enter vagy Tab: következő mező.",
      "Összegmezőben az = jel beírja a még hiányzó különbözetet.",
    ],
  },
];
