-- A sztornó módja cégenként állítható (a számviteli politika szerint):
--   SWAP     – ugyanazok az összegek fordított oldalon (alapértelmezés)
--   NEGATIVE – ugyanazon az oldalon, negatív előjellel („piros sztornó”)
-- Negatív összeg csak sztornó bizonylaton lehet; ezt a könyvelési trigger ellenőrzi.

ALTER TABLE companies ADD COLUMN reversal_method text NOT NULL DEFAULT 'SWAP'
  CHECK (reversal_method IN ('SWAP', 'NEGATIVE'));

ALTER TABLE journal_lines DROP CONSTRAINT journal_lines_amount_check;

CREATE OR REPLACE FUNCTION documents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_debit   bigint;
  v_credit  bigint;
  v_lines   integer;
  v_bad     integer;
  v_period  text;
  v_year    text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'POSTED' THEN
      RAISE EXCEPTION 'Könyvelt bizonylat nem törölhető. Javítani sztornóval vagy helyesbítő bizonylattal lehet.' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Bizonylat csak piszkozatként hozható létre; a könyvelés külön lépés.' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Könyvelt bizonylat nem módosítható. Javítani sztornóval vagy helyesbítő bizonylattal lehet.' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = 'POSTED' THEN
    SELECT coalesce(sum(amount) FILTER (WHERE side = 'D'), 0),
           coalesce(sum(amount) FILTER (WHERE side = 'C'), 0),
           count(*),
           count(*) FILTER (WHERE account_id IS NULL OR side IS NULL OR amount = 0
                                  OR (amount < 0 AND NEW.doc_type <> 'SZT'))
      INTO v_debit, v_credit, v_lines, v_bad
      FROM journal_lines WHERE document_id = NEW.id;
    IF v_lines < 2 OR v_bad > 0 OR v_debit = 0 THEN
      RAISE EXCEPTION 'Csak legalább két teljes (számla, oldal, pozitív összeg) tételsorral rendelkező bizonylat könyvelhető.' USING ERRCODE = 'P0001';
    END IF;
    IF v_debit <> v_credit THEN
      RAISE EXCEPTION 'A tartozik és követel oldal nem egyezik (eltérés: % fillér).', abs(v_debit - v_credit) USING ERRCODE = 'P0001';
    END IF;

    SELECT p.status, f.status INTO v_period, v_year
      FROM periods p JOIN fiscal_years f ON f.id = p.fiscal_year_id
     WHERE p.company_id = NEW.company_id AND f.id = NEW.fiscal_year_id
       AND NEW.accounting_date BETWEEN p.start_date AND p.end_date;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A könyvelés dátuma nem esik a bizonylat üzleti évébe.' USING ERRCODE = 'P0001';
    END IF;
    IF v_year <> 'OPEN' OR v_period <> 'OPEN' THEN
      RAISE EXCEPTION 'Lezárt időszakba nem lehet könyvelni.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
