-- 4. lépés: vevő- és szállítóanalitika (nyitott tételek, kiegyenlítés),
-- pénztár-záróegyenleg maximuma.
--
-- Nyitott tétel: könyvelt tételsor vevő- vagy szállítóanalitikás számlán a
-- „számla” oldalon (vevőnél tartozik, szállítónál követel). Kiegyenlítő
-- tétel: az ellenkező oldali sor (pl. banki kifizetés, jóváírás,
-- beszámítás, leírás). A kettőt a settlements tábla párosítja; a nyitott
-- összeg mindig számolt érték (K 4.4).

ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_company_id_uq UNIQUE (company_id, id);

-- Piszkozatban a tervezett kiegyenlítések ([{itemLineId, amount}]); könyveléskor válnak párosítássá.
ALTER TABLE documents ADD COLUMN settlement_plan jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(settlement_plan) = 'array');

-- A pénzkezelési szabályzat szerinti napi pénztár-záróegyenleg maximuma (fillér, K 1.10).
ALTER TABLE companies ADD COLUMN cash_closing_limit bigint CHECK (cash_closing_limit >= 0);

CREATE TABLE settlements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  -- A nyitott tétel (számla) sora és a kiegyenlítő sor.
  item_line_id     uuid NOT NULL,
  settling_line_id uuid NOT NULL,
  amount           bigint NOT NULL CHECK (amount > 0),
  -- ENTRY: rögzítéskor kiválasztva; MANUAL: utólagos párosítás; REVERSAL: sztornó (nem bontható).
  source           text NOT NULL CHECK (source IN ('ENTRY', 'MANUAL', 'REVERSAL')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL REFERENCES users(id),
  CHECK (item_line_id <> settling_line_id),
  FOREIGN KEY (company_id, item_line_id) REFERENCES journal_lines (company_id, id),
  FOREIGN KEY (company_id, settling_line_id) REFERENCES journal_lines (company_id, id)
);
CREATE INDEX settlements_item_idx ON settlements (item_line_id);
CREATE INDEX settlements_settling_idx ON settlements (settling_line_id);

-- Párosítani csak könyvelt, azonos számlán és partneren lévő sorokat lehet,
-- és egy sor sem egyenlíthető ki többször, mint az összege.
CREATE FUNCTION settlements_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_item    record;
  v_set     record;
  v_used    bigint;
BEGIN
  SELECT l.account_id, l.partner_id, abs(l.amount) AS amount, d.status INTO v_item
    FROM journal_lines l JOIN documents d ON d.id = l.document_id WHERE l.id = NEW.item_line_id FOR UPDATE OF l;
  SELECT l.account_id, l.partner_id, abs(l.amount) AS amount, d.status INTO v_set
    FROM journal_lines l JOIN documents d ON d.id = l.document_id WHERE l.id = NEW.settling_line_id FOR UPDATE OF l;
  IF v_item.status <> 'POSTED' OR v_set.status <> 'POSTED' THEN
    RAISE EXCEPTION 'Csak könyvelt tételek párosíthatók.' USING ERRCODE = 'P0001';
  END IF;
  IF v_item.account_id <> v_set.account_id OR v_item.partner_id IS DISTINCT FROM v_set.partner_id THEN
    RAISE EXCEPTION 'Csak azonos számlán és partneren lévő tételek párosíthatók.' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(sum(amount), 0) INTO v_used FROM settlements WHERE NEW.item_line_id IN (item_line_id, settling_line_id);
  IF v_used + NEW.amount > v_item.amount THEN
    RAISE EXCEPTION 'A tétel nyitott összegénél többet nem lehet kiegyenlíteni.' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(sum(amount), 0) INTO v_used FROM settlements WHERE NEW.settling_line_id IN (item_line_id, settling_line_id);
  IF v_used + NEW.amount > v_set.amount THEN
    RAISE EXCEPTION 'A kiegyenlítő tétel összegénél többet nem lehet párosítani.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER settlements_guard BEFORE INSERT ON settlements FOR EACH ROW EXECUTE FUNCTION settlements_guard();

-- A sztornóhoz tartozó párosítás nem bontható.
CREATE FUNCTION settlements_no_reversal_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'A párosítás nem módosítható; bontsa, majd párosítsa újra.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.source = 'REVERSAL' THEN
    RAISE EXCEPTION 'A sztornó párosítása nem bontható.' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER settlements_no_reversal_delete BEFORE UPDATE OR DELETE ON settlements FOR EACH ROW EXECUTE FUNCTION settlements_no_reversal_delete();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'konyvelo_app') THEN
    GRANT SELECT, INSERT, DELETE ON settlements TO konyvelo_app;
  END IF;
END
$$;
