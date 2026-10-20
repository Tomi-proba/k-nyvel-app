-- 1. lépés: felhasználók, munkamenetek, cégek, tagság, üzleti évek,
-- időszakok és az audit napló.
--
-- A migrációt a séma tulajdonosa (konyvelo_owner) futtatja. Az alkalmazás
-- futás közben egy korlátozott jogú felhasználóval (konyvelo_app) csatlakozik,
-- amely pl. az audit naplót csak bővíteni tudja, módosítani és törölni nem.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------- Felhasználók és munkamenetek ----------

CREATE TABLE users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                text NOT NULL,
  name                 text NOT NULL,
  password_hash        text NOT NULL,
  is_active            boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  last_login_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ip           text,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Belépési események (sikeres és sikertelen belépés, kilépés, jelszócsere).
CREATE TABLE auth_events (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users(id),
  email      text,
  event      text NOT NULL CHECK (event IN ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGIN_BLOCKED', 'LOGOUT', 'PASSWORD_CHANGED')),
  ip         text,
  user_agent text,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_events_email_at_idx ON auth_events (lower(email), at);
CREATE INDEX auth_events_ip_at_idx ON auth_events (ip, at);

-- ---------- Cégek és tagság ----------

CREATE TABLE companies (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        text NOT NULL,
  short_name                  text NOT NULL,
  tax_number                  text NOT NULL CHECK (tax_number ~ '^\d{8}-[1-5]-\d{2}$'),
  community_vat_number        text,
  registration_number         text,
  address_postal_code         text,
  address_city                text,
  address_line                text,
  representative_name         text,
  -- Szt. 20. § (5b): a könyvvezetés pénzneme. Az MVP csak forintot kezel.
  book_currency               char(3) NOT NULL DEFAULT 'HUF' CHECK (book_currency = 'HUF'),
  balance_sheet_variant       char(1) NOT NULL DEFAULT 'A' CHECK (balance_sheet_variant = 'A'),
  income_statement_method     text NOT NULL DEFAULT 'TOTAL_COST' CHECK (income_statement_method = 'TOTAL_COST'),
  report_type                 text NOT NULL DEFAULT 'SIMPLIFIED_ANNUAL' CHECK (report_type IN ('SIMPLIFIED_ANNUAL', 'MICRO')),
  -- A számviteli politika szerinti jelentős hiba értékhatár (fillér), Szt. 3. § (3) 3.
  significant_error_threshold bigint CHECK (significant_error_threshold >= 0),
  fx_rate_source              text NOT NULL DEFAULT 'MNB' CHECK (fx_rate_source IN ('MNB', 'ECB', 'BANK', 'VAT_ACT')),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NOT NULL REFERENCES users(id),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX companies_tax_number_uq ON companies (tax_number);

CREATE TABLE company_memberships (
  company_id uuid NOT NULL REFERENCES companies(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  role       text NOT NULL CHECK (role IN ('ADMIN', 'CHIEF_ACCOUNTANT', 'ACCOUNTANT', 'VIEWER')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  PRIMARY KEY (company_id, user_id)
);
CREATE INDEX company_memberships_user_idx ON company_memberships (user_id);

-- ---------- Üzleti évek és időszakok (Szt. 11. §) ----------

CREATE TABLE fiscal_years (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSING', 'CLOSED')),
  -- 12 hónapnál hosszabb üzleti év csak indoklással (pl. előtársasági időszak).
  exception_reason text,
  closed_at        timestamptz,
  closed_by        uuid REFERENCES users(id),
  -- A megőrzési idő vége (Szt. 169. §): a záráskor töltődik ki.
  retention_until  date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL REFERENCES users(id),
  CHECK (end_date >= start_date),
  CHECK (end_date < (start_date + interval '12 months')::date OR exception_reason IS NOT NULL),
  -- Az üzleti évek egy cégen belül nem fedhetik egymást.
  EXCLUDE USING gist (company_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
);

CREATE TABLE periods (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  fiscal_year_id uuid NOT NULL REFERENCES fiscal_years(id),
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  status         text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  closed_at      timestamptz,
  closed_by      uuid REFERENCES users(id),
  CHECK (end_date >= start_date),
  UNIQUE (fiscal_year_id, start_date),
  EXCLUDE USING gist (company_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
);

-- ---------- Audit napló ----------

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  company_id  uuid REFERENCES companies(id),
  user_id     uuid REFERENCES users(id),
  at          timestamptz(3) NOT NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  ip          text,
  prev_hash   text,
  hash        text NOT NULL
);
CREATE INDEX audit_log_company_idx ON audit_log (company_id, id);

-- Az audit napló csak bővíthető: módosítás, törlés és ürítés tiltva.
CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Az audit napló nem módosítható és nem törölhető.' USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

-- Ugyanez a belépési eseményekre.
CREATE TRIGGER auth_events_no_update_delete BEFORE UPDATE OR DELETE ON auth_events
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- ---------- Jogosultságok az alkalmazás adatbázis-felhasználójának ----------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'konyvelo_app') THEN
    GRANT USAGE ON SCHEMA public TO konyvelo_app;
    GRANT SELECT, INSERT, UPDATE ON users, companies, fiscal_years, periods TO konyvelo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, company_memberships TO konyvelo_app;
    GRANT SELECT, INSERT ON audit_log, auth_events TO konyvelo_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO konyvelo_app;
  END IF;
END
$$;
