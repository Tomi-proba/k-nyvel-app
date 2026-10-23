import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { signGatewayRequest } from "../src/modules/nav/gateway";

/**
 * Az eÁFA NAV-átjárója helyett (eafa-m2m docs/KONYVELO-ATJARO.md): ellenőrzi az aláírást, és előre
 * beállított válaszokat ad. A tesztek így semmilyen hálózati kérést nem küldenek az eÁFA-nak vagy a
 * NAV-nak.
 */
export type FakeDigest = Record<string, unknown> & { invoiceNumber: string; invoiceIssueDate: string };

export class FakeGateway {
  readonly secret = "csak-teszthez-hasznalt-kozos-titok-konyvelo-0123";
  /** Kapcsolódási kód → a cég törzsszáma, amelyhez tartozik. */
  readonly codes = new Map<string, string>();
  readonly links = new Map<string, { active: boolean; revokedFrom: string | null; taxNumber: string; connection: Record<string, unknown> }>();
  /** Irány → a kivonatok (a lapozáshoz laponként legfeljebb `pageSize`). */
  readonly digests: Record<string, FakeDigest[]> = { INBOUND: [], OUTBOUND: [] };
  pageSize = 100;
  /** Számlaszám → a teljes számlaadat válasza. */
  readonly invoiceData = new Map<string, Record<string, unknown>>();
  /** A következő kérések hibái (sorban). */
  readonly errors: Array<{ status: number; body: Record<string, unknown> }> = [];
  readonly requests: Array<{ method: string; path: string; body: unknown }> = [];
  badSignatures = 0;
  private server: Server | null = null;

  get url(): string {
    return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const send = (status: number, body?: unknown) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(body === undefined ? "" : JSON.stringify(body));
        };
        const path = req.url ?? "";
        const sig = signGatewayRequest(this.secret, req.method ?? "", path, String(req.headers["x-gateway-timestamp"]), String(req.headers["x-gateway-nonce"]), raw);
        if (sig !== req.headers["x-gateway-signature"]) {
          this.badSignatures++;
          return send(401, { code: "UNAUTHENTICATED", message: "Hiányzó vagy hibás aláírás." });
        }
        const body = raw ? JSON.parse(raw) : null;
        this.requests.push({ method: req.method ?? "", path, body });
        const err = this.errors.shift();
        if (err) return send(err.status, err.body);
        this.route(req.method ?? "", path, body, send);
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  private linkView(id: string) {
    const l = this.links.get(id)!;
    return l.active
      ? { linkId: id, active: true, revokedAt: null, revokedFrom: null, environment: "TEST", taxpayerName: "Minta Kft. (eÁFA)", taxNumber: l.taxNumber, connection: l.connection, navCallsEnabled: true, productionEnabled: false }
      : { linkId: id, active: false, revokedAt: "2026-10-23T10:00:00Z", revokedFrom: l.revokedFrom, environment: "TEST", taxpayerName: null, taxNumber: null, connection: null, navCallsEnabled: true, productionEnabled: false };
  }

  private route(method: string, path: string, body: Record<string, unknown> | null, send: (s: number, b?: unknown) => void) {
    const m = path.match(/^\/api\/gateway\/v1\/links(?:\/([^/]+))?(?:\/([a-z-]+))?$/);
    if (!m) return send(404, { code: "NOT_FOUND", message: "nincs ilyen" });
    const [, linkId, action] = m;
    if (!linkId && method === "POST") {
      const base = this.codes.get(String(body?.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""));
      const tax = String(body?.taxNumber ?? "").replace(/-/g, "").slice(0, 8);
      if (!base || base !== tax) return send(422, { code: "INVALID_CODE", message: "A kapcsolódási kód érvénytelen, lejárt vagy már felhasználták, vagy nem ehhez a céghez tartozik." });
      this.codes.delete(String(body!.code).toUpperCase().replace(/[^A-Z0-9]/g, ""));
      const id = crypto.randomUUID();
      this.links.set(id, { active: true, revokedFrom: null, taxNumber: String(body!.taxNumber), connection: { configured: true, state: "OK", title: "A kapcsolat működik.", action: null, checkedAt: null } });
      return send(201, this.linkView(id));
    }
    const link = linkId ? this.links.get(linkId) : undefined;
    if (!link) return send(404, { code: "LINK_NOT_FOUND", message: "Az összekapcsolás nem található vagy visszavonták." });
    if (!action && method === "GET") return send(200, this.linkView(linkId!));
    if (!link.active) return send(404, { code: "LINK_NOT_FOUND", message: "Az összekapcsolás nem található vagy visszavonták." });
    if (!action && method === "DELETE") {
      link.active = false;
      link.revokedFrom = "KONYVELO";
      return send(204);
    }
    if (action === "invoice-digest") {
      const all = this.digests[String(body!.direction)]!.filter((d) => d.invoiceIssueDate >= String(body!.dateFrom) && d.invoiceIssueDate <= String(body!.dateTo));
      const page = Number(body!.page ?? 1);
      const pages = Math.max(1, Math.ceil(all.length / this.pageSize));
      return send(200, { currentPage: page, availablePage: pages, invoices: all.slice((page - 1) * this.pageSize, page * this.pageSize) });
    }
    if (action === "invoice-data") {
      const d = this.invoiceData.get(String(body!.invoiceNumber));
      return send(200, d ?? { found: false, invoiceXmlBase64: null, insDate: null, source: null, originalRequestVersion: null, document: null });
    }
    send(404, { code: "NOT_FOUND", message: "nincs ilyen" });
  }
}

/** Egy kivonat a NAV-válasz alakjában (ahogy az eÁFA továbbadja). */
export function digest(o: Partial<FakeDigest> & { invoiceNumber: string; invoiceIssueDate: string }): FakeDigest {
  return {
    batchIndex: null,
    invoiceOperation: "CREATE",
    invoiceCategory: "NORMAL",
    supplierTaxNumber: "11111111",
    supplierName: "Szállító Kft.",
    customerTaxNumber: null,
    customerName: null,
    paymentMethod: "TRANSFER",
    paymentDate: null,
    invoiceDeliveryDate: null,
    currency: "HUF",
    invoiceNetAmountHuf: 10000,
    invoiceVatAmountHuf: 2700,
    originalInvoiceNumber: null,
    modificationIndex: null,
    insDate: "2026-09-15T10:00:00.000Z",
    completenessIndicator: false,
    ...o,
  };
}
