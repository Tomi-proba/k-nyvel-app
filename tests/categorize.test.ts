import { describe, expect, it } from "vitest";
import { matchCategoryByKeyword } from "@/lib/categorize";

const categories = [
  { id: "iroda", keywords: ["iroda", "papír", "toner", "irodaszer"] },
  { id: "utazas", keywords: ["utazás", "szállás", "repül", "vonat", "taxi", "benzin", "üzemanyag"] },
  { id: "szoftver", keywords: ["szoftver", "software", "saas", "előfizetés", "licenc", "subscription"] },
  { id: "konyveles", keywords: ["könyvelés", "könyvelő", "accounting"] },
];

describe("matchCategoryByKeyword", () => {
  it("kulcsszó egyezés esetén a megfelelő kategóriát adja vissza", () => {
    expect(matchCategoryByKeyword("Microsoft Ireland Operations Ltd. (software)", categories)).toBe("szoftver");
  });

  it("nem érzékeny a kis-/nagybetűre", () => {
    expect(matchCategoryByKeyword("IRODASZER DISZKONT KFT.", categories)).toBe("iroda");
  });

  it("a leghosszabb (legspecifikusabb) egyező kulcsszót részesíti előnyben", () => {
    // "Könyvelő Iroda Bt." egyszerre illeszkedik a "könyvelő" (8 karakter) és
    // az "iroda" (5 karakter) kulcsszóra is — a hosszabbnak kell nyernie.
    expect(matchCategoryByKeyword("Könyvelő Iroda Bt.", categories)).toBe("konyveles");
  });

  it("nincs egyezés esetén undefined-et ad vissza", () => {
    expect(matchCategoryByKeyword("Teljesen Ismeretlen Cég Kft.", categories)).toBeUndefined();
  });

  it("üres kategórialistára is undefined-et ad vissza", () => {
    expect(matchCategoryByKeyword("Bármi Kft.", [])).toBeUndefined();
  });
});
