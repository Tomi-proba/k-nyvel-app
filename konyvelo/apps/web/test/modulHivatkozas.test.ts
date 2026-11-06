// A más programra mutató hivatkozás (F18; a keretben F26): önállóan a program beállított címe új lapon (mint eddig),
// a közös keretben a keret útvonala, új lap nélkül (a kattintást a keret útválasztója kapja).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KeretSzolgaltato, type KeretKontextus } from "@aweboldal/felulet";
import { ModulHivatkozas } from "../src/keret/ModulHivatkozas";

const hiv = (url: string | null, path: string | null, module = "keszlet") =>
  createElement(ModulHivatkozas, { module, url, path, children: "megnyitás" });

describe("hivatkozás más program tételére", () => {
  it("önállóan: a beállított cím új lapon; cím nélkül csak szöveg", () => {
    expect(renderToStaticMarkup(hiv("https://keszlet.example/#/mozgas/3", "/mozgas/3"))).toBe(
      '<a href="https://keszlet.example/#/mozgas/3" target="_blank" rel="noreferrer">megnyitás</a>',
    );
    expect(renderToStaticMarkup(hiv(null, "/mozgas/3"))).toBe("megnyitás");
  });

  it("a keretben: a keret útvonala, új lap nélkül (a Készlet, az eÁFA és a Könyvelő előtagjával)", () => {
    const k = { navigal: () => undefined } as unknown as KeretKontextus;
    const keretben = (el: ReturnType<typeof hiv>) => renderToStaticMarkup(createElement(KeretSzolgaltato, { value: k }, el));
    expect(keretben(hiv(null, "/mozgas/3"))).toBe('<a href="/keszlet/mozgas/3" data-modul-hivatkozas="keszlet">megnyitás</a>');
    expect(keretben(hiv("https://eafa.example/#/bevallas/9", "#/bevallas/9", "eafa"))).toBe('<a href="/afa/bevallas/9" data-modul-hivatkozas="eafa">megnyitás</a>');
    expect(keretben(hiv(null, null))).toBe("megnyitás");
  });
});
