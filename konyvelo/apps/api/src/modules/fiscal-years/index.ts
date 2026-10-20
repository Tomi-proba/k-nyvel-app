import { asc, eq, inArray, sql } from "drizzle-orm";
import { generateMonthlyPeriods, suggestNextFiscalYear, todayIso, validateFiscalYear } from "@konyvelo/domain";
import { fiscalYearCreateSchema, type FiscalYearDto } from "@konyvelo/shared";
import { writeAudit } from "../../core/audit";
import { requireCompanyPermission } from "../../core/auth";
import { pgErrorCode, PG_EXCLUSION_VIOLATION, type Executor } from "../../core/db";
import { parseBody, validationError } from "../../core/errors";
import type { AppModule } from "../../core/modules";
import { fiscalYears, periods } from "../../core/schema";

async function listFiscalYears(db: Executor, companyId: string): Promise<FiscalYearDto[]> {
  const years = await db.select().from(fiscalYears).where(eq(fiscalYears.companyId, companyId)).orderBy(asc(fiscalYears.startDate));
  if (years.length === 0) return [];
  const allPeriods = await db
    .select()
    .from(periods)
    .where(inArray(periods.fiscalYearId, years.map((y) => y.id)))
    .orderBy(asc(periods.startDate));
  return years.map((y) => ({
    id: y.id,
    startDate: y.startDate,
    endDate: y.endDate,
    status: y.status,
    exceptionReason: y.exceptionReason,
    retentionUntil: y.retentionUntil,
    periods: allPeriods
      .filter((p) => p.fiscalYearId === y.id)
      .map((p) => ({ id: p.id, startDate: p.startDate, endDate: p.endDate, status: p.status })),
  }));
}

export const fiscalYearsModule: AppModule = {
  name: "fiscal-years",
  register(app, { db }) {
    app.get<{ Params: { companyId: string } }>("/api/companies/:companyId/fiscal-years", async (request) => {
      await requireCompanyPermission(db, request, request.params.companyId, "company:read");
      return listFiscalYears(db, request.params.companyId);
    });

    /** Javasolt dátumok a következő üzleti évhez (az űrlap előkitöltéséhez). */
    app.get<{ Params: { companyId: string } }>("/api/companies/:companyId/fiscal-years/suggestion", async (request) => {
      await requireCompanyPermission(db, request, request.params.companyId, "company:read");
      const existing = await db
        .select({ startDate: fiscalYears.startDate, endDate: fiscalYears.endDate })
        .from(fiscalYears)
        .where(eq(fiscalYears.companyId, request.params.companyId));
      return suggestNextFiscalYear(existing, todayIso());
    });

    /** Új üzleti év a havi időszakaival együtt. */
    app.post<{ Params: { companyId: string } }>("/api/companies/:companyId/fiscal-years", async (request, reply) => {
      const companyId = request.params.companyId;
      const { user } = await requireCompanyPermission(db, request, companyId, "fiscalYear:manage");
      const input = parseBody(fiscalYearCreateSchema, request.body);

      const id = await db
        .transaction(async (tx) => {
          // Egyidejű létrehozásnál is helyes legyen a folytonosság-ellenőrzés.
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"fiscal-years:" + companyId}, 0))`);
          const existing = await tx
            .select({ startDate: fiscalYears.startDate, endDate: fiscalYears.endDate })
            .from(fiscalYears)
            .where(eq(fiscalYears.companyId, companyId));
          const errors = validateFiscalYear(input, existing);
          if (errors.length) {
            throw validationError(Object.fromEntries(errors.map((e) => [e.field, e.message])));
          }

          const [fy] = await tx
            .insert(fiscalYears)
            .values({
              companyId,
              startDate: input.startDate,
              endDate: input.endDate,
              exceptionReason: input.exceptionReason ?? null,
              createdBy: user.id,
            })
            .returning({ id: fiscalYears.id });
          const monthly = generateMonthlyPeriods(input);
          await tx.insert(periods).values(monthly.map((p) => ({ companyId, fiscalYearId: fy!.id, ...p })));

          await writeAudit(tx, {
            companyId,
            userId: user.id,
            action: "fiscal_year.create",
            entityType: "fiscal_year",
            entityId: fy!.id,
            after: {
              startDate: input.startDate,
              endDate: input.endDate,
              exceptionReason: input.exceptionReason ?? null,
              periods: monthly.length,
            },
            ip: request.ip,
          });
          return fy!.id;
        })
        .catch((err: unknown) => {
          if (pgErrorCode(err) === PG_EXCLUSION_VIOLATION) {
            throw validationError({ startDate: "Az üzleti év átfedésben van egy már rögzített üzleti évvel." });
          }
          throw err;
        });

      const all = await listFiscalYears(db, companyId);
      return reply.code(201).send(all.find((y) => y.id === id));
    });
  },
};
