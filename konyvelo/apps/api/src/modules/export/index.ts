import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { formatHuf } from "@konyvelo/domain";
import { EXPORT_FORMAT, EXPORT_MANIFEST, EXPORT_SUMS, type CompanyExportDto, type ExportManifest } from "@konyvelo/shared";
import { writeAudit } from "../../core/audit";
import { requireCompanyPermission } from "../../core/auth";
import type { Executor } from "../../core/db";
import type { AppModule } from "../../core/modules";
import {
  accounts,
  auditLog,
  companies,
  companyMemberships,
  documents,
  fiscalYears,
  journalLines,
  navConnections,
  navImportRuns,
  navInvoices,
  partners,
  periods,
  postingTemplates,
  settlements,
  users,
} from "../../core/schema";
import { buildZip } from "../../core/zip";

/**
 * Cégexport (PLAN 4.11, K8.2): egy cég összes adata egy ZIP-csomagban, JSON- (géppel olvasható) és
 * CSV-fájlokkal (magyar Excelhez), SHA-256-os tartalomjegyzékkel. Az export az audit naplóba kerül a
 * tartalomjegyzék lenyomatával, így egy későbbi ellenőrzés megmondja, hogy a csomag sértetlen-e.
 */

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** CSV a magyar Excelnek: pontosvessző, UTF-8 BOM; a képletnek látszó cellák elé aposztróf kerül. */
function csv(header: string[], rows: Array<Array<string | number | boolean | null | undefined>>): Buffer {
  const esc = (v: string | number | boolean | null | undefined) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = `'${s}`;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return Buffer.from("﻿" + [header, ...rows].map((r) => r.map(esc).join(";")).join("\r\n") + "\r\n", "utf8");
}

const json = (v: unknown) => Buffer.from(JSON.stringify(v, null, 2) + "\n", "utf8");
/** Fillér → forint, tizedesvesszővel (Excelben számként olvasható). */
const ft = (filler: number | null) => (filler == null ? "" : formatHuf(filler, { withUnit: false, decimals: "auto" }).replace(/\s/g, ""));
const iso = (d: Date | null) => (d ? d.toISOString() : null);

const README = (company: { name: string; taxNumber: string }, at: string) => `Könyvelő – cégexport
===================

Cég: ${company.name} (${company.taxNumber})
Készült: ${at}

A csomag a cég összes adatát tartalmazza. A JSON-fájlok teljesek és géppel olvashatók; a CSV-fájlok
magyar Excelben megnyithatók (pontosvessző, UTF-8). Az összegek a JSON-ban fillérben (1 Ft = 100),
a CSV-ben forintban szerepelnek.

Fájlok:
  ceg.json                  cégadatok és beállítások
  felhasznalok.json         a cég felhasználói és szerepkörük (jelszó nélkül)
  uzleti-evek.json          üzleti évek és havi időszakok, zárási adatokkal
  szamlatukor.json / .csv   főkönyvi számlák
  partnerek.json / .csv     vevők és szállítók
  bizonylatok.json          bizonylatok a tételsoraikkal, könyvelési hash-lánccal
  bizonylatok.csv           bizonylatok listája
  tetelek.csv               minden tételsor (napló)
  kiegyenlitesek.json       nyitott tételek párosításai
  sablonok.json             kontírozási sablonok
  nav-import.json           NAV-ból importált számlák és importok (titok nélkül)
  audit-naplo.json / .csv   a cég teljes audit naplója a hash-lánccal
  manifest.json             tartalomjegyzék: minden fájl mérete és SHA-256 lenyomata
  sha256sums.txt            ugyanez szabványos formában

Csatolmányok: a program jelenleg nem tárol csatolmányt (a bizonylatok eredetije a cégnél van).

Ellenőrzés:
  - a Könyvelőben: Beállítások → Mentés és export → Export ellenőrzése;
  - parancssorból: npm run export:check -- <fájl.zip>;
  - vagy kicsomagolva, Linuxon/macOS-en: sha256sum -c sha256sums.txt
A manifest.json lenyomata az audit naplóban is szerepel („Cégexport” bejegyzés).
`;

async function collect(db: Executor, companyId: string) {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const members = await db
    .select({ name: users.name, email: users.email, role: companyMemberships.role, isActive: users.isActive, since: companyMemberships.createdAt })
    .from(companyMemberships)
    .innerJoin(users, eq(users.id, companyMemberships.userId))
    .where(eq(companyMemberships.companyId, companyId))
    .orderBy(asc(users.name));
  const years = await db.select().from(fiscalYears).where(eq(fiscalYears.companyId, companyId)).orderBy(asc(fiscalYears.startDate));
  const periodRows = await db.select().from(periods).where(eq(periods.companyId, companyId)).orderBy(asc(periods.startDate));
  const accountRows = await db.select().from(accounts).where(eq(accounts.companyId, companyId)).orderBy(asc(accounts.number));
  const partnerRows = await db.select().from(partners).where(eq(partners.companyId, companyId)).orderBy(asc(partners.name));
  const docRows = await db.select().from(documents).where(eq(documents.companyId, companyId)).orderBy(asc(documents.accountingDate), asc(documents.seqNo), asc(documents.createdAt));
  const lineRows = await db.select().from(journalLines).where(eq(journalLines.companyId, companyId)).orderBy(asc(journalLines.documentId), asc(journalLines.lineNo));
  const settlementRows = await db.select().from(settlements).where(eq(settlements.companyId, companyId)).orderBy(asc(settlements.createdAt));
  const templateRows = await db.select().from(postingTemplates).where(eq(postingTemplates.companyId, companyId)).orderBy(asc(postingTemplates.name));
  const [connection] = await db.select().from(navConnections).where(eq(navConnections.companyId, companyId));
  const runs = await db.select().from(navImportRuns).where(eq(navImportRuns.companyId, companyId)).orderBy(asc(navImportRuns.startedAt));
  const navRows = await db.select().from(navInvoices).where(eq(navInvoices.companyId, companyId)).orderBy(asc(navInvoices.issueDate), asc(navInvoices.invoiceNumber));
  const audit = await db.select().from(auditLog).where(eq(auditLog.companyId, companyId)).orderBy(asc(auditLog.id));
  const userIds = [...new Set([...audit.map((a) => a.userId), ...docRows.flatMap((d) => [d.createdBy, d.postedBy])].filter((v): v is string => Boolean(v)))];
  const names = new Map(userIds.length ? (await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds))).map((u) => [u.id, u.name]) : []);
  return { company: company!, members, years, periodRows, accountRows, partnerRows, docRows, lineRows, settlementRows, templateRows, connection, runs, navRows, audit, names };
}

export async function buildCompanyExport(db: Executor, companyId: string, generatedBy: string, now = new Date()) {
  const d = await collect(db, companyId);
  const accountNo = new Map(d.accountRows.map((a) => [a.id, a.number]));
  const partnerName = new Map(d.partnerRows.map((p) => [p.id, p.name]));
  const docSerial = new Map(d.docRows.map((x) => [x.id, x.serialNumber]));
  const linesByDoc = new Map<string, typeof d.lineRows>();
  for (const l of d.lineRows) linesByDoc.set(l.documentId, [...(linesByDoc.get(l.documentId) ?? []), l]);

  const files: Array<{ name: string; data: Buffer }> = [
    { name: "README.txt", data: Buffer.from(README(d.company, now.toISOString()), "utf8") },
    { name: "ceg.json", data: json({ ...d.company, createdAt: iso(d.company.createdAt), updatedAt: iso(d.company.updatedAt) }) },
    { name: "felhasznalok.json", data: json(d.members.map((m) => ({ ...m, since: iso(m.since) }))) },
    {
      name: "uzleti-evek.json",
      data: json(d.years.map((y) => ({ ...y, closedAt: iso(y.closedAt), createdAt: iso(y.createdAt), periods: d.periodRows.filter((p) => p.fiscalYearId === y.id).map((p) => ({ ...p, closedAt: iso(p.closedAt) })) }))),
    },
    { name: "szamlatukor.json", data: json(d.accountRows.map((a) => ({ ...a, createdAt: iso(a.createdAt), updatedAt: iso(a.updatedAt) }))) },
    {
      name: "szamlatukor.csv",
      data: csv(["Számlaszám", "Megnevezés", "Jelleg", "Normál oldal", "Analitika", "Aktív", "Mérlegsor (T)", "Mérlegsor (K)", "Eredménykimutatás-sor"],
        d.accountRows.map((a) => [a.number, a.name, a.nature, a.normalSide, a.subledger, a.isActive ? "igen" : "nem", a.bsLineDebit, a.bsLineCredit, a.isLine])),
    },
    { name: "partnerek.json", data: json(d.partnerRows.map((p) => ({ ...p, anonymizedAt: iso(p.anonymizedAt), createdAt: iso(p.createdAt), updatedAt: iso(p.updatedAt) }))) },
    {
      name: "partnerek.csv",
      data: csv(["Név", "Típus", "Adószám", "Közösségi adószám", "Ország", "Irányítószám", "Település", "Cím", "Bankszámla", "E-mail", "Telefon", "Fizetési határidő (nap)", "Állapot"],
        d.partnerRows.map((p) => [p.name, p.kind, p.taxNumber, p.communityVatNumber, p.country, p.postalCode, p.city, p.addressLine, p.bankAccount, p.email, p.phone, p.paymentTermsDays, p.status])),
    },
    {
      name: "bizonylatok.json",
      data: json(d.docRows.map((x) => ({
        ...x, createdAt: iso(x.createdAt), updatedAt: iso(x.updatedAt), postedAt: iso(x.postedAt),
        createdByName: d.names.get(x.createdBy) ?? null, postedByName: x.postedBy ? (d.names.get(x.postedBy) ?? null) : null,
        lines: (linesByDoc.get(x.id) ?? []).map((l) => ({ ...l, accountNumber: l.accountId ? accountNo.get(l.accountId) ?? null : null })),
      }))),
    },
    {
      name: "bizonylatok.csv",
      data: csv(["Sorszám", "Típus", "Állapot", "Könyvelés dátuma", "Kelt", "Teljesítés", "Fizetési határidő", "Külső szám", "Partner", "Leírás", "Összeg (Ft)", "Sztornózott bizonylat", "Helyesbített bizonylat", "Eredet", "Könyvelte", "Könyvelve", "Tartalmi hash"],
        d.docRows.map((x) => {
          const total = (linesByDoc.get(x.id) ?? []).filter((l) => l.side === "D").reduce((s, l) => s + l.amount, 0);
          return [x.serialNumber, x.docType, x.status, x.accountingDate, x.issueDate, x.fulfillmentDate, x.dueDate, x.externalNumber, x.partnerId ? partnerName.get(x.partnerId) : null,
            x.description, ft(total), x.reversesDocumentId ? docSerial.get(x.reversesDocumentId) : null, x.correctsDocumentId ? docSerial.get(x.correctsDocumentId) : null, x.source,
            x.postedBy ? d.names.get(x.postedBy) : null, iso(x.postedAt), x.contentHash];
        })),
    },
    {
      name: "tetelek.csv",
      data: csv(["Bizonylat", "Állapot", "Könyvelés dátuma", "Sor", "Számla", "Oldal", "Összeg (Ft)", "Partner", "Tételszöveg"],
        d.docRows.flatMap((x) => (linesByDoc.get(x.id) ?? []).map((l) => [x.serialNumber ?? "(piszkozat)", x.status, x.accountingDate, l.lineNo,
          l.accountId ? accountNo.get(l.accountId) : null, l.side === "D" ? "T" : l.side === "C" ? "K" : null, ft(l.amount), l.partnerId ? partnerName.get(l.partnerId) : null, l.description]))),
    },
    { name: "kiegyenlitesek.json", data: json(d.settlementRows.map((s) => ({ ...s, createdAt: iso(s.createdAt) }))) },
    { name: "sablonok.json", data: json(d.templateRows.map((t) => ({ ...t, createdAt: iso(t.createdAt), updatedAt: iso(t.updatedAt) }))) },
    {
      name: "nav-import.json",
      data: json({
        // Az összekapcsolás azonosítója szándékosan nincs benne (az eÁFA-hoz való hozzáférés kulcsa).
        connection: d.connection
          ? { environment: d.connection.environment, eafaTaxpayerName: d.connection.eafaTaxpayerName, eafaTaxNumber: d.connection.eafaTaxNumber, linkedAt: iso(d.connection.linkedAt), remoteState: d.connection.remoteState }
          : null,
        imports: d.runs.map((r) => ({ ...r, startedAt: iso(r.startedAt), finishedAt: iso(r.finishedAt) })),
        invoices: d.navRows.map((n) => ({ ...n, insDate: iso(n.insDate), dataFetchedAt: iso(n.dataFetchedAt), createdAt: iso(n.createdAt), updatedAt: iso(n.updatedAt) })),
      }),
    },
    { name: "audit-naplo.json", data: json(d.audit.map((a) => ({ ...a, at: a.at.toISOString(), userName: a.userId ? d.names.get(a.userId) ?? null : null }))) },
    {
      name: "audit-naplo.csv",
      data: csv(["Sorszám", "Időpont", "Felhasználó", "Művelet", "Tárgy", "Azonosító", "Előtte", "Utána", "IP-cím", "Előző hash", "Hash"],
        d.audit.map((a) => [a.id, a.at.toISOString(), a.userId ? d.names.get(a.userId) : null, a.action, a.entityType, a.entityId, a.before ? JSON.stringify(a.before) : null,
          a.after ? JSON.stringify(a.after) : null, a.ip, a.prevHash, a.hash])),
    },
  ];

  const manifest: ExportManifest = {
    format: EXPORT_FORMAT,
    company: { id: d.company.id, name: d.company.name, taxNumber: d.company.taxNumber },
    generatedAt: now.toISOString(),
    generatedBy,
    counts: {
      bizonylatok: d.docRows.length,
      tetelsorok: d.lineRows.length,
      partnerek: d.partnerRows.length,
      szamlak: d.accountRows.length,
      uzletiEvek: d.years.length,
      navSzamlak: d.navRows.length,
      auditBejegyzesek: d.audit.length,
    },
    files: files.map((f) => ({ path: f.name, bytes: f.data.length, sha256: sha256(f.data) })),
  };
  const manifestData = json(manifest);
  const manifestSha256 = sha256(manifestData);
  const sums = Buffer.from([...manifest.files.map((f) => `${f.sha256}  ${f.path}`), `${manifestSha256}  ${EXPORT_MANIFEST}`].join("\n") + "\n", "utf8");
  const zip = buildZip([...files, { name: EXPORT_MANIFEST, data: manifestData }, { name: EXPORT_SUMS, data: sums }], now);
  return { zip, manifest, manifestSha256 };
}

function fileName(taxNumber: string, now: Date) {
  return `konyvelo-cegexport-${taxNumber.replace(/-/g, "")}-${now.toISOString().slice(0, 10)}.zip`;
}

export const exportModule: AppModule = {
  name: "export",
  register(app, { db }) {
    /** A teljes cégexport letöltése. Az egész cég adatait tartalmazza, ezért csak Adminisztrátor és Vezető könyvelő kérheti. */
    app.get<{ Params: { companyId: string } }>("/api/companies/:companyId/export", async (request, reply) => {
      const { companyId } = request.params;
      const { user } = await requireCompanyPermission(db, request, companyId, "audit:read");
      const now = new Date();
      const result = await db.transaction(async (tx) => {
        const r = await buildCompanyExport(tx, companyId, user.name, now);
        await writeAudit(tx, {
          companyId,
          userId: user.id,
          action: "company.export",
          entityType: "company",
          entityId: companyId,
          after: { manifestSha256: r.manifestSha256, files: r.manifest.files.length + 2, bytes: r.zip.length, counts: r.manifest.counts },
          ip: request.ip,
        });
        return r;
      });
      return reply
        .header("Content-Type", "application/zip")
        .header("Content-Disposition", `attachment; filename="${fileName(result.manifest.company.taxNumber, now)}"`)
        .header("X-Manifest-Sha256", result.manifestSha256)
        .send(result.zip);
    });

    /** A korábbi exportok (az audit naplóból): ezekhez veti össze a felület az ellenőrzött csomagot. */
    app.get<{ Params: { companyId: string } }>("/api/companies/:companyId/exports", async (request): Promise<CompanyExportDto[]> => {
      const { companyId } = request.params;
      await requireCompanyPermission(db, request, companyId, "audit:read");
      const rows = await db
        .select({ at: auditLog.at, userName: users.name, after: auditLog.after })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.userId))
        .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "company.export")))
        .orderBy(desc(auditLog.id))
        .limit(100);
      return rows.map((r) => {
        const a = (r.after ?? {}) as { manifestSha256?: string; files?: number; bytes?: number };
        return { at: r.at.toISOString(), userName: r.userName, manifestSha256: a.manifestSha256 ?? "", files: a.files ?? 0, bytes: a.bytes ?? 0 };
      });
    });
  },
};
