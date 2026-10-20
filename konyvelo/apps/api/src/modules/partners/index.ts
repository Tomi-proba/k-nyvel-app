import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { childNumbersOf, normalizeForSearch } from "@konyvelo/domain";
import { partnerCreateSchema, partnerUpdateSchema, type PartnerCreateInput, type PartnerDto, type PartnerUpdateInput } from "@konyvelo/shared";
import { diff, writeAudit } from "../../core/audit";
import { requireCompanyPermission } from "../../core/auth";
import { pgConstraint, pgErrorCode, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION, type Executor } from "../../core/db";
import { assertUuid, conflict, notFound, parseBody, validationError } from "../../core/errors";
import type { AppModule } from "../../core/modules";
import { accounts, partners } from "../../core/schema";

type PartnerRow = typeof partners.$inferSelect;

function toDto(p: PartnerRow): PartnerDto {
  const { companyId: _c, createdBy: _b, updatedAt: _u, anonymizedAt: _a, createdAt, ...rest } = p;
  return { ...rest, createdAt: createdAt.toISOString() };
}

function auditable(p: PartnerRow) {
  const { id: _i, companyId: _c, createdBy: _b, createdAt: _ca, updatedAt: _u, anonymizedAt: _a, ...rest } = p;
  return rest;
}

const DEFAULT_ACCOUNT_RULES = [
  {
    field: "defaultReceivableAccountId",
    label: "vevő",
    check: (a: { subledger: string }) => a.subledger === "CUSTOMER",
    message: "Vevőszámlaként csak vevőanalitikás számla választható (pl. 311).",
  },
  {
    field: "defaultPayableAccountId",
    label: "szállító",
    check: (a: { subledger: string }) => a.subledger === "SUPPLIER",
    message: "Szállítószámlaként csak szállítóanalitikás számla választható (pl. 454).",
  },
  {
    field: "defaultExpenseAccountId",
    label: "költség",
    check: (a: { accountClass: number | null }) => [1, 2, 5, 8].includes(a.accountClass ?? -1),
    message: "Költség- vagy eszközszámla választható (1., 2., 5. vagy 8. számlaosztály).",
  },
  {
    field: "defaultRevenueAccountId",
    label: "árbevétel",
    check: (a: { accountClass: number | null }) => a.accountClass === 9,
    message: "Árbevétel-számlaként a 9. számlaosztály számlái választhatók.",
  },
] as const;

/** Az alapértelmezett számlák a cég saját, aktív, könyvelhető és a szerepnek megfelelő számlái legyenek. */
async function validateDefaultAccounts(db: Executor, companyId: string, input: PartnerCreateInput | PartnerUpdateInput) {
  const ids = DEFAULT_ACCOUNT_RULES.map((r) => input[r.field]).filter((v): v is string => typeof v === "string");
  if (ids.length === 0) return;
  const all = await db
    .select({ id: accounts.id, number: accounts.number, subledger: accounts.subledger, accountClass: accounts.accountClass, isActive: accounts.isActive })
    .from(accounts)
    .where(eq(accounts.companyId, companyId));
  const errors: Record<string, string> = {};
  for (const rule of DEFAULT_ACCOUNT_RULES) {
    const id = input[rule.field];
    if (typeof id !== "string") continue;
    const acc = all.find((a) => a.id === id);
    if (!acc) errors[rule.field] = "A választott számla nem található ebben a cégben.";
    else if (!acc.isActive) errors[rule.field] = `A(z) ${acc.number} számla inaktív.`;
    else if (childNumbersOf(acc.number, all).length > 0) errors[rule.field] = `A(z) ${acc.number} gyűjtőszámla; válasszon alszámlát.`;
    else if (!rule.check(acc)) errors[rule.field] = rule.message;
  }
  if (Object.keys(errors).length) throw validationError(errors);
}

function mapDbError(err: unknown): never {
  if (pgErrorCode(err) === PG_UNIQUE_VIOLATION && pgConstraint(err) === "partners_company_tax_number_uq") {
    throw validationError({ taxNumber: "Ezzel az adószámmal már van partner a cégnél." });
  }
  throw err;
}

async function loadPartner(db: Executor, companyId: string, partnerId: string): Promise<PartnerRow> {
  assertUuid(partnerId, "A partner nem található.");
  const [row] = await db
    .select()
    .from(partners)
    .where(and(eq(partners.companyId, companyId), eq(partners.id, partnerId)))
    .limit(1);
  if (!row) throw notFound("A partner nem található.");
  return row;
}

export const partnersModule: AppModule = {
  name: "partners",
  register(app, { db }) {
    const base = "/api/companies/:companyId/partners";
    type P = { Params: { companyId: string }; Querystring: { q?: string; kind?: string; status?: string } };
    type PP = { Params: { companyId: string; partnerId: string } };

    /** Lista keresővel (név vagy adószám), típus és állapot szerinti szűréssel. */
    app.get<P>(base, async (request) => {
      const { companyId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      const { q, kind, status } = request.query;
      const conditions = [eq(partners.companyId, companyId)];
      if (kind === "CUSTOMER" || kind === "SUPPLIER") conditions.push(inArray(partners.kind, [kind, "BOTH"]));
      if (status === "ACTIVE" || status === "INACTIVE") conditions.push(eq(partners.status, status));
      else conditions.push(ne(partners.status, "ANONYMIZED"));
      const rows = await db.select().from(partners).where(and(...conditions)).orderBy(asc(sql`lower(${partners.name})`));
      const query = q?.trim();
      if (!query) return rows.map(toDto);
      const digits = query.replace(/\D/g, "");
      const nq = normalizeForSearch(query);
      return rows
        .filter(
          (p) =>
            normalizeForSearch(p.name).includes(nq) ||
            (digits.length >= 3 && (p.taxNumber ?? "").replace(/\D/g, "").startsWith(digits)),
        )
        .map(toDto);
    });

    app.get<PP>(`${base}/:partnerId`, async (request) => {
      const { companyId, partnerId } = request.params;
      await requireCompanyPermission(db, request, companyId, "company:read");
      return toDto(await loadPartner(db, companyId, partnerId));
    });

    app.post<{ Params: { companyId: string } }>(base, async (request, reply) => {
      const { companyId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "partners:manage");
      const input = parseBody(partnerCreateSchema, request.body);
      await validateDefaultAccounts(db, companyId, input);
      const row = await db
        .transaction(async (tx) => {
          const [created] = await tx
            .insert(partners)
            .values({ ...input, companyId, createdBy: user.id })
            .returning();
          await writeAudit(tx, {
            companyId,
            userId: user.id,
            action: "partner.create",
            entityType: "partner",
            entityId: created!.id,
            after: auditable(created!),
            ip: request.ip,
          });
          return created!;
        })
        .catch(mapDbError);
      return reply.code(201).send(toDto(row));
    });

    app.patch<PP>(`${base}/:partnerId`, async (request) => {
      const { companyId, partnerId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "partners:manage");
      const input = parseBody(partnerUpdateSchema, request.body);
      const current = await loadPartner(db, companyId, partnerId);
      if (current.status === "ANONYMIZED") throw conflict("Anonimizált partner nem módosítható.");
      // A szabályokat a meglévő és az új adatok együttesére is ellenőrizni kell
      // (pl. magánszemély + adószám, külföldi + magyar adószám).
      const merged = { ...current, ...input };
      if (merged.isPrivatePerson && merged.taxNumber) {
        throw validationError({ taxNumber: "Magánszemélynél ne adjon meg adószámot (adattakarékosság)." });
      }
      if (merged.taxNumber && merged.country !== "HU") {
        throw validationError({ taxNumber: "Magyar adószám csak magyarországi partnernél adható meg; külföldinél a közösségi adószámot használja." });
      }
      await validateDefaultAccounts(db, companyId, input);
      const row = await db
        .transaction(async (tx) => {
          const [before] = await tx.select().from(partners).where(eq(partners.id, partnerId)).for("update");
          const [after] = await tx
            .update(partners)
            .set({ ...input, updatedAt: new Date() })
            .where(eq(partners.id, partnerId))
            .returning();
          const changes = diff(auditable(before!), auditable(after!));
          if (Object.keys(changes.after).length > 0) {
            await writeAudit(tx, {
              companyId,
              userId: user.id,
              action: "partner.update",
              entityType: "partner",
              entityId: partnerId,
              before: { name: before!.name, ...changes.before },
              after: changes.after,
              ip: request.ip,
            });
          }
          return after!;
        })
        .catch(mapDbError);
      return toDto(row);
    });

    /**
     * Törlés csak akkor, ha a partner sehol nincs használva (ezt a későbbi
     * könyvelési tételek idegenkulcsa ellenőrzi). Használt partnert
     * inaktiválni lehet; a megőrzési idő alatt az adatai nem törölhetők.
     */
    app.delete<PP>(`${base}/:partnerId`, async (request) => {
      const { companyId, partnerId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "partners:manage");
      const row = await loadPartner(db, companyId, partnerId);
      await db
        .transaction(async (tx) => {
          await tx.delete(partners).where(eq(partners.id, row.id));
          await writeAudit(tx, {
            companyId,
            userId: user.id,
            action: "partner.delete",
            entityType: "partner",
            entityId: row.id,
            before: auditable(row),
            ip: request.ip,
          });
        })
        .catch((err: unknown) => {
          if (pgErrorCode(err) === PG_FOREIGN_KEY_VIOLATION) {
            throw conflict("A partnerre már van könyvelés, ezért nem törölhető. Inaktiválja helyette.");
          }
          throw err;
        });
      return { ok: true };
    });
  },
};
