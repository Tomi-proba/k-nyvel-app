import { createHash, createHmac, randomUUID } from "node:crypto";
import type { NavDirection } from "@konyvelo/domain";

/**
 * Az eÁFA NAV-átjárójának kliense (eafa-m2m docs/KONYVELO-ATJARO.md). A Könyvelő maga soha nem
 * fordul a NAV-hoz: a NAV Online Számla lekérdezéseit az eÁFA végzi a cég NAV-kapcsolatával, a saját
 * főkapcsolója és éles kapcsolója mögött. Minden kérést a közös titokkal írunk alá (HMAC-SHA256,
 * időbélyeg és egyszer használható nonce).
 */

export type GatewayConnection = {
  configured: boolean;
  state: "OK" | "NOT_TESTED" | "BROKEN" | "UNREACHABLE";
  title: string;
  action: string | null;
  checkedAt: string | null;
};

export type GatewayLink = {
  linkId: string;
  active: boolean;
  revokedAt: string | null;
  revokedFrom: "EAFA" | "KONYVELO" | null;
  environment: "TEST" | "PRODUCTION";
  taxpayerName: string | null;
  taxNumber: string | null;
  connection: GatewayConnection | null;
  navCallsEnabled: boolean;
  productionEnabled: boolean;
};

/** Egy számla kivonata, ahogy az eÁFA a NAV válaszából továbbadja (összegek forintban, tizedes számként). */
export type GatewayDigest = {
  invoiceNumber: string;
  batchIndex: number | null;
  invoiceOperation: "CREATE" | "MODIFY" | "STORNO";
  invoiceCategory: string | null;
  invoiceIssueDate: string;
  supplierTaxNumber: string;
  supplierName: string | null;
  customerTaxNumber: string | null;
  customerName: string | null;
  paymentMethod: string | null;
  paymentDate: string | null;
  invoiceDeliveryDate: string | null;
  currency: string | null;
  invoiceNetAmountHuf: number | null;
  invoiceVatAmountHuf: number | null;
  originalInvoiceNumber: string | null;
  modificationIndex: number | null;
  insDate: string | null;
  completenessIndicator: boolean | null;
};

export type GatewayDigestPage = { currentPage: number; availablePage: number; invoices: GatewayDigest[] };

export type GatewayInvoiceData = {
  found: boolean;
  invoiceXmlBase64: string | null;
  insDate: string | null;
  source: string | null;
  originalRequestVersion: string | null;
  document: Record<string, unknown> | null;
};

/** Az átjáró hibája: HTTP-státusz, gépi kód (pl. NAV_CALLS_DISABLED), magyar üzenet, részletek. */
export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: { action?: string; navErrorCode?: string; requestId?: string; connectionBroken?: boolean } = {},
  ) {
    super(message);
  }
}

export type GatewayClient = {
  link(input: { code: string; taxNumber: string; companyRef: string; companyName: string }): Promise<GatewayLink>;
  status(linkId: string): Promise<GatewayLink>;
  unlink(linkId: string): Promise<void>;
  digest(linkId: string, input: { direction: NavDirection; dateFrom: string; dateTo: string; page: number }): Promise<GatewayDigestPage>;
  invoiceData(linkId: string, input: { invoiceNumber: string; direction: NavDirection; batchIndex?: number | null; supplierTaxNumber?: string | null }): Promise<GatewayInvoiceData>;
};

/** Az aláírás; az eÁFA ugyanígy számolja (GatewayAuthFilter). */
export function signGatewayRequest(secret: string, method: string, path: string, timestamp: string, nonce: string, body: string): string {
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  return createHmac("sha256", secret).update(`${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`, "utf8").digest("hex");
}

/** A NAV 60 mp-ig válaszolhat, előtte az átjáró sorában is várhat a kérés. */
const TIMEOUT_MS = 90_000;

export function createGatewayClient(config: { url: string; secret: string }): GatewayClient {
  const base = new URL(config.url.endsWith("/") ? config.url : config.url + "/");

  async function call<T>(method: "GET" | "POST" | "DELETE", relative: string, payload?: unknown): Promise<T> {
    const url = new URL(`api/gateway/v1/${relative}`, base);
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomUUID().replace(/-/g, "");
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Gateway-Timestamp": timestamp,
      "X-Gateway-Nonce": nonce,
      "X-Gateway-Signature": signGatewayRequest(config.secret, method, url.pathname + url.search, timestamp, nonce, body),
    };
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body: payload === undefined ? undefined : body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new GatewayError(503, "GATEWAY_UNREACHABLE", "Az eÁFA NAV-átjárója most nem érhető el. Próbálja újra később.");
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const e = (data ?? {}) as { code?: string; message?: string; action?: string; navErrorCode?: string; requestId?: string; connectionBroken?: boolean };
      throw new GatewayError(res.status, e.code ?? "GATEWAY_ERROR", e.message ?? `Az eÁFA NAV-átjárója hibát adott (${res.status}).`, {
        action: e.action,
        navErrorCode: e.navErrorCode,
        requestId: e.requestId,
        connectionBroken: e.connectionBroken,
      });
    }
    return data as T;
  }

  return {
    link: (input) => call("POST", "links", input),
    status: (linkId) => call("GET", `links/${encodeURIComponent(linkId)}`),
    unlink: async (linkId) => {
      await call("DELETE", `links/${encodeURIComponent(linkId)}`);
    },
    digest: (linkId, input) => call("POST", `links/${encodeURIComponent(linkId)}/invoice-digest`, input),
    invoiceData: (linkId, input) => call("POST", `links/${encodeURIComponent(linkId)}/invoice-data`, input),
  };
}
