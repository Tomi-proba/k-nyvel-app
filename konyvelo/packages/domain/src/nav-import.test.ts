import { describe, expect, it } from "vitest";
import { navAmountToFiller, proposeNavPosting, splitIntoWindows, taxNumberBase, type NavInvoiceForProposal } from "./nav-import";

const invoice = (o: Partial<NavInvoiceForProposal> = {}): NavInvoiceForProposal => ({
  direction: "INBOUND",
  operation: "CREATE",
  invoiceNumber: "SZ-2026/0042",
  originalInvoiceNumber: null,
  partnerName: "Szállító Kft.",
  issueDate: "2026-09-15",
  deliveryDate: "2026-09-14",
  paymentDate: "2026-09-30",
  netAmountHuf: 10_000_000,
  vatAmountHuf: 2_700_000,
  completenessIndicator: false,
  currency: "HUF",
  ...o,
});
const accounts = { main: "acc-529", partnerAccount: "acc-454", vat: "acc-466" };

describe("időablakok", () => {
  it("a 35 napnál hosszabb időszakot egymást nem fedő ablakokra bontja", () => {
    expect(splitIntoWindows("2026-01-01", "2026-03-31")).toEqual([
      { from: "2026-01-01", to: "2026-02-04" },
      { from: "2026-02-05", to: "2026-03-11" },
      { from: "2026-03-12", to: "2026-03-31" },
    ]);
    expect(splitIntoWindows("2026-09-01", "2026-09-01")).toEqual([{ from: "2026-09-01", to: "2026-09-01" }]);
    expect(() => splitIntoWindows("2026-09-02", "2026-09-01")).toThrow();
  });
});

describe("összegek és adószám", () => {
  it("forintból fillér, kerekítve, előjellel", () => {
    expect(navAmountToFiller(12500)).toBe(1_250_000);
    expect(navAmountToFiller(0.285)).toBe(29);
    expect(navAmountToFiller(-27000.5)).toBe(-2_700_050);
    expect(navAmountToFiller(null)).toBeNull();
  });
  it("törzsszám", () => {
    expect(taxNumberBase("12345676-2-41")).toBe("12345676");
    expect(taxNumberBase("12345676")).toBe("12345676");
    expect(taxNumberBase("abc")).toBeNull();
  });
});

describe("könyvelési javaslat", () => {
  it("bejövő számla: T költség, T 466 / K szállító; a nem teljes adatszolgáltatást jelzi", () => {
    const p = proposeNavPosting(invoice(), accounts, null);
    expect(p.action).toBe("DOCUMENT");
    if (p.action !== "DOCUMENT") return;
    expect(p.docType).toBe("SZSZ");
    expect(p.lines).toEqual([
      { accountId: "acc-529", side: "D", amount: 10_000_000, role: "MAIN" },
      { accountId: "acc-466", side: "D", amount: 2_700_000, role: "VAT" },
      { accountId: "acc-454", side: "C", amount: 12_700_000, role: "PARTNER" },
    ]);
    expect(p).toMatchObject({ externalNumber: "SZ-2026/0042", fulfillmentDate: "2026-09-14", accountingDate: "2026-09-14", dueDate: "2026-09-30" });
    expect(p.warnings.join(" ")).toMatch(/nem teljes számla/);
    expect(p.blockers).toEqual([]);
  });

  it("kimenő számla: T vevő / K árbevétel, K 467; áfa nélkül nincs áfasor", () => {
    const p = proposeNavPosting(invoice({ direction: "OUTBOUND", vatAmountHuf: 0, completenessIndicator: true }), { main: "acc-912", partnerAccount: "acc-311", vat: "acc-467" }, null);
    if (p.action !== "DOCUMENT") throw new Error();
    expect(p.docType).toBe("VSZ");
    expect(p.lines).toEqual([
      { accountId: "acc-311", side: "D", amount: 10_000_000, role: "PARTNER" },
      { accountId: "acc-912", side: "C", amount: 10_000_000, role: "MAIN" },
    ]);
    expect(p.warnings).toEqual([]);
  });

  it("hiányzó költségszámlánál figyelmeztet, a sor üresen marad", () => {
    const p = proposeNavPosting(invoice(), { ...accounts, main: null }, null);
    if (p.action !== "DOCUMENT") throw new Error();
    expect(p.lines[0]).toMatchObject({ accountId: null, role: "MAIN" });
    expect(p.warnings.join(" ")).toMatch(/nincs alapértelmezett költségszámla/);
  });

  it("módosító számla: helyesbítő az eredetire, negatív különbözetnél felcserélt oldalakkal", () => {
    const original = { id: "doc-1", status: "POSTED" as const, reversed: false, serialNumber: "SZSZ-2026-00001" };
    const p = proposeNavPosting(
      invoice({ operation: "MODIFY", invoiceNumber: "SZ-2026/0042-M1", originalInvoiceNumber: "SZ-2026/0042", netAmountHuf: -1_000_000, vatAmountHuf: -270_000 }),
      accounts,
      original,
    );
    if (p.action !== "DOCUMENT") throw new Error();
    expect(p).toMatchObject({ docType: "HELY", correctsDocumentId: "doc-1" });
    expect(p.lines).toEqual([
      { accountId: "acc-529", side: "C", amount: 1_000_000, role: "MAIN" },
      { accountId: "acc-466", side: "C", amount: 270_000, role: "VAT" },
      { accountId: "acc-454", side: "D", amount: 1_270_000, role: "PARTNER" },
    ]);
    expect(p.description).toMatch(/Módosító számla \(SZ-2026\/0042\)/);
  });

  it("módosító és sztornó számla eredeti nélkül nem hagyható jóvá", () => {
    const m = proposeNavPosting(invoice({ operation: "MODIFY", originalInvoiceNumber: "X-1" }), accounts, null);
    expect(m.blockers.join(" ")).toMatch(/X-1.*nincs a rendszerben/);
    const s = proposeNavPosting(invoice({ operation: "STORNO", originalInvoiceNumber: "X-1" }), accounts, { id: "d", status: "DRAFT", reversed: false, serialNumber: null });
    expect(s.action).toBe("REVERSE");
    expect(s.blockers.join(" ")).toMatch(/még piszkozat/);
  });

  it("sztornó számla: az eredeti bizonylat sztornója", () => {
    const s = proposeNavPosting(invoice({ operation: "STORNO", invoiceNumber: "SZ-S1", originalInvoiceNumber: "SZ-2026/0042" }), accounts, {
      id: "doc-1",
      status: "POSTED",
      reversed: false,
      serialNumber: "SZSZ-2026-00001",
    });
    expect(s).toMatchObject({ action: "REVERSE", originalDocumentId: "doc-1", reason: "NAV sztornó számla: SZ-S1", blockers: [] });
    const twice = proposeNavPosting(invoice({ operation: "STORNO", originalInvoiceNumber: "SZ-2026/0042" }), accounts, {
      id: "doc-1",
      status: "POSTED",
      reversed: true,
      serialNumber: "SZSZ-2026-00001",
    });
    expect(twice.blockers.join(" ")).toMatch(/már sztornózták/);
  });

  it("sablonnal a sablon sorai adják a kontírozást", () => {
    const p = proposeNavPosting(invoice(), accounts, null, [
      { accountId: "acc-512", side: "D", base: "NET" },
      { accountId: "acc-466", side: "D", base: "VAT" },
      { accountId: "acc-454", side: "C", base: "GROSS" },
    ]);
    if (p.action !== "DOCUMENT") throw new Error();
    expect(p.lines.map((l) => [l.accountId, l.side, l.amount])).toEqual([
      ["acc-512", "D", 10_000_000],
      ["acc-466", "D", 2_700_000],
      ["acc-454", "C", 12_700_000],
    ]);
  });
});
