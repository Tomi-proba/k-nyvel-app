-- 3. lépés: bizonylatok, könyvelési tételek, hézagmentes sorszámozás,
-- kontírozási sablonok.
--
-- A könyvelt bizonylat és tételei adatbázis-szinten is védettek: nem
-- módosíthatók és nem törölhetők (Szt. 165. § (2), 167. § (7)); javítani
-- sztornó vagy helyesbítő bizonylattal lehet. Könyvelni csak egyensúlyban
-- lévő (Σ tartozik = Σ követel) bizonylatot, nyitott időszakba lehet.

-- Az összetett idegenkulcsokhoz (a hivatkozott sor ugyanahhoz a céghez tartozzon).
ALTER TABLE partners ADD CONSTRAINT partners_company_id_uq UNIQUE (company_id, id);
ALTER TABLE fiscal_years ADD CONSTRAINT fiscal_years_company_id_uq UNIQUE (company_id, id);

-- ---------- Bizonylatok (Szt. 166–167. §) ----------

CREATE TABLE documents (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES companies(id),
  fiscal_year_id         uuid NOT NULL,
  doc_type               text NOT NULL CHECK (doc_type IN ('SZSZ', 'VSZ', 'BANK', 'PB', 'PK', 'VEGY', 'SZT', 'HELY')),
  status                 text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED')),
  -- Sorszám (167. § (1) a)): könyveléskor kapja, típusonként és üzleti évenként hézagmentesen.
  seq_no                 integer,
  serial_number          text,
  external_number        text,
  partner_id             uuid,
  -- A gazdasági művelet tartalma (167. § (1) e)).
  description            text,
  issue_date             date,
  fulfillment_date       date,
  accounting_date        date NOT NULL,
  due_date               date,
  -- Deviza (döntés 2.): a könyvelés forintban történik, az eredeti adatok megmaradnak.
  currency               char(3) NOT NULL DEFAULT 'HUF' CHECK (currency ~ '^[A-Z]{3}$'),
  fx_amount              bigint CHECK (fx_amount > 0),
  fx_rate                numeric(18, 6) CHECK (fx_rate > 0),
  fx_rate_source         text CHECK (fx_rate_source IN ('MNB', 'ECB', 'BANK', 'VAT_ACT')),
  fx_rate_date           date,
  -- Utalványozó, ellenőrző (167. § (1) c)).
  authorized_by          text,
  checked_by             text,
  -- Kapcsolatok: sztornó (egy bizonylatot legfeljebb egyszer), helyesbítés.
  reverses_document_id   uuid,
  corrects_document_id   uuid,
  -- Előző üzleti évet érintő hiba (Szt. 3. § (3), K 5.4).
  affects_fiscal_year_id uuid,
  source                 text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'TEMPLATE', 'REVERSAL', 'NAV_IMPORT', 'BANK', 'CASH', 'OPENING', 'CLOSING')),
  -- A használt sablon (csak tájékoztató; a sablon törölhető, ezért nincs idegenkulcs).
  template_id            uuid,
  -- Rögzítés (167. § (1) i)): ki és mikor.
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL REFERENCES users(id),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  posted_at              timestamptz,
  posted_by              uuid REFERENCES users(id),
  -- Hiteles archiválásra felkészítés (döntés 3.): a könyveléskori tartalom
  -- hash-e és a cégenkénti lánc előző eleme; megőrzési határidő; hitelesítés.
  content_hash           text,
  prev_hash              text,
  retention_until        date,
  archive_status         text NOT NULL DEFAULT 'NONE' CHECK (archive_status IN ('NONE', 'PACKAGED', 'ARCHIVED')),
  authenticity_method    text NOT NULL DEFAULT 'NONE' CHECK (authenticity_method IN ('NONE', 'QUALIFIED_E_SIGNATURE', 'TIMESTAMP', 'AUTHENTIC_COPY')),
  authenticity_ref       text,
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, fiscal_year_id) REFERENCES fiscal_years (company_id, id),
  FOREIGN KEY (company_id, partner_id) REFERENCES partners (company_id, id),
  FOREIGN KEY (company_id, reverses_document_id) REFERENCES documents (company_id, id),
  FOREIGN KEY (company_id, corrects_document_id) REFERENCES documents (company_id, id),
  FOREIGN KEY (company_id, affects_fiscal_year_id) REFERENCES fiscal_years (company_id, id),
  CHECK (status = 'DRAFT' OR (seq_no IS NOT NULL AND serial_number IS NOT NULL AND posted_at IS NOT NULL AND posted_by IS NOT NULL
                              AND content_hash IS NOT NULL AND description IS NOT NULL AND issue_date IS NOT NULL)),
  CHECK (status = 'POSTED' OR (seq_no IS NULL AND serial_number IS NULL)),
  CHECK (currency = 'HUF' OR status = 'DRAFT' OR (fx_amount IS NOT NULL AND fx_rate IS NOT NULL)),
  CHECK ((doc_type = 'SZT') = (reverses_document_id IS NOT NULL)),
  CHECK (doc_type <> 'HELY' OR corrects_document_id IS NOT NULL)
);
CREATE UNIQUE INDEX documents_seq_uq ON documents (company_id, fiscal_year_id, doc_type, seq_no) WHERE seq_no IS NOT NULL;
CREATE UNIQUE INDEX documents_serial_uq ON documents (company_id, serial_number) WHERE serial_number IS NOT NULL;
CREATE UNIQUE INDEX documents_reverses_uq ON documents (reverses_document_id) WHERE reverses_document_id IS NOT NULL;
CREATE INDEX documents_company_date_idx ON documents (company_id, accounting_date);
CREATE INDEX documents_company_status_idx ON documents (company_id, status);
CREATE INDEX documents_corrects_idx ON documents (corrects_document_id) WHERE corrects_document_id IS NOT NULL;

-- ---------- Tételsorok (kontírozás, 167. § (1) h)) ----------

CREATE TABLE journal_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  document_id uuid NOT NULL,
  line_no     smallint NOT NULL CHECK (line_no > 0),
  -- Piszkozatban a sor félkész is lehet; könyveléskor mindhárom kötelező (lásd trigger).
  account_id  uuid,
  side        char(1) CHECK (side IN ('D', 'C')),
  -- Összeg fillérben.
  amount      bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
  partner_id  uuid,
  description text,
  UNIQUE (document_id, line_no),
  FOREIGN KEY (company_id, document_id) REFERENCES documents (company_id, id),
  FOREIGN KEY (company_id, account_id) REFERENCES accounts (company_id, id),
  FOREIGN KEY (company_id, partner_id) REFERENCES partners (company_id, id)
);
CREATE INDEX journal_lines_account_idx ON journal_lines (account_id);
CREATE INDEX journal_lines_partner_idx ON journal_lines (partner_id) WHERE partner_id IS NOT NULL;

-- ---------- Hézagmentes sorszámozás (K 3.5) ----------

-- A sorszámot a könyvelő tranzakció a sor zárolásával veszi ki; ha a
-- tranzakció meghiúsul, a sorszám sem fogy el.
CREATE TABLE document_sequences (
  company_id     uuid NOT NULL REFERENCES companies(id),
  fiscal_year_id uuid NOT NULL,
  doc_type       text NOT NULL,
  last_number    integer NOT NULL CHECK (last_number >= 0),
  PRIMARY KEY (company_id, fiscal_year_id, doc_type),
  FOREIGN KEY (company_id, fiscal_year_id) REFERENCES fiscal_years (company_id, id)
);

-- ---------- Védelmek ----------

CREATE FUNCTION documents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
           count(*) FILTER (WHERE account_id IS NULL OR side IS NULL OR amount <= 0)
      INTO v_debit, v_credit, v_lines, v_bad
      FROM journal_lines WHERE document_id = NEW.id;
    IF v_lines < 2 OR v_bad > 0 OR v_debit = 0 THEN
      RAISE EXCEPTION 'Csak legalább két teljes (számla, oldal, összeg) tételsorral rendelkező bizonylat könyvelhető.' USING ERRCODE = 'P0001';
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
CREATE TRIGGER documents_guard BEFORE INSERT OR UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_guard();
CREATE TRIGGER documents_no_truncate BEFORE TRUNCATE ON documents
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

-- Könyvelt bizonylat tételsora nem vehető fel, nem módosítható, nem törölhető.
-- A bizonylatsort megosztottan zároljuk, így a könyveléssel egy időben sem
-- kerülhet új sor a bizonylatra.
CREATE FUNCTION journal_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO v_status FROM documents WHERE id = OLD.document_id FOR SHARE;
    IF v_status = 'POSTED' THEN
      RAISE EXCEPTION 'Könyvelt bizonylat tételsora nem módosítható és nem törölhető.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO v_status FROM documents WHERE id = NEW.document_id FOR SHARE;
    IF v_status = 'POSTED' THEN
      RAISE EXCEPTION 'Könyvelt bizonylathoz nem vehető fel új tételsor.' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER journal_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION journal_lines_guard();
CREATE TRIGGER journal_lines_no_truncate BEFORE TRUNCATE ON journal_lines
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

-- ---------- Kontírozási sablonok ----------

CREATE TABLE posting_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  name        text NOT NULL CHECK (length(trim(name)) > 0),
  shortcut    text,
  doc_type    text CHECK (doc_type IN ('SZSZ', 'VSZ', 'BANK', 'PB', 'PK', 'VEGY', 'HELY')),
  description text,
  vat_rate    smallint CHECK (vat_rate BETWEEN 0 AND 100),
  partner_id  uuid,
  -- [{accountId, side: 'D'|'C', base: 'GROSS'|'NET'|'VAT'|'NONE'}]
  lines       jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, partner_id) REFERENCES partners (company_id, id)
);
CREATE UNIQUE INDEX posting_templates_shortcut_uq ON posting_templates (company_id, lower(shortcut)) WHERE shortcut IS NOT NULL;

-- ---------- Jogosultságok ----------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'konyvelo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON documents, journal_lines, posting_templates TO konyvelo_app;
    GRANT SELECT, INSERT, UPDATE ON document_sequences TO konyvelo_app;
  END IF;
END
$$;
