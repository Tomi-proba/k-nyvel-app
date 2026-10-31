-- I3 6. lépés (TERV.md F15.5, F15.8): a Készlet leltáreltérése, napi pénztárzárása és visszárúja.
--
-- - Számla-hozzárendelés: pénztár (381), leltári hiány és selejt ellenszámlája (869), leltári többlet
--   ellenszámlája (969). Az összekapcsoláskor, ha üres, a számlaszám szerint töltődik; ha nincs ilyen
--   könyvelhető számla, üres marad, és a tétel addig hiányos (a jóváhagyó választja).
-- - A Könyvelőbe jött tételek új fajtái: RETURN (visszáru helyesbítője), INVENTORY (leltáreltérés),
--   CASH (napi pénztárzárás).
-- - review_note: ha a tételt embernek kell átnéznie, mielőtt csoportosan jóváhagyható (pl. devizás
--   beszerzés, a szállítási díjról nem tudni, hogy a számlán van-e). Egyenként, a bizonylaton
--   továbbra is könyvelhető.

ALTER TABLE integration_settings
  ADD COLUMN cash_account_id uuid REFERENCES accounts (id),
  ADD COLUMN inventory_loss_account_id uuid REFERENCES accounts (id),
  ADD COLUMN inventory_gain_account_id uuid REFERENCES accounts (id);

ALTER TABLE integration_records DROP CONSTRAINT integration_records_kind_check;
ALTER TABLE integration_records ADD CONSTRAINT integration_records_kind_check
  CHECK (kind IN ('PURCHASE', 'COGS', 'SALE_LINK', 'PURCHASE_LINK', 'REVERSAL', 'RETURN', 'INVENTORY', 'CASH'));
ALTER TABLE integration_records ADD COLUMN review_note text;
