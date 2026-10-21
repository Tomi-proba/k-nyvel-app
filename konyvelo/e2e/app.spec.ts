import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Végponttól végpontig: első indítás, cég és üzleti év felvétele,
 * gyorsbillentyűk, felhasználókezelés, audit napló – és minden fontos
 * oldalon WCAG 2.1 AA akadálymentességi ellenőrzés (világos és sötét téma).
 */

test.describe.configure({ mode: "serial" });

const ADMIN = { name: "Admin Anna", email: "admin@example.hu", password: "nagyon-titkos-jelszo-123" };

async function expectAccessible(page: Page, label: string) {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const summary = result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
    expect(summary, `${label} – ${theme} téma`).toEqual([]);
  }
  await page.evaluate(() => delete document.documentElement.dataset.theme);
}

/** Összeg a mezőben: az ezres tagolás nem törő szóköz. */
const amount = (text: string) => new RegExp(`^${text.replace(/ /g, "\\s")}$`);

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("E-mail-cím").fill(ADMIN.email);
  await page.getByLabel("Jelszó").fill(ADMIN.password);
  await page.getByRole("button", { name: "Belépés" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Kezdőlap" })).toBeVisible();
}

test("első indítás: hibaüzenetek, majd az első felhasználó létrehozása", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Első indítás" })).toBeVisible();
  await expectAccessible(page, "Első indítás");

  await page.getByLabel("Név").fill(ADMIN.name);
  await page.getByLabel("E-mail-cím").fill("nem-email");
  await page.getByLabel("E-mail-cím").blur();
  await expect(page.getByText("Érvénytelen e-mail-cím.")).toBeVisible();
  await page.getByLabel("E-mail-cím").fill(ADMIN.email);
  await page.getByLabel("Jelszó").fill("rovid");
  await page.getByLabel("Jelszó").blur();
  await expect(page.getByText("A jelszó legalább 12 karakter legyen.")).toBeVisible();
  await page.getByLabel("Jelszó").fill(ADMIN.password);
  await page.getByRole("button", { name: "Létrehozás és belépés" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Kezdőlap" })).toBeVisible();
  await expect(page.getByText("Még nincs cége")).toBeVisible();
  await expectAccessible(page, "Kezdőlap cég nélkül");
});

test("főmenü: 6 menüpont", async ({ page }) => {
  await login(page);
  const nav = page.getByRole("navigation", { name: "Főmenü" });
  await expect(nav.getByRole("link")).toHaveText(["Kezdőlap", "Könyvelés", "Partnerek", "Kimutatások", "Zárás", "Beállítások"]);
});

test("cég felvétele: azonnali hibaüzenet hibás adószámnál, majd sikeres mentés", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Új cég létrehozása" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Új cég felvétele" })).toBeVisible();
  await expectAccessible(page, "Új cég");

  await page.getByLabel("Cégnév").fill("Minta Kereskedelmi Kft.");
  await page.getByLabel("Rövid név").fill("Minta Kft.");
  await page.getByRole("textbox", { name: "Adószám", exact: true }).fill("10773382-2-44");
  await page.getByRole("textbox", { name: "Adószám", exact: true }).blur();
  await expect(page.getByText(/ellenőrző számjegye hibás/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Adószám", exact: true })).toHaveAttribute("aria-invalid", "true");

  await page.getByRole("textbox", { name: "Adószám", exact: true }).fill("10773381-2-44");
  await page.getByLabel("Jelentős összegű hiba értékhatára (Ft)").fill("1 500 000");
  // Ctrl+Enter beküldés
  await page.getByLabel("Cégnév").press("Control+Enter");

  await expect(page.getByRole("heading", { level: 1, name: "Üzleti évek" })).toBeVisible();
  await expect(page.getByRole("status").getByText(/cég létrejött/)).toBeVisible();
  await expect(page.getByLabel("Cég", { exact: true })).toHaveValue(/.+/);
});

test("üzleti év: javasolt dátumok, magyar dátumformátum, 12 havi időszak", async ({ page }) => {
  await login(page);
  await page.goto("/beallitasok/uzleti-evek");
  const start = page.getByLabel("Kezdő nap");
  const end = page.getByLabel("Mérlegfordulónap (utolsó nap)");
  await expect(start).toHaveValue(/^\d{4}\.01\.01\.$/);
  await expect(end).toHaveValue(/^\d{4}\.12\.31\.$/);
  await expectAccessible(page, "Üzleti év űrlap");

  // Gyors bevitel: "20260101" → "2026.01.01."
  await start.fill("20260101");
  await start.blur();
  await expect(start).toHaveValue("2026.01.01.");
  await end.fill("2026.12.31");
  await end.blur();
  await expect(end).toHaveValue("2026.12.31.");
  await page.getByRole("button", { name: "Üzleti év létrehozása" }).click();

  await expect(page.getByRole("heading", { level: 2, name: "2026" })).toBeVisible();
  await page.getByText("Havi időszakok (12)").click();
  await expect(page.getByRole("cell", { name: "2026. február" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "2026.02.28." })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Üzleti év", exact: true })).toContainText("Üzleti év: 2026");
  await expectAccessible(page, "Üzleti évek listája");
});

test("gyorsbillentyűk: Alt+N, F2, N; AltGr+N nem; ? súgó; tooltip", async ({ page }) => {
  await login(page);

  await page.keyboard.press("F2");
  await expect(page).toHaveURL(/\/konyveles\/uj$/);

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Kezdőlap" })).toBeVisible();
  await page.keyboard.press("n");
  await expect(page).toHaveURL(/\/konyveles\/uj$/);

  // Beviteli mezőben az N betű gépelés, nem gyorsbillentyű; az Alt+N viszont működik.
  await page.goto("/beallitasok/ceg");
  const city = page.getByLabel("Település");
  await expect(city).toBeEditable();
  await city.fill("");
  await city.press("n");
  await expect(page).toHaveURL(/\/beallitasok\/ceg$/);
  await expect(city).toHaveValue("n");
  // AltGr+N (= Ctrl+Alt+N) a magyar billentyűzeten „}” – nem nyithat új tételt.
  await city.press("Control+Alt+n");
  await expect(page).toHaveURL(/\/beallitasok\/ceg$/);
  await city.press("Alt+n");
  await expect(page).toHaveURL(/\/konyveles\/uj$/);

  // Tooltip a gombon, billentyűzetes fókusszal is.
  await page.getByRole("button", { name: "Új tétel" }).focus();
  await expect(page.getByRole("tooltip")).toContainText("Alt+N, F2 vagy N");

  // ? → gyorsbillentyű-súgó (a kezdőlapon, ahol nincs beviteli mező)
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Kezdőlap" })).toBeVisible();
  await page.keyboard.press("Shift+?");
  const dialog = page.getByRole("dialog", { name: "Gyorsbillentyűk" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Kontírozási sablon választása");
  await expect(dialog).toContainText("Alt");
  await expectAccessible(page, "Gyorsbillentyű-súgó");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("felhasználók: hozzáadás, megerősítés eltávolítás előtt", async ({ page }) => {
  await login(page);
  await page.goto("/beallitasok/felhasznalok");
  await expect(page.getByRole("heading", { level: 1, name: "Felhasználók" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Admin Anna (Ön)" })).toBeVisible();

  await page.getByLabel("E-mail-cím").fill("kata@example.hu");
  await page.getByLabel("Név").fill("Könyvelő Kata");
  await page.getByRole("textbox", { name: "Kezdő jelszó" }).fill("kezdo-jelszo-12345");
  await page.getByRole("button", { name: "Hozzáadás" }).click();
  await expect(page.getByRole("cell", { name: "Könyvelő Kata", exact: true })).toBeVisible();
  await expectAccessible(page, "Felhasználók");

  await page.getByRole("button", { name: "Eltávolítás: Könyvelő Kata" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("nem fér hozzá");
  await expectAccessible(page, "Megerősítő ablak");
  // A fókusz a „Mégse” gombon van, az Enter nem töröl.
  await expect(confirm.getByRole("button", { name: "Mégse" })).toBeFocused();
  await confirm.getByRole("button", { name: "Eltávolítás" }).click();
  await expect(page.getByRole("cell", { name: "Könyvelő Kata", exact: true })).toBeHidden();
});

test("audit napló: bejegyzések és sértetlenség-ellenőrzés", async ({ page }) => {
  await login(page);
  await page.goto("/beallitasok/naplo");
  await expect(page.getByRole("cell", { name: "Cég létrehozása" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Üzleti év létrehozása" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Felhasználó eltávolítása a cégből" })).toBeVisible();
  await page.getByRole("button", { name: "Sértetlenség ellenőrzése" }).click();
  await expect(page.getByText(/A napló sértetlen/)).toBeVisible();
  await expectAccessible(page, "Audit napló");
});

test("számlatükör: alapértelmezett minta, keresés, új alszámla, szerkesztés", async ({ page }) => {
  await login(page);
  await page.goto("/beallitasok/szamlatukor");
  await expect(page.getByRole("heading", { level: 1, name: "Számlatükör" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Előzetesen felszámított általános forgalmi adó", exact: false }).first()).toBeVisible();
  await expectAccessible(page, "Számlatükör");

  await page.getByRole("searchbox", { name: "Keresés számra vagy névre" }).fill("38");
  await expect(page.getByRole("cell", { name: "381", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "454", exact: true })).toBeHidden();

  await page.getByRole("button", { name: "Új számla" }).click();
  const dialog = page.getByRole("dialog", { name: "Új főkönyvi számla" });
  await dialog.getByRole("textbox", { name: "Számlaszám" }).fill("3841");
  await dialog.getByRole("textbox", { name: "Megnevezés" }).fill("OTP forint számla");
  await expectAccessible(page, "Új számla ablak");
  await dialog.getByRole("button", { name: "Létrehozás" }).click();
  await expect(page.getByRole("status").getByText("A(z) 3841 számla létrejött.")).toBeVisible();
  const row384 = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "384", exact: true }) });
  await expect(row384).toContainText("Gyűjtő");
  const row3841 = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "3841", exact: true }) });
  await expect(row3841).toContainText("Bankszámla");
  // A kimutatássor a szülőtől öröklődik (mérleg B.IV.2, követel egyenlegnél F.III.2).
  await expect(row3841).toContainText("B.IV.2 / F.III.2");
  await row3841.getByRole("button", { name: /Szerkesztés/ }).click();
  const edit = page.getByRole("dialog", { name: "3841 számla szerkesztése" });
  await expect(edit.getByRole("combobox", { name: "Mérlegsor tartozik egyenlegnél" })).toHaveValue("B.IV.2");
  await expectAccessible(page, "Számla szerkesztése");
  await page.keyboard.press("Escape");

  // Foglalt számlaszám: érthető hiba
  await page.getByRole("button", { name: "Új számla" }).click();
  await dialog.getByRole("textbox", { name: "Számlaszám" }).fill("3841");
  await dialog.getByRole("textbox", { name: "Megnevezés" }).fill("Másik");
  await dialog.getByRole("button", { name: "Létrehozás" }).click();
  await expect(dialog.getByText("A(z) 3841 számlaszám már létezik.")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("partnerek: új szállító billentyűzetes számlakeresővel, keresés, inaktiválás", async ({ page }) => {
  await login(page);
  await page.getByRole("navigation", { name: "Főmenü" }).getByRole("link", { name: "Partnerek" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Partnerek" })).toBeVisible();
  await page.getByRole("link", { name: "Új partner" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Új partner" })).toBeVisible();

  await page.getByRole("textbox", { name: "Név", exact: true }).fill("Irodaszer Kft.");
  const tax = page.getByRole("textbox", { name: "Adószám", exact: true });
  await tax.fill("12345678-1-11");
  await tax.blur();
  await expect(page.getByText(/ellenőrző számjegye hibás/)).toBeVisible();
  await tax.fill("10537914-4-44");
  await page.getByRole("textbox", { name: "Bankszámlaszám" }).fill("11773016-11111018");

  // Számlakereső: számra
  const payable = page.getByRole("combobox", { name: "Szállító számla" });
  await payable.fill("45");
  await expect(page.getByRole("option", { name: /454 Szállítók/ })).toBeVisible();
  await expectAccessible(page, "Számlakereső nyitva");
  await payable.press("Enter");
  await expect(payable).toHaveValue("454 – Szállítók");
  // Számlakereső: névre, ékezet nélkül, nyíllal
  const expense = page.getByRole("combobox", { name: "Költség- vagy eszközszámla" });
  await expense.fill("berleti");
  await expense.press("ArrowDown");
  await expense.press("Enter");
  await expect(expense).toHaveValue("522 – Bérleti díjak");
  await page.getByRole("textbox", { name: "Fizetési határidő (nap)" }).fill("15");
  await expectAccessible(page, "Partner űrlap");
  await page.getByRole("textbox", { name: "Név", exact: true }).press("Control+Enter");

  await expect(page.getByRole("heading", { level: 1, name: "Partnerek" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Irodaszer Kft." })).toBeVisible();
  await page.getByRole("searchbox", { name: "Keresés névre vagy adószámra" }).fill("1053791");
  await expect(page.getByRole("link", { name: "Irodaszer Kft." })).toBeVisible();
  await expectAccessible(page, "Partnerlista");

  await page.getByRole("link", { name: "Irodaszer Kft." }).click();
  await expect(page.getByRole("combobox", { name: "Szállító számla" })).toHaveValue("454 – Szállítók");
  await page.getByRole("button", { name: "Inaktiválás" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Inaktiválás" }).click();
  await expect(page.getByRole("status").getByText("A partner inaktív lett.")).toBeVisible();
});

test("bizonylat: szállítói számla sablonnal, egyensúly-ellenőrzés, előnézet, könyvelés", async ({ page }) => {
  await login(page);
  // Az előző tesztben inaktivált partner újra aktív (alapértelmezett kontírozása: 522 / 454, 15 nap).
  await page.goto("/partnerek");
  await page.getByLabel("Állapot").selectOption("INACTIVE");
  await page.getByRole("link", { name: "Irodaszer Kft." }).click();
  await page.getByRole("button", { name: "Aktiválás" }).click();
  await expect(page.getByRole("status").getByText("A partner újra aktív.")).toBeVisible();

  await page.locator("body").click();
  await page.keyboard.press("F2");
  await expect(page.getByRole("heading", { level: 1, name: "Új bizonylat" })).toBeVisible();
  await page.getByLabel("Bizonylat típusa").selectOption("SZSZ");
  const partner = page.getByRole("combobox", { name: "Partner" });
  await partner.fill("iroda");
  await partner.press("Enter");
  await expect(partner).toHaveValue("Irodaszer Kft. (10537914-4-44)");
  await page.getByLabel("A szállító számlaszáma").fill("IR-2026/0042");
  await page.getByLabel("A gazdasági művelet leírása").fill("Irodabérlet, október");
  await page.getByRole("textbox", { name: "Kelt", exact: true }).fill("2026.10.05");
  await page.getByRole("textbox", { name: "Kelt", exact: true }).blur();
  // A teljesítés és a könyvelés dátuma a keltet követi; a határidő a partner fizetési feltételéből.
  await expect(page.getByRole("textbox", { name: "Teljesítés", exact: true })).toHaveValue("2026.10.05.");
  await expect(page.getByRole("textbox", { name: "Könyvelés dátuma", exact: true })).toHaveValue("2026.10.05.");
  await expect(page.getByRole("textbox", { name: "Fizetési határidő", exact: true })).toHaveValue("2026.10.20.");

  // Alt+L: sablon – a partner alapértelmezett kontírozása az első.
  await page.keyboard.press("Alt+l");
  const tpl = page.getByRole("dialog", { name: "Kontírozási sablon" });
  await expect(tpl.getByRole("option").first()).toContainText("Irodaszer Kft. – alapértelmezett kontírozás");
  await expectAccessible(page, "Sablonválasztó");
  await tpl.getByRole("combobox", { name: "Sablon keresése" }).press("Enter");
  const gross = tpl.getByRole("textbox", { name: "Bruttó összeg (Ft)" });
  await expect(gross).toBeFocused();
  await gross.fill("127000");
  await gross.press("Enter");
  await expect(tpl).toBeHidden();
  await expect(page.getByRole("combobox", { name: "1. sor: számla" })).toHaveValue("522 – Bérleti díjak");
  await expect(page.getByRole("textbox", { name: "1. sor: tartozik összeg" })).toHaveValue(amount("100 000"));
  await expect(page.getByRole("textbox", { name: "2. sor: tartozik összeg" })).toHaveValue(amount("27 000"));
  await expect(page.getByRole("textbox", { name: "3. sor: követel összeg" })).toHaveValue(amount("127 000"));
  await expect(page.getByText("A tartozik és követel oldal egyezik.")).toBeVisible();

  // Eltérés: azonnal, pontos összeggel; „=” beírja a különbözetet.
  const credit3 = page.getByRole("textbox", { name: "3. sor: követel összeg" });
  await credit3.fill("120000");
  await expect(page.getByText("A tartozik és követel oldal nem egyezik, eltérés: 7 000 Ft")).toBeVisible();
  await credit3.fill("");
  await credit3.press("=");
  await expect(credit3).toHaveValue(amount("127 000"));
  await expect(page.getByText("A tartozik és követel oldal egyezik.")).toBeVisible();
  await expectAccessible(page, "Bizonylatrögzítés");

  // Ctrl+Enter: előnézet; Enter: könyvelés.
  await page.getByLabel("A gazdasági művelet leírása").press("Control+Enter");
  const preview = page.getByRole("dialog", { name: "Előnézet – könyvelés előtt" });
  await expect(preview).toContainText("Hatás a szállítói tartozásra: +127 000 Ft");
  await expect(preview.getByRole("button", { name: "Könyvelés" })).toBeFocused();
  await expectAccessible(page, "Előnézet");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "SZSZ-2026-00001" })).toBeVisible();
  await expect(page.getByRole("status").getByText("Könyvelve: SZSZ-2026-00001")).toBeVisible();
  await expect(page.getByRole("cell", { name: "454 Szállítók" })).toBeVisible();
  await expectAccessible(page, "Könyvelt bizonylat");
});

test("bizonylat: hibás mentés után a mezőbe gépelve a kurzor a mezőben marad", async ({ page }) => {
  await login(page);
  await page.keyboard.press("Alt+n");
  await page.getByRole("button", { name: "Előnézet és könyvelés" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "A bizonylat még nem könyvelhető." })).toBeFocused();
  const description = page.getByLabel("A gazdasági művelet leírása");
  await description.click();
  await page.keyboard.type("Posta");
  await expect(description).toBeFocused();
  await expect(description).toHaveValue("Posta");
  // Az összegmezőkben is: gépelés közben változik az eltérés üzenete, a kurzor mégis marad.
  const debit = page.getByLabel("1. sor: tartozik összeg");
  await debit.click();
  await page.keyboard.type("32000");
  await expect(debit).toBeFocused();
  // Új könyvelési kísérletnél a hibaösszesítő ismét fókuszt kap.
  await page.getByRole("button", { name: "Előnézet és könyvelés" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "A bizonylat még nem könyvelhető." })).toBeFocused();
});

test("bizonylat: piszkozat billentyűzetes sorrögzítéssel, Teendők, banki kifizetés könyvelése", async ({ page }) => {
  await login(page);
  await page.keyboard.press("Alt+n");
  await expect(page.getByRole("heading", { level: 1, name: "Új bizonylat" })).toBeVisible();
  await page.getByLabel("Bizonylat típusa").selectOption("BANK");
  const partner = page.getByRole("combobox", { name: "Partner" });
  await partner.fill("iroda");
  await partner.press("Enter");
  await page.getByLabel("Kivonat száma").fill("2026/41");
  await page.getByLabel("A gazdasági művelet leírása").fill("Kifizetés: IR-2026/0042");
  await page.getByRole("textbox", { name: "Kelt", exact: true }).fill("2026.10.10");

  // Sorrögzítés csak billentyűzettel: Enter a következő mezőre, a sor végén új sor.
  const acc1 = page.getByRole("combobox", { name: "1. sor: számla" });
  await acc1.fill("454");
  await acc1.press("Enter");
  await expect(acc1).toHaveValue("454 – Szállítók");
  await acc1.press("Enter");
  await expect(page.getByRole("textbox", { name: "1. sor: tartozik összeg" })).toBeFocused();
  await page.keyboard.type("127000");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  const acc2 = page.getByRole("combobox", { name: "2. sor: számla" });
  await expect(acc2).toBeFocused();
  await page.keyboard.type("3841");
  await page.keyboard.press("Enter");
  await expect(acc2).toHaveValue("3841 – OTP forint számla");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("=");
  await expect(page.getByRole("textbox", { name: "2. sor: követel összeg" })).toHaveValue(amount("127 000"));

  await page.getByRole("button", { name: "Mentés piszkozatként" }).click();
  await expect(page.getByRole("status").getByText("A piszkozat mentése sikerült.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Piszkozat szerkesztése" })).toBeVisible();

  // Egy régi pénztári piszkozat: lejárt rögzítési határidő.
  await page.goto("/konyveles/uj?tipus=PK");
  await page.getByLabel("A gazdasági művelet leírása").fill("Postaköltség");
  await page.getByRole("textbox", { name: "Kelt", exact: true }).fill("2026.01.12");
  await page.getByRole("combobox", { name: "1. sor: számla" }).fill("527");
  await page.getByRole("combobox", { name: "1. sor: számla" }).press("Enter");
  await page.getByRole("textbox", { name: "1. sor: tartozik összeg" }).fill("1500");
  await page.getByRole("combobox", { name: "2. sor: számla" }).fill("381");
  await page.getByRole("combobox", { name: "2. sor: számla" }).press("Enter");
  await page.getByRole("textbox", { name: "2. sor: követel összeg" }).fill("1500");
  await expect(page.getByText(/Rögzítési határidő lejárt: 2026\.01\.12\./)).toBeVisible();
  await page.getByRole("button", { name: "Mentés piszkozatként" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Piszkozat szerkesztése" })).toBeVisible();

  // Kezdőlap: a teendők kattinthatók.
  await page.getByRole("navigation", { name: "Főmenü" }).getByRole("link", { name: "Kezdőlap" }).click();
  const todos = page.getByRole("region", { name: /Teendők/ });
  await expect(todos.getByRole("link", { name: /Rögzítési határidő: 1 lejárt/ })).toBeVisible();
  await expect(todos.getByRole("link", { name: /Piszkozat: Postaköltség.*Rögzítési határidő lejárt: 2026\.01\.12\./ })).toBeVisible();
  await expectAccessible(page, "Kezdőlap teendőkkel");
  await todos.getByRole("link", { name: /Rögzítési határidő: 1 lejárt/ }).click();
  await expect(page).toHaveURL(/\/konyveles\?allapot=piszkozat$/);
  await expect(page.getByRole("link", { name: "Piszkozat" })).toHaveCount(2);
  await page.goBack();
  await todos.getByRole("link", { name: /Piszkozat: Kifizetés: IR-2026\/0042/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Piszkozat szerkesztése" })).toBeVisible();
  await expect(page.getByLabel("A gazdasági művelet leírása")).toHaveValue("Kifizetés: IR-2026/0042");

  await page.getByLabel("A gazdasági művelet leírása").press("Control+Enter");
  await page.getByRole("dialog", { name: "Előnézet – könyvelés előtt" }).getByRole("button", { name: "Könyvelés" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "BANK-2026-00001" })).toBeVisible();
});

test("bizonylat: sztornó megerősítéssel, kölcsönös hivatkozás, szűrés", async ({ page }) => {
  await login(page);
  await page.getByRole("navigation", { name: "Főmenü" }).getByRole("link", { name: "Könyvelés" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Könyvelés" })).toBeVisible();
  await expectAccessible(page, "Bizonylatlista");
  await page.getByRole("link", { name: "SZSZ-2026-00001" }).click();
  await page.getByRole("button", { name: "Sztornózás" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Bizonylat sztornózása" });
  await expect(confirm).toContainText("nem vonható vissza");
  await expect(confirm.getByRole("button", { name: "Mégse" })).toBeFocused();
  await expectAccessible(page, "Sztornó megerősítése");
  await confirm.getByRole("button", { name: "Sztornózás" }).click();
  await expect(confirm.getByText("Írja le röviden a sztornó okát.")).toBeVisible();
  await confirm.getByLabel("A sztornó oka").fill("Téves rögzítés");
  await confirm.getByRole("button", { name: "Sztornózás" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "SZT-2026-00001" })).toBeVisible();
  await expect(page.getByText("Ez a bizonylat sztornózza:")).toBeVisible();
  await page.getByRole("link", { name: "SZSZ-2026-00001" }).first().click();
  await expect(page.getByText(/Sztornózva a következővel/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sztornózás" })).toBeHidden();

  await page.goto("/konyveles");
  await page.getByLabel("Állapot").selectOption("sztornozott");
  await expect(page.getByRole("link", { name: "SZSZ-2026-00001" })).toBeVisible();
  await expect(page.getByRole("link", { name: "BANK-2026-00001" })).toBeHidden();
});

test("analitika: utólagos párosítás, kiegyenlítés rögzítéskor, egyeztetés, banknapló", async ({ page }) => {
  await login(page);
  const invoice = async (ext: string, gross: string) => {
    await page.goto("/konyveles/uj?tipus=SZSZ");
    const partner = page.getByRole("combobox", { name: "Partner" });
    await partner.fill("iroda");
    await partner.press("Enter");
    await page.getByLabel("A szállító számlaszáma").fill(ext);
    await page.getByLabel("A gazdasági művelet leírása").fill(`Bérleti díj ${ext}`);
    await page.keyboard.press("Alt+l");
    const tpl = page.getByRole("dialog", { name: "Kontírozási sablon" });
    await tpl.getByRole("combobox", { name: "Sablon keresése" }).press("Enter");
    await tpl.getByRole("textbox", { name: "Bruttó összeg (Ft)" }).fill(gross);
    await tpl.getByRole("textbox", { name: "Bruttó összeg (Ft)" }).press("Enter");
    await page.getByLabel("A gazdasági művelet leírása").press("Control+Enter");
    await page.getByRole("dialog", { name: "Előnézet – könyvelés előtt" }).getByRole("button", { name: "Könyvelés" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /^SZSZ-2026-/ })).toBeVisible();
  };

  // A BANK-2026-00001 (127 000) az előző tesztben sztornózott számlához tartozott: párosítatlan fizetés.
  await invoice("IR-2026/0050", "50800");
  await page.getByRole("link", { name: "Irodaszer Kft." }).click();
  const openSection = page.getByRole("region", { name: /Nyitott tételek/ });
  await expect(openSection.getByRole("cell", { name: "IR-2026/0050" })).toBeVisible();
  await expectAccessible(page, "Partner nyitott tételei");
  await openSection.getByRole("button", { name: "Párosítás: BANK-2026-00001" }).click();
  const pair = page.getByRole("dialog", { name: "Fizetés párosítása" });
  await expect(pair.getByRole("textbox", { name: "Összeg (Ft)" })).toHaveValue(amount("50 800"));
  await pair.getByRole("button", { name: "Párosítás" }).click();
  await expect(page.getByRole("status").getByText("A párosítás megtörtént.")).toBeVisible();
  await expect(openSection.getByRole("cell", { name: "IR-2026/0050" })).toBeHidden();

  // Kiegyenlítés rögzítéskor: a kijelölt tételből a sorok is kitöltődnek.
  await invoice("IR-2026/0051", "25400");
  await page.keyboard.press("F2");
  await page.getByLabel("Bizonylat típusa").selectOption("BANK");
  const partner = page.getByRole("combobox", { name: "Partner" });
  await partner.fill("iroda");
  await partner.press("Enter");
  await page.getByLabel("A gazdasági művelet leírása").fill("Kifizetés IR-2026/0051");
  await page.getByRole("checkbox", { name: /IR-2026\/0051.*kiegyenlítése/ }).check();
  await expect(page.getByRole("combobox", { name: "1. sor: számla" })).toHaveValue("454 – Szállítók");
  await expect(page.getByRole("textbox", { name: "1. sor: tartozik összeg" })).toHaveValue(amount("25 400"));
  await expect(page.getByRole("combobox", { name: "2. sor: számla" })).toHaveValue("3841 – OTP forint számla");
  await expect(page.getByRole("textbox", { name: "2. sor: követel összeg" })).toHaveValue(amount("25 400"));
  await expectAccessible(page, "Kiegyenlítés rögzítéskor");
  await page.getByLabel("A gazdasági művelet leírása").press("Control+Enter");
  await page.getByRole("dialog", { name: "Előnézet – könyvelés előtt" }).getByRole("button", { name: "Könyvelés" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "BANK-2026-00002" })).toBeVisible();
  await expect(page.getByRole("region", { name: /Kiegyenlítés/ })).toContainText("Kiegyenlíti: SZSZ-2026-00003");

  // Nyitott tételek, egyeztetés, banknapló.
  await page.goto("/partnerek/nyitott-tetelek");
  await expect(page.getByRole("heading", { level: 1, name: "Nyitott tételek" })).toBeVisible();
  await expectAccessible(page, "Nyitott tételek");
  await page.getByRole("navigation", { name: "Partnerek almenü" }).getByRole("link", { name: "Egyeztetés" }).click();
  const row454 = page.getByRole("row").filter({ has: page.getByRole("cell", { name: /^454 Szállítók/ }) });
  await expect(row454).toContainText("Egyezik");
  await expectAccessible(page, "Egyeztetés");
  await page.goto("/konyveles/penzeszkozok");
  await page.getByLabel("Számla").selectOption({ label: "3841 – OTP forint számla (bank)" });
  await expect(page.getByRole("link", { name: "BANK-2026-00002" })).toBeVisible();
  await page.getByLabel(/A kivonat záró egyenlege/).fill("-152400");
  await expect(page.getByText("A könyvelt egyenleg egyezik a kivonattal.")).toBeVisible();
  await expectAccessible(page, "Banknapló");
});

test("kimutatások: főkönyvi kivonat, naplófőkönyv, karton, mérleg, eredménykimutatás, CSV", async ({ page }) => {
  await login(page);
  await page.getByRole("navigation", { name: "Főmenü" }).getByRole("link", { name: "Kimutatások" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Főkönyvi kivonat" })).toBeVisible();
  await expect(page.getByText("Ellenőrzés: minden oszlopban Σ tartozik = Σ követel.")).toBeVisible();
  await expectAccessible(page, "Főkönyvi kivonat");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/^fokonyvi-kivonat_.*\.csv$/);

  const tabs = page.getByRole("navigation", { name: "Kimutatások almenü" });
  await tabs.getByRole("link", { name: "Naplófőkönyv" }).click();
  await expect(page.getByRole("link", { name: "BANK-2026-00002" }).first()).toBeVisible();
  await expectAccessible(page, "Naplófőkönyv");

  await tabs.getByRole("link", { name: "Karton" }).click();
  const acc = page.getByRole("combobox", { name: "Számla" });
  await acc.fill("454");
  await acc.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: /Karton – 454 Szállítók/ })).toBeVisible();
  await expectAccessible(page, "Karton");

  await tabs.getByRole("link", { name: "Mérleg" }).click();
  await expect(page.getByText("Belső kimutatás – nem minősül közzétett beszámolónak")).toBeVisible();
  await expect(page.getByText("A kimutatás a könyvelt tételek alapján készült.")).toBeVisible();
  await expect(page.getByText("Ellenőrzés: eszközök összesen = források összesen.")).toBeVisible();
  await expect(page.getByRole("row", { name: /ESZKÖZÖK \(AKTÍVÁK\) ÖSSZESEN/ })).toBeVisible();
  await expect(page.getByText("Tájékoztató jellegű")).toHaveCount(0);
  await expectAccessible(page, "Mérleg");
  await page.getByLabel("Közzétételi példány").check();
  await expect(page.getByText("Belső kimutatás – nem minősül közzétett beszámolónak")).toBeHidden();
  await expect(page.getByText("A közzétett adatok könyvvizsgálattal nincsenek alátámasztva.")).toBeVisible();

  await tabs.getByRole("link", { name: "Eredménykimutatás" }).click();
  await expect(page.getByRole("row", { name: /^D Adózott eredmény/ })).toBeVisible();
  await page.getByLabel("Pénzegység").selectOption("THOUSAND");
  await expect(page.getByText(/adatok ezer Ft-ban/)).toBeVisible();
  await expectAccessible(page, "Eredménykimutatás");
});

test("zárás: havi időszak lezárása és feloldása, évzárási ellenőrzések; nyitó egyenlegek; Excel-export", async ({ page }) => {
  await login(page);
  await page.getByRole("navigation", { name: "Főmenü" }).getByRole("link", { name: "Zárás" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Időszakok és évzárás" })).toBeVisible();
  await expectAccessible(page, "Zárás");
  // Januárban piszkozat van (Postaköltség), így nem zárható.
  await page.getByRole("button", { name: "Lezárás: 2026. január" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Lezárás" }).click();
  await expect(page.getByRole("status").getByText(/2026\. január időszakban 1 piszkozat van/)).toBeVisible();
  await page.getByRole("button", { name: "Lezárás: 2026. február" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Lezárás" }).click();
  await expect(page.getByRole("status").getByText("2026. február lezárva.")).toBeVisible();
  await page.getByRole("button", { name: "Feloldás: 2026. február" }).click();
  const reopen = page.getByRole("alertdialog", { name: "2026. február feloldása" });
  await expect(reopen.getByRole("button", { name: "Mégse" })).toBeFocused();
  await reopen.getByRole("textbox", { name: "Indoklás" }).fill("Elmaradt bizonylat");
  await reopen.getByRole("button", { name: "Feloldás" }).click();
  await expect(page.getByRole("status").getByText("2026. február feloldva.")).toBeVisible();
  await expect(page.getByText(/piszkozat van az üzleti évben/)).toBeVisible();
  await expect(page.getByRole("button", { name: "1. Zárlat indítása" })).toBeVisible();

  // Nyitó egyenlegek beillesztéssel (mintha Excelből másolnánk).
  await page.getByRole("navigation", { name: "Zárás almenü" }).getByRole("link", { name: "Nyitó egyenlegek" }).click();
  await page.getByRole("textbox", { name: "Az átvétel napja" }).fill("2026.09.30");
  const box = page.getByRole("textbox", { name: "1. Főkönyvi kivonat (záró egyenlegek)" });
  await box.fill("Számla\tMegnevezés\tTartozik\tKövetel\n3841\tOTP\t500 000\t\n411\tJegyzett tőke\t\t400 000");
  await expect(page.getByText("Eltérés: 100 000 Ft")).toBeVisible();
  await expect(page.getByRole("button", { name: "Nyitó egyenlegek könyvelése" })).toBeDisabled();
  await box.fill("3841\tOTP\t500 000\t\n411\tJegyzett tőke\t\t500 000");
  await expect(page.getByRole("cell", { name: "Egyezik" })).toBeVisible();
  await expectAccessible(page, "Nyitó egyenlegek");
  await page.getByRole("button", { name: "Nyitó egyenlegek könyvelése" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Könyvelés" }).click();
  await expect(page.getByRole("status").getByText("Nyitó egyenlegek rögzítve (1 bizonylat).")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Főkönyvi kivonat" })).toBeVisible();

  // Valódi Excel-fájl (xlsx = ZIP-csomag).
  await page.goto("/kimutatasok/merleg");
  await expect(page.getByText("Ellenőrzés: eszközök összesen = források összesen.")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Excel (.xlsx)" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^merleg_\d{4}-\d{2}-\d{2}\.xlsx$/);
  const fs = await import("node:fs/promises");
  const bytes = await fs.readFile((await file.path())!);
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const ws = wb.worksheets[0]!;
  const texts = ws.getColumn(1).values.map(String);
  expect(texts).toEqual(expect.arrayContaining(["Mérleg („A” változat)", "Belső kimutatás – nem minősül közzétett beszámolónak", "A kimutatás a könyvelt tételek alapján készült."]));
  const totalRow = ws.getRows(1, ws.rowCount)!.find((r) => r.getCell(2).value === "ESZKÖZÖK (AKTÍVÁK) ÖSSZESEN")!;
  expect(totalRow.font?.bold).toBe(true);
  expect(totalRow.getCell(4).numFmt).toBe("#,##0");
  expect(typeof totalRow.getCell(4).value).toBe("number");
});

test("mobil nézet: nincs vízszintes görgetés, a menü elérhető", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await login(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByRole("button", { name: "Új tétel" })).toBeVisible();
  await expectAccessible(page, "Kezdőlap mobilon");
  // A rögzítő űrlapon a tételtábla a saját dobozában görög, az oldal nem.
  await page.goto("/konyveles/uj");
  await expect(page.getByRole("heading", { level: 1, name: "Új bizonylat" })).toBeVisible();
  const entryOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(entryOverflow).toBeLessThanOrEqual(0);
});
