import { describe, expect, it } from "vitest";
import {
  applyTemplate,
  balanceErrorMessage,
  deadlineStatus,
  documentBalance,
  formatSerialNumber,
  missingAmountFor,
  recordingDeadline,
  reverseLines,
  splitByVat,
  validateForPosting,
  type PostingCheckInput,
} from "./documents";

const NBSP = "\u00a0";
const huf = (ft: number) => ft * 100;

const base = (over: Partial<PostingCheckInput> = {}): PostingCheckInput => ({
  docType: "VEGY",
  description: "Átvezetés",
  issueDate: "2026-03-10",
  fulfillmentDate: null,
  accountingDate: "2026-03-10",
  dueDate: null,
  externalNumber: null,
  partnerId: null,
  currency: "HUF",
  fxAmount: null,
  fxRate: null,
  lines: [
    { accountId: "a", side: "D", amount: huf(1000) },
    { accountId: "b", side: "C", amount: huf(1000) },
  ],
  ...over,
});

describe("egyensúly", () => {
  it("tartozik = követel esetén nincs hiba", () => {
    expect(documentBalance(base().lines)).toEqual({ debit: 100000, credit: 100000, difference: 0 });
    expect(validateForPosting(base())).toEqual({});
  });

  it("eltérésnél a pontos összeget írja ki", () => {
    const b = documentBalance([
      { side: "D", amount: huf(100000) },
      { side: "D", amount: huf(12500) },
      { side: "C", amount: huf(100000) },
    ]);
    expect(b.difference).toBe(huf(12500));
    expect(balanceErrorMessage(b)).toBe(`A tartozik és követel oldal nem egyezik, eltérés: 12${NBSP}500${NBSP}Ft`);
    expect(missingAmountFor("C", b)).toBe(huf(12500));
    expect(missingAmountFor("D", b)).toBe(0);
  });

  it("fillérre is pontos", () => {
    const b = documentBalance([
      { side: "D", amount: 1 },
      { side: "C", amount: 2 },
    ]);
    expect(balanceErrorMessage(b)).toBe(`A tartozik és követel oldal nem egyezik, eltérés: 0,01${NBSP}Ft`);
  });

  it("véletlen tételekkel: a különbözet beírása után mindig egyensúlyban van", () => {
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let k = 0; k < 500; k++) {
      const lines = Array.from({ length: 1 + rnd(8) }, () => ({ side: rnd(2) ? ("D" as const) : ("C" as const), amount: 1 + rnd(10 ** 9) }));
      const b = documentBalance(lines);
      const side = b.difference > 0 ? "C" : "D";
      const fill = missingAmountFor(side, b);
      const after = documentBalance([...lines, { side, amount: fill }]);
      expect(after.difference).toBe(0);
      expect(after.debit).toBe(lines.filter((l) => l.side === "D").reduce((s, l) => s + l.amount, 0) + (side === "D" ? fill : 0));
    }
  });

  it("nulla és negatív összeg nem számít bele, és hibát ad", () => {
    const e = validateForPosting(
      base({
        lines: [
          { accountId: "a", side: "D", amount: 0 },
          { accountId: "b", side: "C", amount: -500 },
          { accountId: "c", side: "D", amount: 100 },
        ],
      }),
    );
    expect(e["lines.0.amount"]).toMatch(/pozitív/);
    expect(e["lines.1.amount"]).toMatch(/pozitív/);
  });
});

describe("könyvelés előtti ellenőrzés", () => {
  it("üres bizonylat: minden kötelező mező hibát ad", () => {
    const e = validateForPosting(base({ docType: null, description: " ", issueDate: null, accountingDate: null, lines: [] }));
    expect(Object.keys(e).sort()).toEqual(["accountingDate", "description", "docType", "issueDate", "lines"]);
  });

  it("szállítói számla: partner, számlaszám és teljesítés kötelező", () => {
    const e = validateForPosting(base({ docType: "SZSZ" }));
    expect(e).toMatchObject({
      partnerId: "Válasszon partnert.",
      externalNumber: "A szállító számlaszáma: kötelező mező.",
      fulfillmentDate: "Teljesítés dátuma: kötelező mező.",
    });
  });

  it("vevő- vagy szállítóanalitikás számlához partner kell", () => {
    const accounts: Record<string, { subledger: "SUPPLIER" | "BANK"; number: string }> = {
      a: { subledger: "SUPPLIER", number: "454" },
      b: { subledger: "BANK", number: "384" },
    };
    const e = validateForPosting(base({ docType: "BANK" }), (id) => accounts[id]);
    expect(e.partnerId).toMatch(/csak partnerrel/);
    expect(validateForPosting(base({ docType: "BANK", partnerId: "p" }), (id) => accounts[id])).toEqual({});
  });

  it("egy soros vagy egyoldalú bizonylat nem könyvelhető", () => {
    expect(validateForPosting(base({ lines: [{ accountId: "a", side: "D", amount: 100 }] })).lines).toMatch(/Legalább két/);
    expect(
      validateForPosting(
        base({
          lines: [
            { accountId: "a", side: "D", amount: 100 },
            { accountId: "b", side: "D", amount: 100 },
          ],
        }),
      ).lines,
    ).toMatch(/tartozik és követel/);
  });

  it("üres sor nem számít; félig kitöltött sor hibát ad", () => {
    const e = validateForPosting(base({ lines: [...base().lines, { accountId: null, side: null, amount: null }, { accountId: null, side: "D", amount: 500 }] }));
    expect(e["lines.2.accountId"]).toBeUndefined();
    expect(e["lines.3.accountId"]).toBe("Válasszon számlát.");
  });

  it("határidő a kelt előtt, devizás bizonylat hiányzó árfolyammal", () => {
    const e = validateForPosting(base({ dueDate: "2026-03-01", currency: "EUR", fxAmount: 10000 }));
    expect(e.dueDate).toMatch(/nem lehet korábbi/);
    expect(e.fxRate).toMatch(/árfolyam/);
    expect(e.fxAmount).toBeUndefined();
  });

  it("helyesbítő bizonylat csak eredetire hivatkozva", () => {
    expect(validateForPosting(base({ docType: "HELY" })).docType).toMatch(/eredeti/);
    expect(validateForPosting(base({ docType: "HELY", correctsDocumentId: "x" }))).toEqual({});
  });
});

describe("sztornó és sorszám", () => {
  it("a sztornó fordított oldalon ugyanazokat az összegeket könyveli", () => {
    const lines = [
      { accountId: "a", side: "D" as const, amount: 5 },
      { accountId: "b", side: "C" as const, amount: 5 },
    ];
    expect(reverseLines(lines)).toEqual([
      { accountId: "a", side: "C", amount: 5 },
      { accountId: "b", side: "D", amount: 5 },
    ]);
  });

  it("sorszám az üzleti év kezdő évével", () => {
    expect(formatSerialNumber("SZSZ", "2026-01-01", 12)).toBe("SZSZ-2026-00012");
    expect(formatSerialNumber("BANK", "2026-07-01", 1)).toBe("BANK-2026-00001");
  });
});

describe("rögzítési határidő (Szt. 165. § (3))", () => {
  it("pénztár: a pénzmozgás napja", () => {
    expect(recordingDeadline({ eventDate: "2026-03-10", touchesCash: true, touchesBank: true }).deadline).toBe("2026-03-10");
  });

  it("bank: a tárgyhót követő hó 15-e", () => {
    expect(recordingDeadline({ eventDate: "2026-01-31", touchesCash: false, touchesBank: true }).deadline).toBe("2026-02-15");
    expect(recordingDeadline({ eventDate: "2026-12-05", touchesCash: false, touchesBank: true }).deadline).toBe("2027-01-15");
  });

  it("egyéb: a tárgynegyedévet követő hó vége", () => {
    const d = (eventDate: string) => recordingDeadline({ eventDate, touchesCash: false, touchesBank: false }).deadline;
    expect(d("2026-01-15")).toBe("2026-04-30");
    expect(d("2026-03-31")).toBe("2026-04-30");
    expect(d("2026-04-01")).toBe("2026-07-31");
    expect(d("2026-11-20")).toBe("2027-01-31");
  });

  it("állapot: piszkozatnál lejárt vagy hamarosan lejár, könyveltnél késve könyvelt", () => {
    expect(deadlineStatus("2026-04-30", { postedOn: null, today: "2026-05-01" })).toBe("OVERDUE");
    expect(deadlineStatus("2026-04-30", { postedOn: null, today: "2026-04-23" })).toBe("DUE_SOON");
    expect(deadlineStatus("2026-04-30", { postedOn: null, today: "2026-04-22" })).toBe("OK");
    expect(deadlineStatus("2026-04-30", { postedOn: "2026-04-30", today: "2026-06-01" })).toBe("OK");
    expect(deadlineStatus("2026-04-30", { postedOn: "2026-05-02", today: "2026-06-01" })).toBe("LATE");
  });
});

describe("sablon: áfa szerinti felbontás", () => {
  it("bruttóból, egész forintra kerekítve", () => {
    expect(splitByVat(huf(12700), "GROSS", 27)).toEqual({ gross: huf(12700), vat: huf(2700), net: huf(10000) });
    // 1000 * 27 / 127 = 212,598… → 213 Ft
    expect(splitByVat(huf(1000), "GROSS", 27)).toEqual({ gross: huf(1000), vat: huf(213), net: huf(787) });
  });

  it("nettóból, és 0%-os kulccsal", () => {
    expect(splitByVat(huf(10001), "NET", 27)).toEqual({ net: huf(10001), vat: huf(2700), gross: huf(12701) });
    expect(splitByVat(huf(5000), "GROSS", 0)).toEqual({ gross: huf(5000), vat: 0, net: huf(5000) });
  });

  it("filléres összegnél fillérre kerekít", () => {
    expect(splitByVat(1050, "NET", 27)).toEqual({ net: 1050, vat: 284, gross: 1334 });
  });

  it("sablon kitöltése; a 0 Ft-os áfasor elmarad", () => {
    const lines = [
      { accountId: "529", side: "D" as const, base: "NET" as const },
      { accountId: "466", side: "D" as const, base: "VAT" as const },
      { accountId: "454", side: "C" as const, base: "GROSS" as const },
    ];
    expect(applyTemplate(lines, splitByVat(huf(12700), "GROSS", 27)).map((l) => l.amount)).toEqual([huf(10000), huf(2700), huf(12700)]);
    expect(applyTemplate(lines, splitByVat(huf(5000), "GROSS", 0)).map((l) => l.accountId)).toEqual(["529", "454"]);
    expect(applyTemplate(lines, null).map((l) => l.amount)).toEqual([null, null, null]);
  });
});
