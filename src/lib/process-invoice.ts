import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getStorageDriver } from "@/lib/storage";
import { getOcrProvider } from "@/lib/ocr";
import { findOrCreatePartner, suggestCategoryId } from "@/lib/categorize";

/**
 * Egy feltöltött bizonylat OCR-feldolgozása: kinyeri az adatokat, megpróbál
 * partnert azonosítani/létrehozni, kategóriát javasolni, és menti az
 * eredményt. A rekord "NEEDS_REVIEW" állapotban marad — a userének mindig
 * jóvá kell hagynia a mentett/kinyert adatokat, mielőtt "CONFIRMED"-nek
 * (könyvelésre késznek) számítana.
 *
 * MVP-ben szinkron módon, a feltöltési kérésen belül fut, mert a mock OCR
 * azonnali. Valós, lassabb OCR szolgáltatóra váltáskor ezt érdemes háttér-
 * feladatba (pl. job queue) kiszervezni, hogy a feltöltés ne blokkoljon.
 */
export async function processInvoiceOcr(invoiceId: string): Promise<void> {
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return;

  await db.invoice.update({ where: { id: invoiceId }, data: { status: "PROCESSING" } });

  try {
    const buffer = await getStorageDriver().read(invoice.fileUrl);
    const result = await getOcrProvider().extract({
      buffer,
      mimeType: invoice.mimeType,
      fileName: invoice.fileName,
    });

    const partnerId = await findOrCreatePartner(
      invoice.companyId,
      result.fields.partnerNameRaw,
      result.fields.partnerTaxNumber
    );
    const categoryId = await suggestCategoryId(
      invoice.companyId,
      result.fields.partnerNameRaw,
      result.fields.partnerTaxNumber
    );

    await db.invoice.update({
      where: { id: invoiceId },
      data: {
        status: "NEEDS_REVIEW",
        ocrRaw: result.raw as Prisma.InputJsonValue,
        ocrConfidence: result.overallConfidence,
        uncertainFields: result.uncertainFields,
        partnerNameRaw: result.fields.partnerNameRaw ?? null,
        partnerTaxNumber: result.fields.partnerTaxNumber ?? null,
        partnerId,
        issueDate: result.fields.issueDate ? new Date(result.fields.issueDate) : null,
        dueDate: result.fields.dueDate ? new Date(result.fields.dueDate) : null,
        netAmount: result.fields.netAmount ?? null,
        vatAmount: result.fields.vatAmount ?? null,
        grossAmount: result.fields.grossAmount ?? null,
        vatRate: result.fields.vatRate ?? null,
        categoryId,
      },
    });
  } catch (err) {
    await db.invoice.update({ where: { id: invoiceId }, data: { status: "ERROR" } });
    throw err;
  }
}
