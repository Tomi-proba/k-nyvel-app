import { db } from "@/lib/db";

/**
 * Egyszerű, nem ML alapú kategorizálás:
 *  1. Ha a partner (adószám alapján) már ismert és van hozzárendelt
 *     alapértelmezett kategóriája, azt javasoljuk ("ha ez a partner, mindig
 *     ez a kategória").
 *  2. Egyébként a kiállító nevében kulcsszó-egyezést keresünk a cég
 *     kategóriáinak `keywords` listája alapján.
 *  3. Ha egyik sem talál, nincs javaslat — a user választ kézzel.
 */
export async function suggestCategoryId(
  companyId: string,
  partnerNameRaw: string | undefined,
  partnerTaxNumber: string | undefined
): Promise<string | undefined> {
  if (partnerTaxNumber) {
    const partner = await db.partner.findUnique({
      where: { companyId_taxNumber: { companyId, taxNumber: partnerTaxNumber } },
    });
    if (partner?.defaultCategoryId) return partner.defaultCategoryId;
  }

  if (partnerNameRaw) {
    const categories = await db.category.findMany({ where: { companyId } });
    const nameLower = partnerNameRaw.toLowerCase();

    // A leghosszabb (legspecifikusabb) egyező kulcsszót választjuk, hogy pl.
    // "Könyvelő Iroda Bt." a "könyvelő" (Könyvelés kategória) kulcsszóra
    // illeszkedjen, ne a rövidebb, véletlenül szintén egyező "iroda"-ra.
    let bestCategoryId: string | undefined;
    let bestKeywordLength = 0;
    for (const category of categories) {
      for (const keyword of category.keywords) {
        const kw = keyword.toLowerCase();
        if (kw.length > bestKeywordLength && nameLower.includes(kw)) {
          bestKeywordLength = kw.length;
          bestCategoryId = category.id;
        }
      }
    }
    if (bestCategoryId) return bestCategoryId;
  }

  return undefined;
}

/**
 * Partner rekord létrehozása/megkeresése adószám alapján (ha van), különben
 * névre illesztve. Nem hoz létre duplikátumot ugyanarra az adószámra.
 */
export async function findOrCreatePartner(
  companyId: string,
  name: string | undefined,
  taxNumber: string | undefined
): Promise<string | undefined> {
  if (!name && !taxNumber) return undefined;

  if (taxNumber) {
    const existing = await db.partner.findUnique({
      where: { companyId_taxNumber: { companyId, taxNumber } },
    });
    if (existing) return existing.id;

    const created = await db.partner.create({
      data: { companyId, name: name ?? taxNumber, taxNumber },
    });
    return created.id;
  }

  if (name) {
    const existing = await db.partner.findFirst({ where: { companyId, name } });
    if (existing) return existing.id;

    const created = await db.partner.create({ data: { companyId, name } });
    return created.id;
  }

  return undefined;
}

/**
 * "Tanulás": amikor a user kézzel beállít/felülbírál egy kategóriát egy
 * ismert partneren, azt elmentjük a partner alapértelmezett kategóriájaként,
 * hogy legközelebb automatikusan azt javasoljuk.
 */
export async function rememberPartnerCategory(
  companyId: string,
  partnerId: string | undefined,
  categoryId: string | undefined
): Promise<void> {
  if (!partnerId || !categoryId) return;

  await db.partner.update({
    where: { id: partnerId },
    data: { defaultCategoryId: categoryId },
  }).catch(() => {
    // A partner időközben törölve lehetett — nem kritikus hiba.
  });
}
