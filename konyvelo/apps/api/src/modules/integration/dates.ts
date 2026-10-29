import { and, eq, gte, lte } from "drizzle-orm";
import { writeAudit } from "../../core/audit";
import type { Tx } from "../../core/db";
import { assertUuid, conflict, notFound, validationError } from "../../core/errors";
import { documents, fiscalYears, integrationRecords } from "../../core/schema";

/** A beszerzés könyvelési dátumának választása (a jóváhagyó dönt; a program nem választ helyette). */
export async function chooseDate(tx: Tx, companyId: string, documentId: string, choice: "RECEIVED" | "INVOICE", userId: string, ip: string) {
  assertUuid(documentId, "A bizonylat nem található.");
  const [rec] = await tx
    .select()
    .from(integrationRecords)
    .where(and(eq(integrationRecords.companyId, companyId), eq(integrationRecords.documentId, documentId), eq(integrationRecords.kind, "PURCHASE")))
    .for("update");
  if (!rec) throw notFound("Ez a bizonylat nem Készlet-beszerzésből készült.");
  const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId)).for("update");
  if (!doc || doc.status !== "DRAFT") throw conflict("Csak piszkozat dátuma választható.");
  const date = choice === "RECEIVED" ? rec.receivedDate : rec.invoiceDate;
  if (!date) throw validationError({ choice: "Ehhez a beszerzéshez nincs számladátum; a bevételezés dátumát válassza, vagy írja be kézzel." });
  // A dátum másik üzleti évbe is eshet (pl. számla december 31., bevételezés január 2.).
  const [fy] = await tx.select({ id: fiscalYears.id }).from(fiscalYears).where(and(eq(fiscalYears.companyId, companyId), lte(fiscalYears.startDate, date), gte(fiscalYears.endDate, date)));
  if (!fy) throw validationError({ choice: `A választott dátum (${date}) egyik üzleti évbe sem esik; előbb hozza létre az üzleti évet.` });
  await tx.update(documents).set({ accountingDate: date, fiscalYearId: fy.id, updatedAt: new Date() }).where(eq(documents.id, documentId));
  await tx.update(integrationRecords).set({ needsDateChoice: false }).where(eq(integrationRecords.id, rec.id));
  await writeAudit(tx, { companyId, userId, action: "integration.date_choice", entityType: "document", entityId: documentId, before: { accountingDate: doc.accountingDate }, after: { accountingDate: date, choice }, ip });
}
