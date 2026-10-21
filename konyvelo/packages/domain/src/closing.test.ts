import { describe, expect, it } from "vitest";
import { buildClosingLines, parseBalancePaste, parseOpenItemsPaste, retentionUntil } from "./closing";
import { documentBalance } from "./documents";

const ft = (n: number) => n * 100;

describe("évzárás", () => {
  it("az eredményszámlák nullára zárnak, a nyereség a 419 követel oldalára kerül", () => {
    const { lines, result } = buildClosingLines(
      [
        { accountId: "522", number: "522", debit: ft(100000), credit: 0 },
        { accountId: "532", number: "532", debit: ft(2350), credit: 0 },
        { accountId: "912", number: "912", debit: 0, credit: ft(200000) },
        { accountId: "384", number: "384", debit: ft(500000), credit: 0 },
      ],
      { clearingId: "493", resultId: "419" },
    );
    expect(result).toBe(ft(97650));
    expect(lines).toEqual([
      { accountId: "522", side: "C", amount: ft(100000) },
      { accountId: "532", side: "C", amount: ft(2350) },
      { accountId: "912", side: "D", amount: ft(200000) },
      { accountId: "493", side: "C", amount: ft(97650) },
      { accountId: "493", side: "D", amount: ft(97650) },
      { accountId: "419", side: "C", amount: ft(97650) },
    ]);
    expect(documentBalance(lines).difference).toBe(0);
  });

  it("veszteségnél a 419 tartozik oldalra kerül; nulla eredménynél nincs 493/419 sor", () => {
    const loss = buildClosingLines([{ accountId: "a", number: "522", debit: ft(10), credit: 0 }], { clearingId: "493", resultId: "419" });
    expect(loss.result).toBe(-ft(10));
    expect(loss.lines.at(-1)).toEqual({ accountId: "419", side: "D", amount: ft(10) });
    const zero = buildClosingLines(
      [
        { accountId: "a", number: "522", debit: ft(10), credit: 0 },
        { accountId: "b", number: "911", debit: 0, credit: ft(10) },
      ],
      { clearingId: "493", resultId: "419" },
    );
    expect(zero.lines.map((l) => l.accountId)).toEqual(["a", "b"]);
  });

  it("megőrzési határidő", () => {
    expect(retentionUntil("2026-12-31")).toBe("2034-12-31");
  });
});

describe("nyitó egyenlegek beillesztése", () => {
  it("Excelből (tabulátor) és pontosvesszővel, megnevezéssel vagy anélkül; fejléc és nulla sor kimarad", () => {
    const rows = parseBalancePaste(
      ["Számla\tMegnevezés\tTartozik\tKövetel", "384\tBank\t1 250 000\t", "411;Jegyzett tőke;;3 000 000", "454\t\t12 700", "311\t0\t0", "381;;-500;"].join("\n"),
    );
    expect(rows).toEqual([
      { line: 2, number: "384", debit: ft(1250000), credit: 0 },
      { line: 3, number: "411", debit: 0, credit: ft(3000000) },
      { line: 4, number: "454", debit: 0, credit: ft(12700) },
      { line: 6, number: "381", debit: 0, credit: ft(500) },
    ]);
  });

  it("hibás összeg jelölve", () => {
    expect(parseBalancePaste("384\tabc\t")[0]?.error).toBe("Érvénytelen összeg.");
  });

  it("nyitott tételek: partner, számlaszám, esedékesség, összeg", () => {
    const rows = parseOpenItemsPaste("Partner;Számla;Esedékes;Összeg\nIrodaszer Kft.;IR-2026/0040;2026.10.15;127 000\n10537914-4-44;X;rossz;10", 2026);
    expect(rows).toEqual([
      { line: 2, partner: "Irodaszer Kft.", externalNumber: "IR-2026/0040", dueDate: "2026-10-15", amount: ft(127000) },
      { line: 3, partner: "10537914-4-44", externalNumber: "X", dueDate: null, amount: ft(10), error: "Érvénytelen esedékesség (ÉÉÉÉ.HH.NN.)." },
    ]);
  });
});
