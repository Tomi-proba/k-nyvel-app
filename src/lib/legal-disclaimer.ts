/**
 * Egységes jogi figyelmeztető szöveg a "Tervezet pénzügyi kimutatás"
 * funkcióhoz. Ez az EGYETLEN forrás — mindenhol ezt importáljuk (képernyő,
 * PDF export, Excel export), hogy a szöveg garantáltan azonos maradjon, és
 * ha módosítani kell, elég egy helyen.
 *
 * Szándékosan nem tartalmaz semmi mást a funkció: nincs NAV-beadásra kész
 * export, nincs "hivatalos" főkönyvi könyvelés — csak egy durva, a user
 * saját rögzített adataiból számolt becslés, amit ez a szöveg egyértelművé
 * tesz minden felületen, ahol megjelenik.
 */

export const DRAFT_STATEMENT_DISCLAIMER =
  "Ez egy automatikusan generált TERVEZET, nem hivatalos számviteli dokumentum. " +
  "A pontos, hivatalos könyveléshez és a NAV felé történő beadáshoz mindenképp forduljon " +
  "regisztrált könyvelőhöz. A tervezet nem helyettesíti a könyvelői ellenőrzést és jóváhagyást.";

export const DRAFT_STATEMENT_WATERMARK = "TERVEZET – NEM HIVATALOS";
