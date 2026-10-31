-- I5 (TERV.md F17.2): az eÁFA-ban beküldött áfabevallások időszakai. Ha egy áfás bizonylat könyvelése vagy egy
-- Készletből jött piszkozat jóváhagyása ilyen időszakba esik, a Könyvelő figyelmeztet (de nem tilt): az eÁFA-ban
-- önellenőrzés lehet szükséges. A csoportos jóváhagyásban az ilyen tétel egyenként hagyható jóvá.

CREATE TABLE integration_vat_periods (
  company_id      uuid NOT NULL REFERENCES companies (id),
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  frequency       text NOT NULL,
  last_kind       text NOT NULL,
  submitted_at    timestamptz NOT NULL,
  declaration_id  text NOT NULL,
  PRIMARY KEY (company_id, period_start)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'konyvelo_app') THEN
    GRANT SELECT, INSERT, UPDATE ON integration_vat_periods TO konyvelo_app;
  END IF;
END
$$;
