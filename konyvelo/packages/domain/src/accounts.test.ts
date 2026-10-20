import { describe, expect, it } from "vitest";
import { buildAccountTree, findParentNumber, searchAccounts, validateAccountNumber } from "./accounts";
import { validateBankAccount, validateIban } from "./bank-account";
import { DEFAULT_CHART } from "./default-chart";

const sample = [
  { number: "3", name: "Követelések" },
  { number: "38", name: "Pénzeszközök" },
  { number: "381", name: "Pénztár" },
  { number: "384", name: "Elszámolási betétszámla" },
  { number: "3841", name: "OTP forint számla" },
  { number: "45", name: "Rövid lejáratú kötelezettségek" },
  { number: "454", name: "Szállítók" },
  { number: "455", name: "Beruházási szállítók" },
  { number: "52", name: "Igénybe vett szolgáltatások költségei" },
];

describe("számlaszám és hierarchia", () => {
  it("számlaszám formája", () => {
    expect(validateAccountNumber("3841")).toBeNull();
    expect(validateAccountNumber("38a")).toMatch(/számjegy/);
    expect(validateAccountNumber("")).not.toBeNull();
    expect(validateAccountNumber("123456789")).not.toBeNull();
  });

  it("szülő: a leghosszabb meglévő előtag", () => {
    const numbers = sample.map((a) => a.number);
    expect(findParentNumber("3841", numbers)).toBe("384");
    expect(findParentNumber("3842", numbers)).toBe("384");
    expect(findParentNumber("39", numbers)).toBe("3");
    expect(findParentNumber("9", numbers)).toBeNull();
  });

  it("fa: szint és gyűjtőszámla jelölés", () => {
    const tree = buildAccountTree(sample);
    const by = Object.fromEntries(tree.map((t) => [t.number, t]));
    expect(by["3"]).toMatchObject({ level: 0, hasChildren: true });
    expect(by["384"]).toMatchObject({ level: 2, hasChildren: true, parentNumber: "38" });
    expect(by["3841"]).toMatchObject({ level: 3, hasChildren: false });
    expect(by["381"]).toMatchObject({ hasChildren: false });
    // A 45 nem a 454 gyereke-e? Fordítva: 454 a 45 gyereke.
    expect(by["454"]).toMatchObject({ parentNumber: "45", level: 1 });
  });
});

describe("számlakeresés", () => {
  it("számra: előtag, rövidebb előre", () => {
    expect(searchAccounts(sample, "38").map((a) => a.number)).toEqual(["38", "381", "384", "3841"]);
    expect(searchAccounts(sample, "384").map((a) => a.number)).toEqual(["384", "3841"]);
  });

  it("névre: ékezet- és kisbetű-érzéketlen, szókezdő egyezés előre", () => {
    expect(searchAccounts(sample, "szallitok").map((a) => a.number)).toEqual(["454", "455"]);
    expect(searchAccounts(sample, "PÉNZ").map((a) => a.number)).toEqual(["38", "381"]);
    expect(searchAccounts(sample, "betet").map((a) => a.number)).toEqual(["384"]);
  });

  it("szám és név együtt", () => {
    expect(searchAccounts(sample, "45 beruh").map((a) => a.number)).toEqual(["455"]);
  });

  it("üres keresés: számlaszám szerint", () => {
    expect(searchAccounts(sample, "", 3).map((a) => a.number)).toEqual(["3", "38", "381"]);
  });
});

describe("alapértelmezett számlatükör", () => {
  it("egyedi, érvényes számlaszámok, minden osztály szerepel", () => {
    const numbers = DEFAULT_CHART.map((a) => a.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const n of numbers) expect(validateAccountNumber(n)).toBeNull();
    for (let c = 0; c <= 9; c++) expect(numbers).toContain(String(c));
  });

  it("minden számlának van szülője (az osztály kivételével)", () => {
    const numbers = DEFAULT_CHART.map((a) => a.number);
    for (const n of numbers.filter((x) => x.length > 1)) {
      expect(findParentNumber(n, numbers), n).not.toBeNull();
    }
  });

  it("analitikák és áfa-számlák a helyükön", () => {
    const by = Object.fromEntries(DEFAULT_CHART.map((a) => [a.number, a]));
    expect(by["311"]?.subledger).toBe("CUSTOMER");
    expect(by["454"]?.subledger).toBe("SUPPLIER");
    expect(by["384"]?.subledger).toBe("BANK");
    expect(by["381"]?.subledger).toBe("CASH");
    expect(by["466"]).toMatchObject({ name: "Előzetesen felszámított általános forgalmi adó", normalSide: "D" });
    expect(by["467"]).toMatchObject({ normalSide: "C" });
    expect(by["119"]).toMatchObject({ nature: "ASSET", normalSide: "C" });
    expect(by["911"]).toMatchObject({ nature: "REVENUE", normalSide: "C" });
    expect(by["492"]?.nature).toBe("CLOSING");
  });
});

describe("bankszámlaszám", () => {
  it("belföldi formák", () => {
    expect(validateBankAccount("11773016-11111018")).toEqual({ ok: true, normalized: "11773016-11111018" });
    expect(validateBankAccount("117730161111101800000000")).toEqual({ ok: true, normalized: "11773016-11111018-00000000" });
  });
  it("IBAN mod-97 ellenőrzéssel", () => {
    expect(validateIban("HU42 1177 3016 1111 1018 0000 0000")).toBe(true);
    expect(validateIban("HU43 1177 3016 1111 1018 0000 0000")).toBe(false);
    expect(validateBankAccount("hu42117730161111101800000000")).toEqual({ ok: true, normalized: "HU42 1177 3016 1111 1018 0000 0000" });
    expect(validateIban("DE89370400440532013000")).toBe(true);
  });
  it("hibás forma", () => {
    expect(validateBankAccount("1234").ok).toBe(false);
  });
});
