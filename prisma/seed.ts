/**
 * Teszteléshez való seed adatok: két fake cég, egy könyvelőiroda-user, aki
 * mindkettőt látja, néhány partner (részben már tanult kategóriával) és
 * mintaszámlák — vegyesen jóváhagyott és "ellenőrzésre vár" állapotban,
 * hogy a dashboard és a review-flow induláskor is bemutatható legyen.
 *
 * Futtatás: `npm run db:seed` (vagy automatikusan `prisma migrate reset`-kor).
 * Minden felhasználó jelszava: jelszo1234
 */
import { PrismaClient, type CategoryType } from "@prisma/client";
import bcrypt from "bcryptjs";
import { buildStorageKey, getStorageDriver, type StorageDriver } from "../src/lib/storage";
import { calculateGrossFromNet, calculateVatFromNet } from "../src/lib/vat";

const db = new PrismaClient();

const PLACEHOLDER_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

const DEFAULT_CATEGORIES: { name: string; type: CategoryType; keywords: string[] }[] = [
  { name: "Iroda", type: "EXPENSE", keywords: ["iroda", "papír", "toner", "irodaszer"] },
  { name: "Utazás", type: "EXPENSE", keywords: ["utazás", "szállás", "repül", "vonat", "taxi", "benzin", "üzemanyag"] },
  { name: "Szoftver", type: "EXPENSE", keywords: ["szoftver", "software", "saas", "előfizetés", "licenc", "subscription"] },
  { name: "Marketing", type: "EXPENSE", keywords: ["marketing", "hirdetés", "reklám", "ads"] },
  { name: "Rezsi", type: "EXPENSE", keywords: ["áram", "gáz", "víz", "internet", "telefon", "rezsi"] },
  { name: "Bérleti díj", type: "EXPENSE", keywords: ["bérleti", "bérlet", "rent"] },
  { name: "Könyvelés", type: "EXPENSE", keywords: ["könyvelés", "könyvelő", "accounting"] },
  { name: "Alapanyag", type: "EXPENSE", keywords: ["alapanyag", "kávé", "tej", "beszerzés"] },
  { name: "Értékesítés", type: "INCOME", keywords: [] },
  { name: "Egyéb", type: "BOTH", keywords: [] },
];

async function createCategories(companyId: string) {
  await db.category.createMany({
    data: DEFAULT_CATEGORIES.map((c) => ({ ...c, companyId, isDefault: true })),
  });
  const categories = await db.category.findMany({ where: { companyId } });
  return Object.fromEntries(categories.map((c) => [c.name, c])) as Record<
    string,
    (typeof categories)[number]
  >;
}

async function createPartner(
  companyId: string,
  name: string,
  taxNumber: string | undefined,
  defaultCategoryId: string | undefined
) {
  return db.partner.create({ data: { companyId, name, taxNumber, defaultCategoryId } });
}

type SeedInvoice = {
  fileName: string;
  direction: "INCOME" | "EXPENSE";
  partnerName?: string;
  partnerTaxNumber?: string;
  partnerId?: string;
  issueDate?: Date;
  dueDate?: Date;
  net?: number;
  vatRate?: number;
  categoryId?: string;
  status: "CONFIRMED" | "NEEDS_REVIEW" | "ERROR";
  uncertainFields?: string[];
};

async function createInvoice(
  companyId: string,
  uploadedById: string,
  storage: StorageDriver,
  inv: SeedInvoice
) {
  const key = buildStorageKey(companyId, inv.fileName);
  await storage.put(key, PLACEHOLDER_IMAGE, "image/png");

  const net = inv.net;
  const vatRate = inv.vatRate ?? 27;
  const vat = net !== undefined ? calculateVatFromNet(net, vatRate) : undefined;
  const gross = net !== undefined ? calculateGrossFromNet(net, vatRate) : undefined;

  await db.invoice.create({
    data: {
      companyId,
      uploadedById,
      fileName: inv.fileName,
      fileUrl: key,
      mimeType: "image/png",
      fileSize: PLACEHOLDER_IMAGE.length,
      direction: inv.direction,
      status: inv.status,
      uncertainFields: inv.uncertainFields ?? [],
      ocrConfidence: inv.status === "ERROR" ? null : 0.85,
      partnerNameRaw: inv.partnerName,
      partnerTaxNumber: inv.partnerTaxNumber,
      partnerId: inv.partnerId,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      netAmount: net,
      vatAmount: vat,
      grossAmount: gross,
      vatRate: net !== undefined ? vatRate : undefined,
      categoryId: inv.categoryId,
      reviewedById: inv.status === "CONFIRMED" ? uploadedById : undefined,
      reviewedAt: inv.status === "CONFIRMED" ? new Date() : undefined,
    },
  });
}

function d(daysAgo: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(0, 0, 0, 0);
  return date;
}

async function main() {
  console.log("Seed indítása...");

  await db.$transaction([
    db.invoice.deleteMany(),
    db.partner.deleteMany(),
    db.category.deleteMany(),
    db.membership.deleteMany(),
    db.company.deleteMany(),
    db.user.deleteMany(),
  ]);

  const passwordHash = await bcrypt.hash("jelszo1234", 10);
  const storage = getStorageDriver();

  const accountant = await db.user.create({
    data: { name: "Könyvelő Anna", email: "konyvelo@example.com", passwordHash },
  });
  const ownerA = await db.user.create({
    data: { name: "Kovács Péter", email: "kovacs@example.com", passwordHash },
  });
  const ownerB = await db.user.create({
    data: { name: "Nagy Eszter", email: "nagy@example.com", passwordHash },
  });

  const companyA = await db.company.create({
    data: { name: "Kávézó Sarok Kft.", taxNumber: "11112222-1-42", address: "1052 Budapest, Váci utca 10." },
  });
  const companyB = await db.company.create({
    data: { name: "Dizájn Stúdió Bt.", taxNumber: "22223333-2-13", address: "6720 Szeged, Kárász utca 5." },
  });

  await db.membership.createMany({
    data: [
      { userId: ownerA.id, companyId: companyA.id, role: "OWNER" },
      { userId: accountant.id, companyId: companyA.id, role: "ACCOUNTANT" },
      { userId: ownerB.id, companyId: companyB.id, role: "OWNER" },
      { userId: accountant.id, companyId: companyB.id, role: "ACCOUNTANT" },
    ],
  });

  // ---------- Kávézó Sarok Kft. ----------
  const catA = await createCategories(companyA.id);

  const beanSupplier = await createPartner(companyA.id, "Kávébab Nagyker Kft.", "31112223-2-42", catA["Alapanyag"].id);
  const landlordA = await createPartner(companyA.id, "Ingatlanbérlő Kft.", "14785236-2-42", catA["Bérleti díj"].id);
  const mvm = await createPartner(companyA.id, "MVM Next Energiakereskedelmi Zrt.", "26260016-2-44", catA["Rezsi"].id);

  await createInvoice(companyA.id, ownerA.id, storage, {
    fileName: "berleti_dij_2026_08.png",
    direction: "EXPENSE",
    partnerName: landlordA.name,
    partnerTaxNumber: landlordA.taxNumber!,
    partnerId: landlordA.id,
    issueDate: d(38),
    dueDate: d(23),
    net: 180000,
    categoryId: catA["Bérleti díj"].id,
    status: "CONFIRMED",
  });
  await createInvoice(companyA.id, ownerA.id, storage, {
    fileName: "berleti_dij_2026_09.png",
    direction: "EXPENSE",
    partnerName: landlordA.name,
    partnerTaxNumber: landlordA.taxNumber!,
    partnerId: landlordA.id,
    issueDate: d(6),
    dueDate: d(-9),
    net: 180000,
    categoryId: catA["Bérleti díj"].id,
    status: "CONFIRMED",
  });
  await createInvoice(companyA.id, ownerA.id, storage, {
    fileName: "kavebab_szamla_08.png",
    direction: "EXPENSE",
    partnerName: beanSupplier.name,
    partnerTaxNumber: beanSupplier.taxNumber!,
    partnerId: beanSupplier.id,
    issueDate: d(30),
    dueDate: d(16),
    net: 64000,
    categoryId: catA["Alapanyag"].id,
    status: "CONFIRMED",
  });
  await createInvoice(companyA.id, ownerA.id, storage, {
    fileName: "kavebab_szamla_09.png",
    direction: "EXPENSE",
    partnerName: beanSupplier.name,
    partnerTaxNumber: beanSupplier.taxNumber!,
    partnerId: beanSupplier.id,
    issueDate: d(2),
    dueDate: d(12),
    net: 71500,
    categoryId: catA["Alapanyag"].id,
    status: "CONFIRMED",
  });
  await createInvoice(companyA.id, ownerA.id, storage, {
    fileName: "aram_szamla_08.png",
    direction: "EXPENSE",
    partnerName: mvm.name,
    partnerTaxNumber: mvm.taxNumber!,
    partnerId: mvm.id,
    issueDate: d(35),
    dueDate: d(21),
    net: 42000,
    categoryId: catA["Rezsi"].id,
    status: "CONFIRMED",
  });
  await createInvoice(companyA.id, ownerA.id, storage, {
    fileName: "napi_penztarzaras_08_15.png",
    direction: "INCOME",
    partnerName: "Napi pénztárzárás",
    issueDate: d(24),
    net: 210000,
    categoryId: catA["Értékesítés"].id,
    status: "CONFIRMED",
  });
  await createInvoice(companyA.id, ownerA.id, storage, {
    fileName: "napi_penztarzaras_09_01.png",
    direction: "INCOME",
    partnerName: "Napi pénztárzárás",
    issueDate: d(7),
    net: 245000,
    categoryId: catA["Értékesítés"].id,
    status: "CONFIRMED",
  });
  // Ellenőrzésre váró tétel: OCR bizonytalan volt a dátumban és az ÁFA kulcsban
  await createInvoice(companyA.id, ownerA.id, storage, {
    fileName: "tejszallito_szamla_09.png",
    direction: "EXPENSE",
    partnerName: "Tejtermék Beszerző Bt.",
    net: 18500,
    status: "NEEDS_REVIEW",
    uncertainFields: ["issueDate", "dueDate", "vatRate"],
  });
  // OCR hiba szimuláció
  await createInvoice(companyA.id, ownerA.id, storage, {
    fileName: "elmosodott_blokk.png",
    direction: "EXPENSE",
    status: "ERROR",
  });

  // ---------- Dizájn Stúdió Bt. ----------
  const catB = await createCategories(companyB.id);

  const figma = await createPartner(companyB.id, "Figma Inc.", "US00000001", catB["Szoftver"].id);
  const adobe = await createPartner(companyB.id, "Adobe Ireland", "IE9700053D", catB["Szoftver"].id);
  const accountingFirm = await createPartner(companyB.id, "Precíz Könyvelő Iroda Bt.", "25874136-1-42", catB["Könyvelés"].id);
  const client1 = await createPartner(companyB.id, "Zöld Kert Kft.", "44556677-2-13", catB["Értékesítés"].id);

  await createInvoice(companyB.id, ownerB.id, storage, {
    fileName: "figma_elofizetes_08.png",
    direction: "EXPENSE",
    partnerName: figma.name,
    partnerTaxNumber: figma.taxNumber!,
    partnerId: figma.id,
    issueDate: d(33),
    dueDate: d(33),
    net: 12000,
    categoryId: catB["Szoftver"].id,
    status: "CONFIRMED",
  });
  await createInvoice(companyB.id, ownerB.id, storage, {
    fileName: "adobe_elofizetes_09.png",
    direction: "EXPENSE",
    partnerName: adobe.name,
    partnerTaxNumber: adobe.taxNumber!,
    partnerId: adobe.id,
    issueDate: d(5),
    dueDate: d(5),
    net: 24500,
    categoryId: catB["Szoftver"].id,
    status: "CONFIRMED",
  });
  await createInvoice(companyB.id, ownerB.id, storage, {
    fileName: "konyveles_dij_08.png",
    direction: "EXPENSE",
    partnerName: accountingFirm.name,
    partnerTaxNumber: accountingFirm.taxNumber!,
    partnerId: accountingFirm.id,
    issueDate: d(28),
    dueDate: d(14),
    net: 45000,
    categoryId: catB["Könyvelés"].id,
    status: "CONFIRMED",
  });
  await createInvoice(companyB.id, ownerB.id, storage, {
    fileName: "logo_tervezes_szamla_08.png",
    direction: "INCOME",
    partnerName: client1.name,
    partnerTaxNumber: client1.taxNumber!,
    partnerId: client1.id,
    issueDate: d(27),
    dueDate: d(13),
    net: 350000,
    categoryId: catB["Értékesítés"].id,
    status: "CONFIRMED",
  });
  await createInvoice(companyB.id, ownerB.id, storage, {
    fileName: "arculat_szamla_09.png",
    direction: "INCOME",
    partnerName: client1.name,
    partnerTaxNumber: client1.taxNumber!,
    partnerId: client1.id,
    issueDate: d(4),
    dueDate: d(18),
    net: 480000,
    categoryId: catB["Értékesítés"].id,
    status: "CONFIRMED",
  });
  // Ellenőrzésre váró: OCR csak a partnert és az összeget ismerte fel biztosan
  await createInvoice(companyB.id, ownerB.id, storage, {
    fileName: "google_ads_szamla_09.png",
    direction: "EXPENSE",
    partnerName: "Google Ireland Limited",
    partnerTaxNumber: "IE6388047V",
    net: 32000,
    status: "NEEDS_REVIEW",
    uncertainFields: ["issueDate", "dueDate"],
    categoryId: catB["Marketing"].id,
  });

  console.log("Seed kész.\n");
  console.log("Bejelentkezési adatok (mindenkinek a jelszava: jelszo1234):");
  console.log("  kovacs@example.com    — Kávézó Sarok Kft. tulajdonos");
  console.log("  nagy@example.com      — Dizájn Stúdió Bt. tulajdonos");
  console.log("  konyvelo@example.com  — könyvelő, mindkét céget látja");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
