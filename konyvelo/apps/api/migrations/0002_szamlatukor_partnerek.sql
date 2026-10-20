-- 2. lépés: számlatükör (főkönyvi számlák) és partnerek (vevők, szállítók).

-- ---------- Főkönyvi számlák ----------

CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  -- A számlaszám 1–8 számjegy; első jegye a számlaosztály (egységes számlakeret 0–9).
  number        text NOT NULL CHECK (number ~ '^[0-9]{1,8}$'),
  account_class smallint GENERATED ALWAYS AS (substr(number, 1, 1)::smallint) STORED,
  name          text NOT NULL CHECK (length(trim(name)) > 0),
  nature        text NOT NULL CHECK (nature IN ('ASSET', 'EQUITY_LIABILITY', 'EXPENSE', 'REVENUE', 'OFF_BALANCE', 'CLOSING')),
  normal_side   char(1) NOT NULL CHECK (normal_side IN ('D', 'C')),
  subledger     text NOT NULL DEFAULT 'NONE' CHECK (subledger IN ('NONE', 'CUSTOMER', 'SUPPLIER', 'BANK', 'CASH')),
  description   text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL REFERENCES users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number),
  UNIQUE (company_id, id)
);
CREATE INDEX accounts_company_number_idx ON accounts (company_id, number text_pattern_ops);

-- A számlaszám utólag nem változtatható (a hierarchia és a későbbi könyvelések miatt).
CREATE FUNCTION accounts_number_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.number <> OLD.number OR NEW.company_id <> OLD.company_id THEN
    RAISE EXCEPTION 'A számlaszám nem módosítható.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER accounts_number_immutable BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION accounts_number_immutable();

-- ---------- Partnerek ----------

CREATE TABLE partners (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                    uuid NOT NULL REFERENCES companies(id),
  kind                          text NOT NULL CHECK (kind IN ('CUSTOMER', 'SUPPLIER', 'BOTH')),
  name                          text NOT NULL CHECK (length(trim(name)) > 0),
  is_private_person             boolean NOT NULL DEFAULT false,
  tax_number                    text CHECK (tax_number ~ '^\d{8}-[1-5]-\d{2}$'),
  community_vat_number          text,
  country                       char(2) NOT NULL DEFAULT 'HU',
  postal_code                   text,
  city                          text,
  address_line                  text,
  bank_account                  text,
  email                         text,
  phone                         text,
  payment_terms_days            smallint CHECK (payment_terms_days BETWEEN 0 AND 365),
  -- Alapértelmezett kontírozás (a cég saját számláira mutathat csak).
  default_receivable_account_id uuid,
  default_payable_account_id    uuid,
  default_expense_account_id    uuid,
  default_revenue_account_id    uuid,
  notes                         text,
  status                        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'ANONYMIZED')),
  anonymized_at                 timestamptz,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  created_by                    uuid NOT NULL REFERENCES users(id),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  -- Magánszemélynél adószámot nem tárolunk (adattakarékosság, GDPR 5. cikk (1) c)).
  CHECK (NOT (is_private_person AND tax_number IS NOT NULL)),
  FOREIGN KEY (company_id, default_receivable_account_id) REFERENCES accounts (company_id, id),
  FOREIGN KEY (company_id, default_payable_account_id) REFERENCES accounts (company_id, id),
  FOREIGN KEY (company_id, default_expense_account_id) REFERENCES accounts (company_id, id),
  FOREIGN KEY (company_id, default_revenue_account_id) REFERENCES accounts (company_id, id)
);
-- Egy cégen belül egy adószámmal egy partner lehet.
CREATE UNIQUE INDEX partners_company_tax_number_uq ON partners (company_id, tax_number)
  WHERE tax_number IS NOT NULL AND status <> 'ANONYMIZED';
CREATE INDEX partners_company_name_idx ON partners (company_id, lower(name));

-- ---------- Jogosultságok ----------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'konyvelo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON accounts, partners TO konyvelo_app;
  END IF;
END
$$;
