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

  // ? → gyorsbillentyű-súgó
  await page.locator("body").click();
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

test("mobil nézet: nincs vízszintes görgetés, a menü elérhető", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await login(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByRole("button", { name: "Új tétel" })).toBeVisible();
  await expectAccessible(page, "Kezdőlap mobilon");
});
