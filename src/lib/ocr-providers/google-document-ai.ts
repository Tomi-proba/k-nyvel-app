import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import type { protos } from "@google-cloud/documentai";
import { roundToTwoDecimals } from "@/lib/vat";
import type { OcrFieldKey, OcrProvider, OcrResult } from "@/lib/ocr";

type IDocument = protos.google.cloud.documentai.v1.IDocument;
type IEntity = protos.google.cloud.documentai.v1.Document.IEntity;

/**
 * Google Document AI — "Invoice parser" processzor.
 *
 * ELŐKÉSZÍTVE, de élesítés előtt saját Google Cloud erőforrás kell hozzá —
 * lásd a README "Valódi OCR bekötése (Google Document AI)" szakaszát a
 * pontos lépésekért (projekt, API engedélyezés, processzor létrehozása,
 * service account + jogosultság, kulcs generálása).
 *
 * Az itt szereplő entitástípus-nevek a Google hivatalos "Invoice parser"
 * séma szerintiek (2024-es állapot); processzor-verziónként minimálisan
 * eltérhetnek — élesítés után egy valós válasszal érdemes ellenőrizni
 * (a `raw` mezőben minden nyers entitás elmentve marad audit céljából),
 * és szükség esetén bővíteni az ENTITY_TYPE_MAP-et.
 */

const CONFIDENCE_THRESHOLD = 0.7;

const ENTITY_TYPE_MAP: Partial<Record<string, OcrFieldKey>> = {
  supplier_name: "partnerNameRaw",
  supplier_tax_id: "partnerTaxNumber",
  invoice_date: "issueDate",
  due_date: "dueDate",
  net_amount: "netAmount",
  total_tax_amount: "vatAmount",
  total_amount: "grossAmount",
};

const ALL_FIELD_KEYS: OcrFieldKey[] = [
  "partnerNameRaw",
  "partnerTaxNumber",
  "issueDate",
  "dueDate",
  "netAmount",
  "vatAmount",
  "grossAmount",
  "vatRate",
];

function moneyToDecimalString(money: protos.google.type.IMoney | null | undefined): string | undefined {
  if (!money) return undefined;
  const units = money.units ? Number(money.units) : 0;
  const nanos = money.nanos ? money.nanos / 1_000_000_000 : 0;
  return roundToTwoDecimals(units + nanos).toFixed(2);
}

function dateValueToIso(date: protos.google.type.IDate | null | undefined): string | undefined {
  if (!date?.year || !date.month || !date.day) return undefined;
  const y = String(date.year).padStart(4, "0");
  const m = String(date.month).padStart(2, "0");
  const d = String(date.day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Egy entitásból a mi mezőnkhöz tartozó string érték, ha van rá megbízható normalizált forma. */
function entityToValue(entity: IEntity): string | undefined {
  const nv = entity.normalizedValue;
  if (nv?.moneyValue) return moneyToDecimalString(nv.moneyValue);
  if (nv?.dateValue) return dateValueToIso(nv.dateValue);
  if (nv?.text) return nv.text;
  return entity.mentionText ?? undefined;
}

export type GoogleDocumentAiConfig = {
  projectId: string;
  location: string; // pl. "eu" vagy "us"
  processorId: string;
  credentials?: { client_email: string; private_key: string };
};

export class GoogleDocumentAiProvider implements OcrProvider {
  readonly name = "google-document-ai";
  private readonly client: DocumentProcessorServiceClient;
  private readonly processorName: string;

  constructor(config: GoogleDocumentAiConfig) {
    this.client = new DocumentProcessorServiceClient(
      config.credentials
        ? { credentials: config.credentials, projectId: config.projectId }
        : { projectId: config.projectId }
    );
    this.processorName = this.client.processorPath(config.projectId, config.location, config.processorId);
  }

  async extract(input: { buffer: Buffer; mimeType: string; fileName: string }): Promise<OcrResult> {
    const [response] = await this.client.processDocument({
      name: this.processorName,
      rawDocument: { content: input.buffer, mimeType: input.mimeType },
    });

    const document: IDocument | null | undefined = response.document;
    const entities = document?.entities ?? [];

    const byType = new Map<string, IEntity>();
    for (const entity of entities) {
      if (entity.type) byType.set(entity.type, entity);
    }

    const fields: Partial<Record<OcrFieldKey, string>> = {};
    const uncertainFields: OcrFieldKey[] = [];
    let confidenceSum = 0;
    let confidenceCount = 0;

    for (const [entityType, fieldKey] of Object.entries(ENTITY_TYPE_MAP)) {
      const entity = byType.get(entityType);
      const confidence = entity?.confidence ?? 0;
      if (entity) {
        confidenceSum += confidence;
        confidenceCount += 1;
      }

      const value = entity ? entityToValue(entity) : undefined;
      if (value && confidence >= CONFIDENCE_THRESHOLD) {
        fields[fieldKey as OcrFieldKey] = value;
      } else {
        // Nincs entitás, nincs kiolvasható normalizált érték, vagy a
        // konfidencia alacsony — sosem találunk ki adatot, inkább
        // ellenőrzésre jelöljük.
        uncertainFields.push(fieldKey as OcrFieldKey);
      }
    }

    // Az ÁFA kulcsot a Document AI nem mindig adja külön entitásként —
    // ha van nettó és ÁFA összeg, abból számoljuk, egyébként bizonytalan.
    const net = fields.netAmount ? Number(fields.netAmount) : undefined;
    const vat = fields.vatAmount ? Number(fields.vatAmount) : undefined;
    if (net !== undefined && vat !== undefined && net > 0) {
      fields.vatRate = String(Math.round((vat / net) * 100));
    } else {
      uncertainFields.push("vatRate");
    }

    // Amit egyáltalán nem néztünk (pl. ha egy jövőbeli mezőt bővítünk),
    // biztonságból szintén bizonytalannak jelölünk, sosem hagyjuk kitöltetlenül
    // csendben — a review UI mindig lássa, mit kell ellenőrizni.
    for (const key of ALL_FIELD_KEYS) {
      if (!(key in fields) && !uncertainFields.includes(key)) {
        uncertainFields.push(key);
      }
    }

    return {
      fields,
      uncertainFields,
      overallConfidence: confidenceCount > 0 ? roundToTwoDecimals(confidenceSum / confidenceCount) : 0,
      raw: {
        provider: "google-document-ai",
        fileName: input.fileName,
        entities: entities.map((e) => ({ type: e.type, mentionText: e.mentionText, confidence: e.confidence })),
      },
    };
  }
}

/**
 * Providert épít a környezeti változókból. Hiányzó kötelező konfiguráció
 * esetén világos hibaüzenettel áll le induláskor, hogy ne derüljön csak
 * feltöltéskor, futásidőben, hogy hiányzik valami.
 */
export function createGoogleDocumentAiProviderFromEnv(): GoogleDocumentAiProvider {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const location = process.env.GOOGLE_DOCUMENT_AI_LOCATION;
  const processorId = process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID;

  if (!projectId || !location || !processorId) {
    throw new Error(
      "Google Document AI OCR provider: hiányzó env változó(k) — " +
        "GOOGLE_CLOUD_PROJECT_ID, GOOGLE_DOCUMENT_AI_LOCATION, GOOGLE_DOCUMENT_AI_PROCESSOR_ID mind kötelező. " +
        "Lásd a README 'Valódi OCR bekötése (Google Document AI)' szakaszát."
    );
  }

  let credentials: GoogleDocumentAiConfig["credentials"];
  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (credentialsJson) {
    let parsed: { client_email?: string; private_key?: string };
    try {
      parsed = JSON.parse(credentialsJson);
    } catch {
      throw new Error(
        "Google Document AI OCR provider: a GOOGLE_APPLICATION_CREDENTIALS_JSON nem érvényes JSON. " +
          "A teljes service account kulcsfájl tartalmát kell (egy sorban) beilleszteni."
      );
    }
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error(
        "Google Document AI OCR provider: a GOOGLE_APPLICATION_CREDENTIALS_JSON nem tartalmaz " +
          "client_email vagy private_key mezőt — érvényes service account kulcs JSON-t adj meg."
      );
    }
    credentials = { client_email: parsed.client_email, private_key: parsed.private_key };
  }
  // Ha nincs GOOGLE_APPLICATION_CREDENTIALS_JSON, a kliens a szokásos Google
  // Application Default Credentials láncot használja (pl. GOOGLE_APPLICATION_CREDENTIALS
  // fájl-útvonal, vagy helyi `gcloud auth application-default login`).

  return new GoogleDocumentAiProvider({ projectId, location, processorId, credentials });
}
