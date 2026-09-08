import { createHash } from "node:crypto";
import { calculateGrossFromNet, calculateVatFromNet, roundToTwoDecimals } from "@/lib/vat";
import { createGoogleDocumentAiProviderFromEnv } from "@/lib/ocr-providers/google-document-ai";

/**
 * OCR / dokumentumfeldolgozó absztrakció.
 *
 * Éles integrációhoz javasolt szolgáltatók magyar számlákhoz:
 *  - Azure AI Document Intelligence (korábban Form Recognizer) — "Invoice"
 *    előre tanított modellje jól kezeli az EU-s (így magyar) számlaformátumokat,
 *    és van rá lehetőség egyedi (custom) modellt tanítani konkrét partnerek
 *    visszatérő sablonjaira.
 *  - Google Document AI — Invoice Parser, hasonló képességekkel. Ez már
 *    ELŐ VAN KÉSZÍTVE (lásd `ocr-providers/google-document-ai.ts`), de saját
 *    Google Cloud erőforrás (projekt, processzor, service account) kell
 *    hozzá — lásd a README-t.
 *  - Rossum vagy Mindee — kifejezetten számla-OCR-re szakosodott SaaS-ok,
 *    gyors integrációval (REST API + webhook).
 * Alapértelmezetten egy mock providert használunk, hogy a teljes pipeline
 * (feltöltés → feldolgozás → ellenőrzésre váró mezők → jóváhagyás) valós
 * adatok/fiók nélkül is tesztelhető legyen. A providerek a lenti
 * `OcrProvider` interfészt implementálják, így a szolgáltatóváltás nem
 * igényel változtatást a hívó kódban — csak az `OCR_PROVIDER` env változót
 * kell átállítani.
 */

export type OcrFieldKey =
  | "partnerNameRaw"
  | "partnerTaxNumber"
  | "issueDate"
  | "dueDate"
  | "netAmount"
  | "vatAmount"
  | "grossAmount"
  | "vatRate";

export type OcrResult = {
  /** DB-be közvetlenül írható mezőértékek (ISO dátum, decimal string). */
  fields: Partial<Record<OcrFieldKey, string>>;
  /** Mezők, amikhez az OCR nem volt elég magabiztos — ezeket üresen hagyjuk. */
  uncertainFields: OcrFieldKey[];
  /** Teljes dokumentumra vonatkozó átlagos konfidencia (0-1). */
  overallConfidence: number;
  /** Szolgáltató-független nyers válasz, audit célra elmentve. */
  raw: unknown;
};

export interface OcrProvider {
  readonly name: string;
  extract(input: { buffer: Buffer; mimeType: string; fileName: string }): Promise<OcrResult>;
}

const MOCK_VENDORS: Array<{
  name: string;
  taxNumber: string;
  netRange: [number, number];
  vatRate: number;
}> = [
  { name: "Telekom Nyrt.", taxNumber: "10773381-2-44", netRange: [8000, 25000], vatRate: 27 },
  { name: "MVM Next Energiakereskedelmi Zrt.", taxNumber: "26260016-2-44", netRange: [15000, 60000], vatRate: 27 },
  { name: "Shell Hungary Kft.", taxNumber: "12057500-2-44", netRange: [10000, 40000], vatRate: 27 },
  { name: "Microsoft Ireland Operations Ltd.", taxNumber: "IE8256796U", netRange: [5000, 45000], vatRate: 27 },
  { name: "Google Ireland Limited", taxNumber: "IE6388047V", netRange: [3000, 30000], vatRate: 27 },
  { name: "Irodaszer Diszkont Kft.", taxNumber: "13214567-2-13", netRange: [2000, 18000], vatRate: 27 },
  { name: "Papír-Írószer Bt.", taxNumber: "23456789-1-42", netRange: [1500, 12000], vatRate: 27 },
  { name: "MOL Magyarország Kft.", taxNumber: "10625790-2-44", netRange: [8000, 35000], vatRate: 27 },
  { name: "Ingatlanbérlő Kft.", taxNumber: "14785236-2-42", netRange: [80000, 250000], vatRate: 27 },
  { name: "Könyvelő Iroda Bt.", taxNumber: "25874136-1-42", netRange: [30000, 90000], vatRate: 27 },
  { name: "Marketing Ügynökség Kft.", taxNumber: "18529637-2-13", netRange: [40000, 180000], vatRate: 27 },
  { name: "Vevő Ügyfél Kft.", taxNumber: "11223344-2-42", netRange: [50000, 500000], vatRate: 27 },
];

/** Egyszerű, gyors, determinisztikus hash-alapú PRNG (mulberry32). */
function seededRandom(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i);
    h |= 0;
  }
  let state = h >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mock OCR provider: a fájl tartalmából (hash) determinisztikus, de
 * fájlonként változó "kinyert" adatokat generál, néhány mezőt szándékosan
 * bizonytalannak jelölve — így a fejlesztés/tesztelés a valós OCR
 * viselkedését realisztikusan szimulálja anélkül, hogy adatot találna ki.
 */
class MockOcrProvider implements OcrProvider {
  readonly name = "mock";

  async extract(input: { buffer: Buffer; mimeType: string; fileName: string }): Promise<OcrResult> {
    const hash = createHash("sha256").update(input.buffer).update(input.fileName).digest("hex");
    const rand = seededRandom(hash);

    const vendor = MOCK_VENDORS[Math.floor(rand() * MOCK_VENDORS.length)];
    const net = roundToTwoDecimals(
      vendor.netRange[0] + rand() * (vendor.netRange[1] - vendor.netRange[0])
    );
    const vat = calculateVatFromNet(net, vendor.vatRate);
    const gross = calculateGrossFromNet(net, vendor.vatRate);

    const now = new Date();
    const issueDate = new Date(now.getFullYear(), now.getMonth(), 1 + Math.floor(rand() * 27));
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + 8 + Math.floor(rand() * 20));

    const allFields: Record<OcrFieldKey, string> = {
      partnerNameRaw: vendor.name,
      partnerTaxNumber: vendor.taxNumber,
      issueDate: issueDate.toISOString().slice(0, 10),
      dueDate: dueDate.toISOString().slice(0, 10),
      netAmount: net.toFixed(2),
      vatAmount: vat.toFixed(2),
      grossAmount: gross.toFixed(2),
      vatRate: String(vendor.vatRate),
    };

    // Minden mezőhöz egy "konfidencia" szimuláció — kb. 12% eséllyel egy
    // mező bizonytalannak minősül és NEM kerül be kitöltve, hogy a user
    // biztosan ellenőrizze, ahelyett hogy kitalált adatot látna.
    const uncertainFields: OcrFieldKey[] = [];
    const fields: Partial<Record<OcrFieldKey, string>> = {};
    let confidenceSum = 0;

    for (const key of Object.keys(allFields) as OcrFieldKey[]) {
      const confidence = rand();
      confidenceSum += confidence;
      if (confidence < 0.12) {
        uncertainFields.push(key);
      } else {
        fields[key] = allFields[key];
      }
    }

    return {
      fields,
      uncertainFields,
      overallConfidence: roundToTwoDecimals(confidenceSum / Object.keys(allFields).length),
      raw: { provider: "mock", vendor: vendor.name, fileName: input.fileName, mimeType: input.mimeType },
    };
  }
}

let cachedProvider: OcrProvider | undefined;

export function getOcrProvider(): OcrProvider {
  if (cachedProvider) return cachedProvider;

  const providerName = process.env.OCR_PROVIDER || "mock";

  if (providerName === "mock") {
    cachedProvider = new MockOcrProvider();
  } else if (providerName === "google-document-ai") {
    cachedProvider = createGoogleDocumentAiProviderFromEnv();
  } else {
    throw new Error(
      `Az "${providerName}" OCR provider nem ismert. Támogatott értékek: "mock", "google-document-ai". ` +
        "Más szolgáltatóhoz (pl. Azure AI Document Intelligence) implementáld az OcrProvider interfészt."
    );
  }
  return cachedProvider;
}
