import { and, asc, count, eq, sql } from "drizzle-orm";
import { accountClass, buildAccountTree, defaultsForClass, DEFAULT_CHART, findParentNumber } from "@konyvelo/domain";
import { accountCreateSchema, accountUpdateSchema, type AccountDto } from "@konyvelo/shared";
import { diff, writeAudit } from "../../core/audit";
import { requireCompanyPermission } from "../../core/auth";
import { pgErrorCode, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION, type Executor, type Tx } from "../../core/db";
import { assertUuid, conflict, notFound, parseBody, validationError } from "../../core/errors";
import type { AppModule } from "../../core/modules";
import { accounts } from "../../core/schema";

type AccountRow = typeof accounts.$inferSelect;

export async function listAccounts(db: Executor, companyId: string): Promise<AccountDto[]> {
  const rows = await db.select().from(accounts).where(eq(accounts.companyId, companyId)).orderBy(asc(accounts.number));
  return buildAccountTree(rows).map((a) => ({
    id: a.id,
    number: a.number,
    name: a.name,
    accountClass: a.accountClass ?? accountClass(a.number),
    nature: a.nature,
    normalSide: a.normalSide,
    subledger: a.subledger,
    description: a.description,
    isActive: a.isActive,
    level: a.level,
    hasChildren: a.hasChildren,
    parentNumber: a.parentNumber,
    bsLineDebit: a.bsLineDebit,
    bsLineCredit: a.bsLineCredit,
    isLine: a.isLine,
  }));
}

/** Az alapértelmezett számlatükör bemásolása a céghez (cég létrehozásakor vagy kérésre). */
export async function seedDefaultChart(tx: Tx, companyId: string, userId: string): Promise<number> {
  const rows = DEFAULT_CHART.map((a) => ({
    companyId,
    createdBy: userId,
    number: a.number,
    name: a.name,
    nature: a.nature,
    normalSide: a.normalSide,
    subledger: a.subledger,
    description: a.description,
    bsLineDebit: a.bsDebit,
    bsLineCredit: a.bsCredit,
    isLine: a.isLine,
  }));
  await tx.insert(accounts).values(rows);
  return rows.length;
}

function auditable(a: AccountRow) {
  return {
    number: a.number,
    name: a.name,
    nature: a.nature,
    normalSide: a.normalSide,
    subledger: a.subledger,
    description: a.description,
    isActive: a.isActive,
    bsLineDebit: a.bsLineDebit,
    bsLineCredit: a.bsLineCredit,
    isLine: a.isLine,
  };
}

async function loadAccount(tx: Executor, companyId: string, accountId: string): Promise<AccountRow> {
  assertUuid(accountId, "A számla nem található.");
  const [row] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.id, accountId)))
    .limit(1);
  if (!row) throw notFound("A számla nem található.");
  return row;
}

export const accountsModule: AppModule = {
  name: "accounts",
  register(app, { db }) {
    const base = "/api/companies/:companyId/accounts";
    type P = { Params: { companyId: string } };
    type PA = { Params: { companyId: string; accountId: string } };

    app.get<P>(base, async (request) => {
      await requireCompanyPermission(db, request, request.params.companyId, "company:read");
      return listAccounts(db, request.params.companyId);
    });

    /** Az alapértelmezett számlatükör betöltése – csak üres számlatükörnél. */
    app.post<P>(`${base}/load-default`, async (request, reply) => {
      const companyId = request.params.companyId;
      const { user } = await requireCompanyPermission(db, request, companyId, "accounts:manage");
      const n = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"accounts:" + companyId}, 0))`);
        const [row] = await tx.select({ n: count() }).from(accounts).where(eq(accounts.companyId, companyId));
        if ((row?.n ?? 0) > 0) throw conflict("A cégnek már van számlatükre; az alapértelmezett csak üres számlatükörbe tölthető be.");
        const seeded = await seedDefaultChart(tx, companyId, user.id);
        await writeAudit(tx, {
          companyId,
          userId: user.id,
          action: "accounts.load_default",
          entityType: "account",
          entityId: null,
          after: { count: seeded },
          ip: request.ip,
        });
        return seeded;
      });
      return reply.code(201).send({ count: n });
    });

    app.post<P>(base, async (request, reply) => {
      const companyId = request.params.companyId;
      const { user } = await requireCompanyPermission(db, request, companyId, "accounts:manage");
      const input = parseBody(accountCreateSchema, request.body);

      const created = await db
        .transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"accounts:" + companyId}, 0))`);
          const existing = await tx
            .select({
              number: accounts.number,
              nature: accounts.nature,
              normalSide: accounts.normalSide,
              subledger: accounts.subledger,
              bsLineDebit: accounts.bsLineDebit,
              bsLineCredit: accounts.bsLineCredit,
              isLine: accounts.isLine,
            })
            .from(accounts)
            .where(eq(accounts.companyId, companyId));
          if (existing.some((a) => a.number === input.number)) {
            throw validationError({ number: `A(z) ${input.number} számlaszám már létezik.` });
          }
          // Alapértelmezés: a szülőszámla jellege, analitikája és kimutatássora, ennek hiányában a számlaosztályé.
          const parentNumber = findParentNumber(input.number, existing.map((a) => a.number));
          const parent = existing.find((a) => a.number === parentNumber);
          const classDefaults = defaultsForClass(accountClass(input.number));
          const [row] = await tx
            .insert(accounts)
            .values({
              companyId,
              number: input.number,
              name: input.name,
              nature: input.nature ?? parent?.nature ?? classDefaults.nature,
              normalSide: input.normalSide ?? parent?.normalSide ?? classDefaults.normalSide,
              subledger: input.subledger ?? parent?.subledger ?? "NONE",
              description: input.description ?? null,
              bsLineDebit: input.bsLineDebit !== undefined ? input.bsLineDebit : (parent?.bsLineDebit ?? null),
              bsLineCredit: input.bsLineCredit !== undefined ? input.bsLineCredit : (parent?.bsLineCredit ?? null),
              isLine: input.isLine !== undefined ? input.isLine : (parent?.isLine ?? null),
              createdBy: user.id,
            })
            .returning();
          await writeAudit(tx, {
            companyId,
            userId: user.id,
            action: "account.create",
            entityType: "account",
            entityId: row!.id,
            after: auditable(row!),
            ip: request.ip,
          });
          return row!;
        })
        .catch((err: unknown) => {
          if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) throw validationError({ number: `A(z) ${input.number} számlaszám már létezik.` });
          throw err;
        });

      const all = await listAccounts(db, companyId);
      return reply.code(201).send(all.find((a) => a.id === created.id));
    });

    app.patch<PA>(`${base}/:accountId`, async (request) => {
      const { companyId, accountId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "accounts:manage");
      if (request.body && typeof request.body === "object" && "number" in request.body) {
        throw validationError({ number: "A számlaszám nem módosítható. Hozzon létre új számlát, a régit pedig inaktiválja." });
      }
      const input = parseBody(accountUpdateSchema, request.body);
      await db.transaction(async (tx) => {
        const before = await loadAccount(tx, companyId, accountId);
        const [after] = await tx
          .update(accounts)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(accounts.id, before.id))
          .returning();
        const changes = diff(auditable(before), auditable(after!));
        if (Object.keys(changes.after).length > 0) {
          await writeAudit(tx, {
            companyId,
            userId: user.id,
            action: "account.update",
            entityType: "account",
            entityId: before.id,
            before: { number: before.number, ...changes.before },
            after: changes.after,
            ip: request.ip,
          });
        }
      });
      const all = await listAccounts(db, companyId);
      return all.find((a) => a.id === accountId);
    });

    /**
     * Törlés: csak alszámla nélküli és sehol nem használt számla törölhető.
     * A használatot az adatbázis idegenkulcsai ellenőrzik (partner
     * alapértelmezése, később könyvelési tételek); használt számlát
     * inaktiválni lehet.
     */
    app.delete<PA>(`${base}/:accountId`, async (request) => {
      const { companyId, accountId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "accounts:manage");
      await db
        .transaction(async (tx) => {
          const row = await loadAccount(tx, companyId, accountId);
          const [child] = await tx
            .select({ n: count() })
            .from(accounts)
            .where(and(eq(accounts.companyId, companyId), sql`${accounts.number} LIKE ${row.number + "%"}`, sql`${accounts.id} <> ${row.id}`));
          if ((child?.n ?? 0) > 0) {
            throw conflict(`A(z) ${row.number} számlának vannak alszámlái, ezért nem törölhető. Előbb az alszámlákat kell törölni.`);
          }
          await tx.delete(accounts).where(eq(accounts.id, row.id));
          await writeAudit(tx, {
            companyId,
            userId: user.id,
            action: "account.delete",
            entityType: "account",
            entityId: row.id,
            before: auditable(row),
            ip: request.ip,
          });
        })
        .catch((err: unknown) => {
          if (pgErrorCode(err) === PG_FOREIGN_KEY_VIOLATION) {
            throw conflict("A számla használatban van (pl. egy partner alapértelmezett számlája), ezért nem törölhető. Inaktiválja helyette.");
          }
          throw err;
        });
      return { ok: true };
    });
  },
};
