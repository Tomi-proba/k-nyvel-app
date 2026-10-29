import { z } from "zod";

/**
 * Közös eseményformátum (TERV.md F2). Minden modul ugyanebben a formában adja fel az eseményeit az
 * integrációs központnak, és ugyanebben kapja a máshonnan érkezőket.
 *
 * - `id`: az esemény egyedi azonosítója. A központ és a fogadó modul is erre ügyel, hogy egy esemény
 *   pontosan egyszer hasson.
 * - `source`: honnan jött. `companyRef` a forrásmodul SAJÁT cégazonosítója; a közös céget a központ az
 *   összekapcsolásból (kapcsolódási kóddal, D13) tudja, nem az adószámból.
 * - `source.sequence`: ugyanarra a forrásrekordra vonatkozó események sorszáma (1, 2, …); a központ
 *   ebben a sorrendben adja át őket.
 * - `causedBy`: ha az esemény egy beérkezett esemény hatására keletkezett, annak azonosítója (visszhang
 *   tiltása: a feladó felé nem megy vissza).
 * - Pénzösszeg mindig fillérben, egész számként; adószám kanonikus alakban (12345678-1-12).
 */

export const MODULES = ["konyvelo", "keszlet", "eafa"] as const;
export type Module = (typeof MODULES)[number];

export const MODULE_LABELS: Record<Module, string> = {
  konyvelo: "Könyvelő",
  keszlet: "Készletfigyelő",
  eafa: "eÁFA",
};

const uuid = z.uuid("Érvénytelen azonosító.");
const isoDateTime = z.iso.datetime({ offset: true, message: "Érvénytelen időpont (ISO 8601)." });
/** Pénzösszeg fillérben. */
export const filler = z.number().int("A pénzösszeg egész fillér legyen.");
export const taxNumber = z.string().regex(/^\d{8}-\d-\d{2}$/, "Az adószám kanonikus alakja: 12345678-1-12.");
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Érvénytelen dátum (ÉÉÉÉ-HH-NN).");

export const sourceSchema = z.object({
  module: z.enum(MODULES),
  companyRef: z.string().min(1).max(100),
  recordType: z.string().min(1).max(60),
  recordId: z.string().min(1).max(100),
  sequence: z.number().int().min(1),
  /** A forrásrekordra mutató hivatkozás a modul felületén (relatív útvonal). */
  url: z.string().max(500).optional(),
  label: z.string().max(300).optional(),
});

export const envelopeSchema = z.object({
  id: uuid,
  type: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/, "Érvénytelen eseménytípus."),
  version: z.number().int().min(1),
  source: sourceSchema,
  occurredAt: isoDateTime,
  causedBy: uuid.optional(),
  payload: z.record(z.string(), z.unknown()),
});
export type EventEnvelope = z.infer<typeof envelopeSchema>;
export type EventSource = z.infer<typeof sourceSchema>;

/** Egy eseménytípus: kik a fogadói, és milyen a tartalma. */
export type EventTypeDefinition = {
  type: string;
  version: number;
  description: string;
  /** Mely modulok kapják (a forrásmodul soha). */
  consumers: readonly Module[];
  payload: z.ZodType<Record<string, unknown>>;
};

const partnerRef = z.object({ name: z.string().min(1), taxNumber: taxNumber.optional(), sharedId: uuid.optional() });
const accountingLine = z.object({ accountNumber: z.string().regex(/^\d{1,8}$/), side: z.enum(["D", "C"]), amount: filler.positive() });
const stockLine = z.object({ productId: z.string().min(1), quantity: z.number().positive(), unitPrice: filler, vatRate: z.number().min(0).max(100).nullable() });
const documentRef = z.object({ documentId: z.string(), serialNumber: z.string() });
/**
 * Készlet-tétel kifejezett összegekkel (v2): a fogadó nem számol áfát és nem kerekít, mert abból eltérés
 * lehetne (F5, „soha ne találgasson”). Bruttó = nettó + áfa.
 */
const stockLineV2 = z
  .object({
    productId: z.string().min(1),
    productName: z.string().min(1).max(300),
    quantity: z.number().positive(),
    unit: z.string().max(30).nullable(),
    netAmount: filler,
    vatRate: z.number().min(0).max(100).nullable(),
    vatAmount: filler,
  })
  .refine((l) => l.vatRate !== null || l.vatAmount === 0, { message: "Áfakulcs nélkül az áfa összege 0.", path: ["vatAmount"] });
const totals = z.object({ net: filler, vat: filler, gross: filler }).refine((t) => t.gross === t.net + t.vat, { message: "A bruttó összeg a nettó és az áfa összege.", path: ["gross"] });
const withTotals = <T extends { lines: Array<{ netAmount: number; vatAmount: number }>; totals: { net: number; vat: number } }>(p: T) =>
  p.lines.reduce((s, l) => s + l.netAmount, 0) === p.totals.net && p.lines.reduce((s, l) => s + l.vatAmount, 0) === p.totals.vat;

/**
 * Az eseménytípusok egyetlen helye (TERV.md F7). Új kapcsolat itt vehető fel, a meglévő modulok
 * módosítása nélkül; a tartalom változásához új verzió kell.
 */
export const EVENT_TYPES: readonly EventTypeDefinition[] = [
  {
    type: "konyvelo.bizonylat.konyvelve",
    version: 1,
    description: "A Könyvelőben könyveltek egy bizonylatot (KK3, KE1).",
    consumers: ["keszlet", "eafa"],
    payload: z.object({
      documentId: z.string(),
      serialNumber: z.string(),
      docType: z.string(),
      accountingDate: isoDate,
      fulfillmentDate: isoDate.nullable(),
      externalNumber: z.string().nullable(),
      partner: partnerRef.nullable(),
      lines: z.array(accountingLine).min(1),
      stockLines: z.array(stockLine).optional(),
    }),
  },
  {
    type: "konyvelo.bizonylat.konyvelve",
    version: 2,
    description: "A Könyvelőben könyveltek egy bizonylatot; a helyesbítő bizonylat is ez, hivatkozással az eredetire (KK3, KK5, KE1).",
    consumers: ["keszlet", "eafa"],
    payload: z.object({
      documentId: z.string(),
      serialNumber: z.string(),
      docType: z.string(),
      accountingDate: isoDate,
      issueDate: isoDate.nullable(),
      fulfillmentDate: isoDate.nullable(),
      dueDate: isoDate.nullable(),
      externalNumber: z.string().nullable(),
      description: z.string().nullable(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      /** Devizás bizonylatnál a devizaösszeg (a deviza századrészében) és az árfolyam. */
      fxAmount: z.number().int().nullable(),
      fxRate: z.number().positive().nullable(),
      partner: partnerRef.nullable(),
      corrects: documentRef.nullable(),
      reverses: documentRef.nullable(),
      lines: z.array(accountingLine.extend({ partner: partnerRef.nullable().optional() })).min(1),
      /** A rögzítéskor megadott termékek (KK3), kifejezett összegekkel. */
      stockLines: z.array(stockLineV2).optional(),
    }),
  },
  {
    type: "konyvelo.bizonylat.sztornozva",
    version: 1,
    description: "A Könyvelőben sztornóztak egy bizonylatot (KK4, KE1).",
    consumers: ["keszlet", "eafa"],
    payload: z.object({ documentId: z.string(), serialNumber: z.string(), reversalDocumentId: z.string(), reversalSerialNumber: z.string(), accountingDate: isoDate }),
  },
  {
    type: "konyvelo.kiegyenlites.rogzitve",
    version: 1,
    description: "A Könyvelőben kiegyenlítettek egy vevői vagy szállítói számlát (KK6).",
    consumers: ["keszlet"],
    payload: z.object({ documentId: z.string(), settledDocumentId: z.string(), amount: filler.positive(), date: isoDate }),
  },
  {
    type: "konyvelo.kiegyenlites.rogzitve",
    version: 2,
    description: "A Könyvelőben kiegyenlítettek (párosítottak) egy vevői vagy szállítói számlát (KK6).",
    consumers: ["keszlet"],
    payload: z.object({ settlementId: z.string(), documentId: z.string(), settledDocumentId: z.string(), amount: filler.positive(), date: isoDate }),
  },
  {
    type: "konyvelo.kiegyenlites.bontva",
    version: 1,
    description: "A Könyvelőben bontottak egy párosítást (kézzel vagy sztornó miatt) (KK6).",
    consumers: ["keszlet"],
    payload: z.object({ settlementId: z.string(), documentId: z.string(), settledDocumentId: z.string(), amount: filler.positive(), reason: z.enum(["MANUAL", "REVERSAL"]) }),
  },
  {
    type: "konyvelo.idoszak.lezarva",
    version: 1,
    description: "A Könyvelőben lezártak egy havi időszakot vagy üzleti évet (KK9).",
    consumers: ["keszlet"],
    payload: z.object({ kind: z.enum(["PERIOD", "FISCAL_YEAR"]), startDate: isoDate, endDate: isoDate }),
  },
  {
    type: "konyvelo.idoszak.feloldva",
    version: 1,
    description: "A Könyvelőben feloldottak egy havi időszakot vagy üzleti évet (KK9).",
    consumers: ["keszlet"],
    payload: z.object({ kind: z.enum(["PERIOD", "FISCAL_YEAR"]), startDate: isoDate, endDate: isoDate }),
  },
  {
    type: "keszlet.termek.valtozott",
    version: 1,
    description: "A Készletben felvettek vagy módosítottak egy terméket (a Könyvelő termékkérdéséhez, KK3).",
    consumers: ["konyvelo"],
    payload: z.object({
      productId: z.string().min(1),
      name: z.string().min(1).max(300),
      sku: z.string().max(100).nullable(),
      unit: z.string().max(30).nullable(),
      vatRate: z.number().min(0).max(100).nullable(),
      active: z.boolean(),
    }),
  },
  {
    type: "keszlet.beszerzes.veglegesitve",
    version: 1,
    description: "A Készletben véglegesítettek egy beszerzést (KK1).",
    consumers: ["konyvelo"],
    payload: z.object({ purchaseId: z.string(), date: isoDate, supplier: partnerRef.nullable(), invoiceNumber: z.string().nullable(), lines: z.array(stockLine).min(1) }),
  },
  {
    type: "keszlet.eladas.veglegesitve",
    version: 1,
    description: "A Készletben véglegesítettek egy eladást (KK2).",
    consumers: ["konyvelo"],
    payload: z.object({ saleId: z.string(), date: isoDate, customer: partnerRef.nullable(), cash: z.boolean(), costOfGoods: filler.nonnegative(), lines: z.array(stockLine).min(1) }),
  },
  {
    type: "keszlet.beszerzes.veglegesitve",
    version: 2,
    description: "A Készletben véglegesítettek egy beszerzést (KK1), kifejezett nettó, áfa és bruttó összeggel.",
    consumers: ["konyvelo"],
    payload: z
      .object({
        purchaseId: z.string(),
        receivedDate: isoDate,
        invoiceDate: isoDate.nullable(),
        /** A számla szerinti teljesítés dátuma, ha a Készletben megadták (a szállítói számlához kell). */
        fulfillmentDate: isoDate.nullable(),
        invoiceNumber: z.string().max(100).nullable(),
        supplier: partnerRef.nullable(),
        lines: z.array(stockLineV2).min(1),
        totals,
      })
      .refine(withTotals, { message: "Az összesen nem egyezik a tételek összegével.", path: ["totals"] }),
  },
  {
    type: "keszlet.eladas.veglegesitve",
    version: 2,
    description: "A Készletben véglegesítettek egy eladást (KK2); az ELÁBÉ a Készlet költségszámítása szerint.",
    consumers: ["konyvelo"],
    payload: z
      .object({
        saleId: z.string(),
        date: isoDate,
        customer: partnerRef.nullable(),
        cash: z.boolean(),
        /** A vevőszámla száma, ha van (a Könyvelőben rögzített számlával így párosítható). */
        invoiceNumber: z.string().max(100).nullable(),
        /** Az eladott áruk bekerülési értéke (ELÁBÉ), a Készlet FIFO/átlagár számítása szerint. */
        costOfGoods: filler.nonnegative(),
        lines: z.array(stockLineV2).min(1),
        totals,
      })
      .refine(withTotals, { message: "Az összesen nem egyezik a tételek összegével.", path: ["totals"] }),
  },
  {
    type: "keszlet.mozgas.sztornozva",
    version: 2,
    description: "A Készletben visszavontak egy beszerzést vagy eladást (KK4). A forrásrekord ugyanaz, mint a visszavont mozgásé (a sorrend így biztos).",
    consumers: ["konyvelo"],
    payload: z.object({ movementKind: z.enum(["PURCHASE", "SALE"]), movementId: z.string(), date: isoDate, reason: z.string().max(500) }),
  },
  {
    type: "keszlet.mozgas.sztornozva",
    version: 1,
    description: "A Készletben visszavontak egy mozgást (KK4).",
    consumers: ["konyvelo"],
    payload: z.object({ movementId: z.string(), reason: z.string() }),
  },
  {
    type: "torzs.partner.valtozott",
    version: 1,
    description: "Egy partner adatai megváltoztak (M2).",
    consumers: ["konyvelo", "keszlet", "eafa"],
    payload: z.object({ partner: partnerRef.extend({ address: z.string().nullable().optional() }), anonymized: z.boolean().default(false) }),
  },
];

export type EventRegistry = ReadonlyMap<string, EventTypeDefinition>;

export function registryOf(types: readonly EventTypeDefinition[] = EVENT_TYPES): EventRegistry {
  return new Map(types.map((t) => [`${t.type}@${t.version}`, t]));
}

export type ValidationResult = { ok: true; event: EventEnvelope; definition: EventTypeDefinition } | { ok: false; error: string };

/** Az esemény ellenőrzése: forma, ismert típus és verzió, és a tartalom a típus szerint. */
export function validateEvent(raw: unknown, registry: EventRegistry = registryOf()): ValidationResult {
  const env = envelopeSchema.safeParse(raw);
  if (!env.success) return { ok: false, error: `Hibás esemény: ${env.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  const def = registry.get(`${env.data.type}@${env.data.version}`);
  if (!def) return { ok: false, error: `Ismeretlen eseménytípus vagy verzió: ${env.data.type} v${env.data.version}` };
  const payload = def.payload.safeParse(env.data.payload);
  if (!payload.success) {
    return { ok: false, error: `Hibás tartalom (${env.data.type}): ${payload.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  }
  return { ok: true, event: { ...env.data, payload: payload.data }, definition: def };
}

/** Amit a fogadó modul az átadásra válaszol. */
export const inboundResultSchema = z.object({
  /** APPLIED: hatott; DUPLICATE: már korábban hatott (nem hat újra); TODO: nem egyértelmű, Teendő lett; PARKED: félretéve (pl. hiányzik az előzménye). */
  outcome: z.enum(["APPLIED", "DUPLICATE", "TODO", "PARKED"]),
  /** Ami a fogadóban keletkezett (a „honnan jött?” kapcsolathoz). */
  target: z.object({ recordType: z.string(), recordId: z.string(), url: z.string().optional(), label: z.string().optional() }).optional(),
  todo: z.object({ key: z.string().min(1).max(200), title: z.string().min(1).max(300), detail: z.string().max(2000).optional(), url: z.string().max(500).optional() }).optional(),
});
export type InboundResult = z.infer<typeof inboundResultSchema>;

/** Amit a központ a fogadó modulnak küld: az esemény és a fogadó saját cégazonosítója. */
export type InboundDelivery = { event: EventEnvelope; targetCompanyRef: string };
