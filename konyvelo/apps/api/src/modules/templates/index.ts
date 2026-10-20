import { and, asc, count, eq, sql } from "drizzle-orm";
import type { AmountBase, DocumentType, LineSide } from "@konyvelo/domain";
import { templateCreateSchema, templateUpdateSchema, type TemplateCreateInput, type TemplateDto, type TemplateUpdateInput } from "@konyvelo/shared";
import { diff, writeAudit } from "../../core/audit";
import { requireCompanyPermission } from "../../core/auth";
import { pgErrorCode, PG_UNIQUE_VIOLATION, type Executor, type Tx } from "../../core/db";
import { assertUuid, conflict, notFound, parseBody, validationError } from "../../core/errors";
import type { AppModule } from "../../core/modules";
import { partners, postingTemplates } from "../../core/schema";
import { listAccounts } from "../accounts";

type TemplateRow = typeof postingTemplates.$inferSelect;

/**
 * Alapértelmezett kontírozási sablonok (szakmai gyakorlat szerinti minták,
 * az alapértelmezett számlatükör számlaszámaival). Cégenként szabadon
 * módosíthatók, törölhetők.
 */
const DEFAULT_TEMPLATES: Array<{
  name: string;
  shortcut: string;
  docType: DocumentType;
  vatRate: number | null;
  lines: Array<[string, LineSide, AmountBase]>;
}> = [
  { name: "Szállítói számla – szolgáltatás, 27% áfa", shortcut: "SZOLG", docType: "SZSZ", vatRate: 27, lines: [["529", "D", "NET"], ["466", "D", "VAT"], ["454", "C", "GROSS"]] },
  { name: "Szállítói számla – anyagbeszerzés, 27% áfa", shortcut: "ANYAG", docType: "SZSZ", vatRate: 27, lines: [["511", "D", "NET"], ["466", "D", "VAT"], ["454", "C", "GROSS"]] },
  { name: "Vevőszámla – szolgáltatás, 27% áfa", shortcut: "VEVO", docType: "VSZ", vatRate: 27, lines: [["311", "D", "GROSS"], ["912", "C", "NET"], ["467", "C", "VAT"]] },
  { name: "Banki kifizetés szállítónak", shortcut: "BKI", docType: "BANK", vatRate: null, lines: [["454", "D", "GROSS"], ["384", "C", "GROSS"]] },
  { name: "Banki jóváírás vevőtől", shortcut: "BBE", docType: "BANK", vatRate: null, lines: [["384", "D", "GROSS"], ["311", "C", "GROSS"]] },
  { name: "Bankköltség", shortcut: "BKTG", docType: "BANK", vatRate: null, lines: [["532", "D", "GROSS"], ["384", "C", "GROSS"]] },
];

/** Az alapértelmezett sablonok betöltése (cég létrehozásakor vagy kérésre); a hiányzó számlájú sablon kimarad. */
export async function seedDefaultTemplates(tx: Tx, companyId: string, userId: string): Promise<number> {
  const accounts = await listAccounts(tx, companyId);
  const byNumber = new Map(accounts.filter((a) => a.isActive && !a.hasChildren).map((a) => [a.number, a.id]));
  const rows = DEFAULT_TEMPLATES.filter((t) => t.lines.every(([n]) => byNumber.has(n))).map((t) => ({
    companyId,
    createdBy: userId,
    name: t.name,
    shortcut: t.shortcut,
    docType: t.docType,
    vatRate: t.vatRate,
    lines: t.lines.map(([n, side, base]) => ({ accountId: byNumber.get(n)!, side, base })),
  }));
  if (rows.length) await tx.insert(postingTemplates).values(rows);
  return rows.length;
}

function toDto(t: TemplateRow): TemplateDto {
  return {
    id: t.id,
    name: t.name,
    shortcut: t.shortcut,
    docType: t.docType,
    description: t.description,
    vatRate: t.vatRate,
    partnerId: t.partnerId,
    lines: t.lines,
    isActive: t.isActive,
  };
}

function auditable(t: TemplateRow) {
  const { id: _i, companyId: _c, createdAt: _ca, createdBy: _cb, updatedAt: _u, ...rest } = t;
  return rest;
}

async function validateRefs(db: Executor, companyId: string, input: TemplateCreateInput | TemplateUpdateInput) {
  const errors: Record<string, string> = {};
  if (input.lines) {
    const accounts = new Map((await listAccounts(db, companyId)).map((a) => [a.id, a]));
    input.lines.forEach((l, i) => {
      const a = accounts.get(l.accountId);
      if (!a) errors[`lines.${i}.accountId`] = "A választott számla nem található ebben a cégben.";
      else if (a.hasChildren) errors[`lines.${i}.accountId`] = `A(z) ${a.number} gyűjtőszámla; válasszon alszámlát.`;
      else if (!a.isActive) errors[`lines.${i}.accountId`] = `A(z) ${a.number} számla inaktív.`;
    });
    if (!input.lines.some((l) => l.side === "D") || !input.lines.some((l) => l.side === "C")) {
      errors.lines = "A sablonban tartozik és követel oldali sor is kell.";
    }
  }
  if (input.partnerId) {
    const [p] = await db.select({ id: partners.id }).from(partners).where(and(eq(partners.companyId, companyId), eq(partners.id, input.partnerId)));
    if (!p) errors.partnerId = "A választott partner nem található.";
  }
  if (Object.keys(errors).length) throw validationError(errors);
}

function mapDbError(err: unknown): never {
  if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) throw validationError({ shortcut: "Ez a rövid kód már foglalt." });
  throw err;
}

async function loadTemplate(db: Executor, companyId: string, id: string): Promise<TemplateRow> {
  assertUuid(id, "A sablon nem található.");
  const [row] = await db
    .select()
    .from(postingTemplates)
    .where(and(eq(postingTemplates.companyId, companyId), eq(postingTemplates.id, id)));
  if (!row) throw notFound("A sablon nem található.");
  return row;
}

export const templatesModule: AppModule = {
  name: "templates",
  register(app, { db }) {
    const base = "/api/companies/:companyId/templates";
    type P = { Params: { companyId: string } };
    type PT = { Params: { companyId: string; templateId: string } };

    app.get<P>(base, async (request) => {
      await requireCompanyPermission(db, request, request.params.companyId, "company:read");
      const rows = await db
        .select()
        .from(postingTemplates)
        .where(eq(postingTemplates.companyId, request.params.companyId))
        .orderBy(asc(sql`lower(${postingTemplates.name})`));
      return rows.map(toDto);
    });

    app.post<P>(`${base}/load-default`, async (request, reply) => {
      const { companyId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      const n = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"templates:" + companyId}, 0))`);
        const [row] = await tx.select({ n: count() }).from(postingTemplates).where(eq(postingTemplates.companyId, companyId));
        if ((row?.n ?? 0) > 0) throw conflict("A cégnek már vannak sablonjai; az alapértelmezettek csak üres sablonlistába tölthetők be.");
        const seeded = await seedDefaultTemplates(tx, companyId, user.id);
        await writeAudit(tx, { companyId, userId: user.id, action: "templates.load_default", entityType: "template", entityId: null, after: { count: seeded }, ip: request.ip });
        return seeded;
      });
      return reply.code(201).send({ count: n });
    });

    app.post<P>(base, async (request, reply) => {
      const { companyId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      const input = parseBody(templateCreateSchema, request.body);
      await validateRefs(db, companyId, input);
      const row = await db
        .transaction(async (tx) => {
          const [created] = await tx
            .insert(postingTemplates)
            .values({ ...input, companyId, createdBy: user.id })
            .returning();
          await writeAudit(tx, { companyId, userId: user.id, action: "template.create", entityType: "template", entityId: created!.id, after: auditable(created!), ip: request.ip });
          return created!;
        })
        .catch(mapDbError);
      return reply.code(201).send(toDto(row));
    });

    app.patch<PT>(`${base}/:templateId`, async (request) => {
      const { companyId, templateId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      const input = parseBody(templateUpdateSchema, request.body);
      await validateRefs(db, companyId, input);
      const row = await db
        .transaction(async (tx) => {
          const before = await loadTemplate(tx, companyId, templateId);
          const [after] = await tx
            .update(postingTemplates)
            .set({ ...input, updatedAt: new Date() })
            .where(eq(postingTemplates.id, before.id))
            .returning();
          const changes = diff(auditable(before), auditable(after!));
          if (Object.keys(changes.after).length) {
            await writeAudit(tx, {
              companyId,
              userId: user.id,
              action: "template.update",
              entityType: "template",
              entityId: before.id,
              before: { name: before.name, ...changes.before },
              after: changes.after,
              ip: request.ip,
            });
          }
          return after!;
        })
        .catch(mapDbError);
      return toDto(row);
    });

    app.delete<PT>(`${base}/:templateId`, async (request) => {
      const { companyId, templateId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "ledger:post");
      await db.transaction(async (tx) => {
        const row = await loadTemplate(tx, companyId, templateId);
        await tx.delete(postingTemplates).where(eq(postingTemplates.id, row.id));
        await writeAudit(tx, { companyId, userId: user.id, action: "template.delete", entityType: "template", entityId: row.id, before: auditable(row), ip: request.ip });
      });
      return { ok: true };
    });
  },
};
