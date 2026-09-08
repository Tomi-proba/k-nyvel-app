import { describe, expect, it, vi } from "vitest";

const mockProcessDocument = vi.fn();

vi.mock("@google-cloud/documentai", () => {
  class DocumentProcessorServiceClient {
    processDocument = mockProcessDocument;
    processorPath(projectId: string, location: string, processorId: string) {
      return `projects/${projectId}/locations/${location}/processors/${processorId}`;
    }
  }
  return { DocumentProcessorServiceClient };
});

const { GoogleDocumentAiProvider } = await import("@/lib/ocr-providers/google-document-ai");

function makeProvider() {
  return new GoogleDocumentAiProvider({
    projectId: "test-project",
    location: "eu",
    processorId: "test-processor",
  });
}

describe("GoogleDocumentAiProvider", () => {
  it("a magas konfidenciájú entitásokat kiolvassa, a nettó/ÁFA-ból ÁFA kulcsot számol", async () => {
    mockProcessDocument.mockResolvedValueOnce([
      {
        document: {
          entities: [
            { type: "supplier_name", mentionText: "Teszt Kft.", confidence: 0.95 },
            { type: "supplier_tax_id", mentionText: "12345678-1-42", confidence: 0.9 },
            {
              type: "invoice_date",
              confidence: 0.92,
              normalizedValue: { dateValue: { year: 2026, month: 8, day: 15 } },
            },
            {
              type: "net_amount",
              confidence: 0.93,
              normalizedValue: { moneyValue: { units: 10000, nanos: 0 } },
            },
            {
              type: "total_tax_amount",
              confidence: 0.93,
              normalizedValue: { moneyValue: { units: 2700, nanos: 0 } },
            },
            // due_date: alacsony konfidencia -> bizonytalannak kell számítania
            { type: "due_date", mentionText: "2026-08-29", confidence: 0.4 },
            // total_amount: nincs benne a válaszban egyáltalán -> bizonytalan
          ],
        },
      },
    ]);

    const provider = makeProvider();
    const result = await provider.extract({
      buffer: Buffer.from("fake-pdf-bytes"),
      mimeType: "application/pdf",
      fileName: "szamla.pdf",
    });

    expect(result.fields.partnerNameRaw).toBe("Teszt Kft.");
    expect(result.fields.partnerTaxNumber).toBe("12345678-1-42");
    expect(result.fields.issueDate).toBe("2026-08-15");
    expect(result.fields.netAmount).toBe("10000.00");
    expect(result.fields.vatAmount).toBe("2700.00");
    expect(result.fields.vatRate).toBe("27");

    expect(result.uncertainFields).toContain("dueDate");
    expect(result.uncertainFields).toContain("grossAmount");
    expect(result.uncertainFields).not.toContain("partnerNameRaw");
    expect(result.uncertainFields).not.toContain("netAmount");
  });

  it("üres dokumentumra minden mezőt bizonytalannak jelöl, sosem talál ki adatot", async () => {
    mockProcessDocument.mockResolvedValueOnce([{ document: { entities: [] } }]);

    const provider = makeProvider();
    const result = await provider.extract({
      buffer: Buffer.from("empty"),
      mimeType: "image/png",
      fileName: "elmosodott.png",
    });

    expect(Object.keys(result.fields)).toHaveLength(0);
    expect(result.uncertainFields).toEqual(
      expect.arrayContaining([
        "partnerNameRaw",
        "partnerTaxNumber",
        "issueDate",
        "dueDate",
        "netAmount",
        "vatAmount",
        "grossAmount",
        "vatRate",
      ])
    );
    expect(result.overallConfidence).toBe(0);
  });

  it("a nyers válaszban megőrzi az entitásokat audit célra", async () => {
    mockProcessDocument.mockResolvedValueOnce([
      {
        document: {
          entities: [{ type: "supplier_name", mentionText: "Audit Kft.", confidence: 0.99 }],
        },
      },
    ]);

    const provider = makeProvider();
    const result = await provider.extract({
      buffer: Buffer.from("x"),
      mimeType: "application/pdf",
      fileName: "audit.pdf",
    });

    expect(result.raw).toMatchObject({ provider: "google-document-ai", fileName: "audit.pdf" });
  });
});
