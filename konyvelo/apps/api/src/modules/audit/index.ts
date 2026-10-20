import { and, desc, eq, lt } from "drizzle-orm";
import type { AuditEntryDto, AuditVerifyResponse } from "@konyvelo/shared";
import { verifyChain } from "../../core/audit";
import { requireCompanyPermission } from "../../core/auth";
import type { AppModule } from "../../core/modules";
import { auditLog, users } from "../../core/schema";

export const auditModule: AppModule = {
  name: "audit",
  register(app, { db }) {
    /** Az audit napló lapozva, a legújabb bejegyzéstől visszafelé. */
    app.get<{ Params: { companyId: string }; Querystring: { before?: string; limit?: string } }>(
      "/api/companies/:companyId/audit-log",
      async (request): Promise<{ entries: AuditEntryDto[]; nextBefore: string | null }> => {
        const companyId = request.params.companyId;
        await requireCompanyPermission(db, request, companyId, "audit:read");
        const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 200);
        const before = Number(request.query.before);
        const rows = await db
          .select({
            id: auditLog.id,
            at: auditLog.at,
            userName: users.name,
            action: auditLog.action,
            entityType: auditLog.entityType,
            entityId: auditLog.entityId,
            before: auditLog.before,
            after: auditLog.after,
          })
          .from(auditLog)
          .leftJoin(users, eq(users.id, auditLog.userId))
          .where(
            Number.isSafeInteger(before) && before > 0
              ? and(eq(auditLog.companyId, companyId), lt(auditLog.id, before))
              : eq(auditLog.companyId, companyId),
          )
          .orderBy(desc(auditLog.id))
          .limit(limit + 1);
        const page = rows.slice(0, limit);
        return {
          entries: page.map((r) => ({ ...r, id: String(r.id), at: r.at.toISOString() })),
          nextBefore: rows.length > limit ? String(page.at(-1)!.id) : null,
        };
      },
    );

    /** A cég audit-láncának teljes ellenőrzése (utólagos módosítás kimutatása). */
    app.get<{ Params: { companyId: string } }>(
      "/api/companies/:companyId/audit-log/verify",
      async (request): Promise<AuditVerifyResponse> => {
        await requireCompanyPermission(db, request, request.params.companyId, "audit:read");
        const r = await verifyChain(db, request.params.companyId);
        return r.ok ? r : { ...r, brokenAtId: String(r.brokenAtId) };
      },
    );
  },
};
