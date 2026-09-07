import { describe, expect, it } from "vitest";
import {
  calculateGrossFromNet,
  calculateNetFromGross,
  calculateVatFromNet,
  roundToTwoDecimals,
  summarizeByMonth,
} from "@/lib/vat";

describe("ÁFA-számítás", () => {
  it("bruttót számol nettóból 27%-os ÁFA-kulccsal", () => {
    expect(calculateGrossFromNet(10000, 27)).toBe(12700);
  });

  it("ÁFA összeget számol nettóból", () => {
    expect(calculateVatFromNet(10000, 27)).toBe(2700);
  });

  it("nettót számol bruttóból (visszaszámolás)", () => {
    expect(calculateNetFromGross(12700, 27)).toBe(10000);
  });

  it("helyesen kerekít két tizedesjegyre", () => {
    expect(roundToTwoDecimals(10.005)).toBeCloseTo(10.01, 2);
    expect(calculateVatFromNet(1234.56, 27)).toBe(333.33);
  });

  it("kezeli az 5%-os és 18%-os kedvezményes ÁFA-kulcsokat is", () => {
    expect(calculateGrossFromNet(10000, 5)).toBe(10500);
    expect(calculateGrossFromNet(10000, 18)).toBe(11800);
  });

  it("0%-os kulcsnál a bruttó megegyezik a nettóval", () => {
    expect(calculateGrossFromNet(5000, 0)).toBe(5000);
    expect(calculateVatFromNet(5000, 0)).toBe(0);
  });
});

describe("Havi összesítés (summarizeByMonth)", () => {
  const invoices = [
    { direction: "EXPENSE" as const, issueDate: "2026-08-05", netAmount: 10000, vatAmount: 2700, grossAmount: 12700 },
    { direction: "EXPENSE" as const, issueDate: "2026-08-15", netAmount: 5000, vatAmount: 1350, grossAmount: 6350 },
    { direction: "INCOME" as const, issueDate: "2026-08-20", netAmount: 100000, vatAmount: 27000, grossAmount: 127000 },
    { direction: "INCOME" as const, issueDate: "2026-07-10", netAmount: 50000, vatAmount: 13500, grossAmount: 63500 },
    // dátum nélküli (még feldolgozás alatt lévő) bizonylat — nem szabad szerepelnie egyik hónapban sem
    { direction: "EXPENSE" as const, issueDate: null, netAmount: 1000, vatAmount: 270, grossAmount: 1270 },
  ];

  it("hónaponként csoportosít és összegez", () => {
    const summary = summarizeByMonth(invoices);
    expect(summary).toHaveLength(2);

    const august = summary.find((s) => s.month === "2026-08");
    expect(august).toBeDefined();
    expect(august!.expenseNet).toBe(15000);
    expect(august!.expenseVat).toBe(4050);
    expect(august!.expenseGross).toBe(19050);
    expect(august!.incomeGross).toBe(127000);
    expect(august!.invoiceCount).toBe(3);
  });

  it("kihagyja a dátum nélküli bizonylatokat", () => {
    const summary = summarizeByMonth(invoices);
    const totalInvoices = summary.reduce((sum, s) => sum + s.invoiceCount, 0);
    expect(totalInvoices).toBe(4); // az 5.-ből az 1 dátum nélküli nem számít
  });

  it("helyesen számolja az egyenleget és az ÁFA-egyenleget", () => {
    const summary = summarizeByMonth(invoices);
    const august = summary.find((s) => s.month === "2026-08")!;
    expect(august.balanceGross).toBe(127000 - 19050);
    expect(august.vatBalance).toBe(27000 - 4050);
  });

  it("csökkenő hónap szerint rendez (legfrissebb elöl)", () => {
    const summary = summarizeByMonth(invoices);
    expect(summary.map((s) => s.month)).toEqual(["2026-08", "2026-07"]);
  });

  it("üres bemenetre üres tömböt ad vissza", () => {
    expect(summarizeByMonth([])).toEqual([]);
  });
});
