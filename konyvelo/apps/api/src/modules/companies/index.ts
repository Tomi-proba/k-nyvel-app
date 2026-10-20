import { and, count, eq, sql } from "drizzle-orm";
import {
  companyCreateSchema,
  companyUpdateSchema,
  memberAddSchema,
  memberUpdateSchema,
  type CompanyDto,
  type MemberDto,
} from "@konyvelo/shared";
import { diff, writeAudit } from "../../core/audit";
import { seedDefaultChart } from "../accounts";
import { seedDefaultTemplates } from "../templates";
import { hashPassword, requireCompanyPermission, requireUser } from "../../core/auth";
import { pgConstraint, pgErrorCode, PG_UNIQUE_VIOLATION, type Tx } from "../../core/db";
import { assertUuid, conflict, notFound, parseBody, validationError } from "../../core/errors";
import type { AppModule } from "../../core/modules";
import { companies, companyMemberships, users } from "../../core/schema";

type CompanyRow = typeof companies.$inferSelect;

function toDto(c: CompanyRow): CompanyDto {
  return {
    id: c.id,
    name: c.name,
    shortName: c.shortName,
    taxNumber: c.taxNumber,
    communityVatNumber: c.communityVatNumber,
    registrationNumber: c.registrationNumber,
    addressPostalCode: c.addressPostalCode,
    addressCity: c.addressCity,
    addressLine: c.addressLine,
    representativeName: c.representativeName,
    bookCurrency: c.bookCurrency,
    balanceSheetVariant: c.balanceSheetVariant,
    incomeStatementMethod: c.incomeStatementMethod,
    reportType: c.reportType,
    significantErrorThreshold: c.significantErrorThreshold,
    fxRateSource: c.fxRateSource,
    reversalMethod: c.reversalMethod,
    createdAt: c.createdAt.toISOString(),
  };
}

/** Az audit naplóba kerülő, módosítható cégadatok. */
function auditable(c: CompanyRow) {
  const { id: _id, createdAt: _c, ...rest } = toDto(c);
  return rest;
}

function taxNumberConflict(err: unknown): never {
  if (pgErrorCode(err) === PG_UNIQUE_VIOLATION && pgConstraint(err) === "companies_tax_number_uq") {
    throw validationError({ taxNumber: "Ezzel az adószámmal már van cég a rendszerben." });
  }
  throw err;
}

async function countAdmins(tx: Tx, companyId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(companyMemberships)
    .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.role, "ADMIN")));
  return row?.n ?? 0;
}

export const companiesModule: AppModule = {
  name: "companies",
  register(app, { db }) {
    app.get("/api/companies", async (request) => {
      const user = requireUser(request);
      const rows = await db
        .select({ company: companies, role: companyMemberships.role })
        .from(companyMemberships)
        .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
        .where(eq(companyMemberships.userId, user.id))
        .orderBy(companies.shortName);
      return rows.map((r) => ({ ...toDto(r.company), role: r.role }));
    });

    /** Új cég; a létrehozó a cég Adminisztrátora lesz. */
    app.post("/api/companies", async (request, reply) => {
      const user = requireUser(request);
      const input = parseBody(companyCreateSchema, request.body);
      const created = await db
        .transaction(async (tx) => {
          const [c] = await tx
            .insert(companies)
            .values({ ...input, significantErrorThreshold: input.significantErrorThreshold ?? null, createdBy: user.id })
            .returning();
          await tx.insert(companyMemberships).values({ companyId: c!.id, userId: user.id, role: "ADMIN", createdBy: user.id });
          await writeAudit(tx, {
            companyId: c!.id,
            userId: user.id,
            action: "company.create",
            entityType: "company",
            entityId: c!.id,
            after: auditable(c!),
            ip: request.ip,
          });
          await writeAudit(tx, {
            companyId: c!.id,
            userId: user.id,
            action: "member.add",
            entityType: "membership",
            entityId: user.id,
            after: { email: user.email, role: "ADMIN" },
            ip: request.ip,
          });
          // Új cég az alapértelmezett számlatükörrel indul (később szabadon módosítható).
          const seeded = await seedDefaultChart(tx, c!.id, user.id);
          await writeAudit(tx, {
            companyId: c!.id,
            userId: user.id,
            action: "accounts.load_default",
            entityType: "account",
            entityId: null,
            after: { count: seeded },
            ip: request.ip,
          });
          // …és a gyakori kontírozások alapértelmezett sablonjaival.
          const templates = await seedDefaultTemplates(tx, c!.id, user.id);
          await writeAudit(tx, {
            companyId: c!.id,
            userId: user.id,
            action: "templates.load_default",
            entityType: "template",
            entityId: null,
            after: { count: templates },
            ip: request.ip,
          });
          return c!;
        })
        .catch(taxNumberConflict);
      return reply.code(201).send(toDto(created));
    });

    app.get<{ Params: { companyId: string } }>("/api/companies/:companyId", async (request) => {
      await requireCompanyPermission(db, request, request.params.companyId, "company:read");
      const [c] = await db.select().from(companies).where(eq(companies.id, request.params.companyId));
      if (!c) throw notFound("A cég nem található.");
      return toDto(c);
    });

    app.patch<{ Params: { companyId: string } }>("/api/companies/:companyId", async (request) => {
      const { user } = await requireCompanyPermission(db, request, request.params.companyId, "company:update");
      const input = parseBody(companyUpdateSchema, request.body);
      const updated = await db
        .transaction(async (tx) => {
          const [before] = await tx
            .select()
            .from(companies)
            .where(eq(companies.id, request.params.companyId))
            .for("update");
          if (!before) throw notFound("A cég nem található.");
          const [after] = await tx
            .update(companies)
            .set({ ...input, updatedAt: new Date() })
            .where(eq(companies.id, before.id))
            .returning();
          const changes = diff(auditable(before), auditable(after!));
          if (Object.keys(changes.after).length > 0) {
            await writeAudit(tx, {
              companyId: before.id,
              userId: user.id,
              action: "company.update",
              entityType: "company",
              entityId: before.id,
              before: changes.before,
              after: changes.after,
              ip: request.ip,
            });
          }
          return after!;
        })
        .catch(taxNumberConflict);
      return toDto(updated);
    });

    // ---------- Tagok (felhasználók a cégben) ----------

    app.get<{ Params: { companyId: string } }>("/api/companies/:companyId/members", async (request): Promise<MemberDto[]> => {
      await requireCompanyPermission(db, request, request.params.companyId, "members:manage");
      const rows = await db
        .select({
          userId: users.id,
          email: users.email,
          name: users.name,
          isActive: users.isActive,
          role: companyMemberships.role,
          createdAt: companyMemberships.createdAt,
        })
        .from(companyMemberships)
        .innerJoin(users, eq(users.id, companyMemberships.userId))
        .where(eq(companyMemberships.companyId, request.params.companyId))
        .orderBy(users.name);
      return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    });

    /**
     * Felhasználó hozzáadása a céghez. Ha az e-mail-címmel még nincs
     * felhasználó, létrehozzuk a megadott kezdő jelszóval; első belépéskor
     * jelszót kell cserélnie.
     */
    app.post<{ Params: { companyId: string } }>("/api/companies/:companyId/members", async (request, reply) => {
      const companyId = request.params.companyId;
      const { user: actor } = await requireCompanyPermission(db, request, companyId, "members:manage");
      const input = parseBody(memberAddSchema, request.body);
      const passwordHash = input.initialPassword ? await hashPassword(input.initialPassword) : null;

      await db.transaction(async (tx) => {
        let [target] = await tx
          .select({ id: users.id, email: users.email, name: users.name })
          .from(users)
          .where(sql`lower(${users.email}) = ${input.email}`)
          .limit(1);

        if (!target) {
          const fields: Record<string, string> = {};
          if (!input.name) fields.name = "Új felhasználónál a név kötelező.";
          if (!passwordHash) fields.initialPassword = "Új felhasználónál meg kell adni a kezdő jelszót.";
          if (Object.keys(fields).length) throw validationError(fields);
          [target] = await tx
            .insert(users)
            .values({ email: input.email, name: input.name!, passwordHash: passwordHash!, mustChangePassword: true, createdBy: actor.id })
            .returning({ id: users.id, email: users.email, name: users.name });
          await writeAudit(tx, {
            companyId,
            userId: actor.id,
            action: "user.create",
            entityType: "user",
            entityId: target!.id,
            after: { email: target!.email, name: target!.name },
            ip: request.ip,
          });
        }

        const [existing] = await tx
          .select()
          .from(companyMemberships)
          .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.userId, target!.id)));
        if (existing) throw conflict("Ez a felhasználó már hozzá van rendelve a céghez.", { email: "Már tagja a cégnek." });

        await tx.insert(companyMemberships).values({ companyId, userId: target!.id, role: input.role, createdBy: actor.id });
        await writeAudit(tx, {
          companyId,
          userId: actor.id,
          action: "member.add",
          entityType: "membership",
          entityId: target!.id,
          after: { email: target!.email, role: input.role },
          ip: request.ip,
        });
      });
      return reply.code(201).send({ ok: true });
    });

    app.patch<{ Params: { companyId: string; userId: string } }>(
      "/api/companies/:companyId/members/:userId",
      async (request) => {
        const { companyId, userId } = request.params;
        const { user: actor } = await requireCompanyPermission(db, request, companyId, "members:manage");
        assertUuid(userId, "A felhasználó nem tagja a cégnek.");
        const input = parseBody(memberUpdateSchema, request.body);
        await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"members:" + companyId}, 0))`);
          const [m] = await tx
            .select()
            .from(companyMemberships)
            .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.userId, userId)));
          if (!m) throw notFound("A felhasználó nem tagja a cégnek.");
          if (m.role === input.role) return;
          if (m.role === "ADMIN" && (await countAdmins(tx, companyId)) <= 1) {
            throw conflict("A cégnek legalább egy Adminisztrátora kell, hogy legyen.");
          }
          await tx
            .update(companyMemberships)
            .set({ role: input.role })
            .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.userId, userId)));
          await writeAudit(tx, {
            companyId,
            userId: actor.id,
            action: "member.update",
            entityType: "membership",
            entityId: userId,
            before: { role: m.role },
            after: { role: input.role },
            ip: request.ip,
          });
        });
        return { ok: true };
      },
    );

    app.delete<{ Params: { companyId: string; userId: string } }>(
      "/api/companies/:companyId/members/:userId",
      async (request) => {
        const { companyId, userId } = request.params;
        const { user: actor } = await requireCompanyPermission(db, request, companyId, "members:manage");
        assertUuid(userId, "A felhasználó nem tagja a cégnek.");
        await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"members:" + companyId}, 0))`);
          const [m] = await tx
            .select()
            .from(companyMemberships)
            .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.userId, userId)));
          if (!m) throw notFound("A felhasználó nem tagja a cégnek.");
          if (m.role === "ADMIN" && (await countAdmins(tx, companyId)) <= 1) {
            throw conflict("A cégnek legalább egy Adminisztrátora kell, hogy legyen.");
          }
          await tx
            .delete(companyMemberships)
            .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.userId, userId)));
          await writeAudit(tx, {
            companyId,
            userId: actor.id,
            action: "member.remove",
            entityType: "membership",
            entityId: userId,
            before: { role: m.role },
            ip: request.ip,
          });
        });
        return { ok: true };
      },
    );
  },
};
