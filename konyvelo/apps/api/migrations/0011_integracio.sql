-- I2: a Könyvelő bekötése az integrációs központba (TERV.md F14).
--
-- - Kimenő tábla: az esemény UGYANABBAN a tranzakcióban kerül ide, mint a művelet (könyvelés, sztornó,
--   párosítás, időszakzárás, partner); a háttérben futó átadó a központ visszaigazolása után jelöli
--   elküldöttnek.
-- - Bejövő tábla: a beérkezett esemény azonosítója ugyanabban a tranzakcióban, mint a hatása (pontosan
--   egyszer).
-- - Csak összekapcsolt cégnél keletkezik esemény; anélkül a Könyvelő pontosan úgy működik, mint eddig.

-- A gépi felhasználó: az automatikus műveleteket ő végzi (az audit naplóban így látszik). Belépni nem tud
-- (inaktív, jelszava nincs), cégnek nem tagja, és az első indításnál nem számít felhasználónak.
ALTER TABLE users ADD COLUMN is_system boolean NOT NULL DEFAULT false;
INSERT INTO users (id, email, name, password_hash, is_active, is_system)
VALUES ('00000000-0000-4000-8000-00000000c0de', 'integracio@rendszer.invalid', 'Integrációs központ (automatikus)', '!', false, true);

-- Az integrációból (másik modul eseményéből) létrejött bizonylat eredete.
ALTER TABLE documents DROP CONSTRAINT documents_source_check;
ALTER TABLE documents ADD CONSTRAINT documents_source_check
  CHECK (source IN ('MANUAL', 'TEMPLATE', 'REVERSAL', 'NAV_IMPORT', 'BANK', 'CASH', 'OPENING', 'CLOSING', 'INTEGRATION'));

-- A cég integrációs beállításai. A `linked_at` az összekapcsolás ideje (a központ a kapcsolódási kóddal
-- köti össze, D13); `unlinked_at` a bontásé.
CREATE TABLE integration_settings (
  company_id              uuid PRIMARY KEY REFERENCES companies (id),
  linked_at               timestamptz,
  unlinked_at             timestamptz,
  posting_mode            text NOT NULL DEFAULT 'DRAFT_ONLY' CHECK (posting_mode IN ('DRAFT_ONLY', 'AUTO')),
  draft_only_until        date,
  purchase_date_rule      text NOT NULL DEFAULT 'ASK' CHECK (purchase_date_rule IN ('ASK', 'RECEIVED', 'INVOICE')),
  inventory_account_id    uuid REFERENCES accounts (id),
  cogs_account_id         uuid REFERENCES accounts (id),
  payable_account_id      uuid REFERENCES accounts (id),
  receivable_account_id   uuid REFERENCES accounts (id),
  input_vat_account_id    uuid REFERENCES accounts (id),
  output_vat_account_id   uuid REFERENCES accounts (id),
  revenue_account_id      uuid REFERENCES accounts (id),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid REFERENCES users (id)
);

-- Kapcsolódási kódok: csak a lenyomatuk; egyszer használhatók, 24 óra után lejárnak.
CREATE TABLE integration_link_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies (id),
  code_hash   char(64) NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL REFERENCES users (id),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  revoked_at  timestamptz
);

CREATE TABLE integration_outbox (
  id          uuid PRIMARY KEY,
  company_id  uuid NOT NULL REFERENCES companies (id),
  envelope    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  sent_at     timestamptz,
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text
);
CREATE INDEX integration_outbox_unsent_idx ON integration_outbox (created_at, id) WHERE sent_at IS NULL;

CREATE TABLE integration_sequences (
  record_type  text NOT NULL,
  record_id    text NOT NULL,
  last_value   integer NOT NULL,
  PRIMARY KEY (record_type, record_id)
);

CREATE TABLE integration_inbox (
  event_id      uuid PRIMARY KEY,
  company_id    uuid NOT NULL REFERENCES companies (id),
  event_type    text NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  outcome       text NOT NULL,
  result        jsonb NOT NULL
);

-- A központ kéréseinek egyszer használható azonosítói (visszajátszás ellen), rövid ideig.
CREATE TABLE integration_nonces (
  nonce        text PRIMARY KEY,
  received_at  timestamptz NOT NULL DEFAULT now()
);

-- „Honnan jött?”: a Könyvelő bizonylata és a forrásrekord (másik modul) kapcsolata.
--   kind: PURCHASE (beszerzés), COGS (ELÁBÉ), SALE_LINK (a már rögzített vevőszámla párosítva),
--         PURCHASE_LINK (a már rögzített szállítói számla párosítva), REVERSAL (a forrás visszavonásából).
CREATE TABLE integration_records (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies (id),
  document_id        uuid REFERENCES documents (id) ON DELETE SET NULL,
  kind               text NOT NULL CHECK (kind IN ('PURCHASE', 'COGS', 'SALE_LINK', 'PURCHASE_LINK', 'REVERSAL')),
  source_module      text NOT NULL,
  source_record_type text NOT NULL,
  source_record_id   text NOT NULL,
  source_url         text,
  source_label       text,
  event_id           uuid NOT NULL,
  -- A piszkozat tartalmának lenyomata létrehozáskor: ebből tudjuk, hogy hozzányúltak-e azóta.
  draft_fingerprint  text,
  -- Beszerzésnél a választható dátumok, és hogy a jóváhagyónak kell-e választania (❓2).
  received_date      date,
  invoice_date       date,
  needs_date_choice  boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX integration_records_source_idx ON integration_records (company_id, source_module, source_record_type, source_record_id);
CREATE INDEX integration_records_document_idx ON integration_records (document_id);

-- Az integrációs Teendők. A `hub_key` a központba is bejelentett Teendő kulcsa; a megoldását az átadó
-- jelzi a központnak (`hub_resolved_at`), így az sem vész el.
CREATE TABLE integration_todos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies (id),
  key              text NOT NULL,
  kind             text NOT NULL,
  title            text NOT NULL,
  detail           text,
  document_id      uuid REFERENCES documents (id) ON DELETE SET NULL,
  hub_key          text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolved_by      uuid REFERENCES users (id),
  hub_resolved_at  timestamptz,
  UNIQUE (company_id, key)
);
CREATE INDEX integration_todos_open_idx ON integration_todos (company_id) WHERE resolved_at IS NULL;

-- A Készlet termékei, csak olvasható másolatként (a termékkérdéshez, KK3).
CREATE TABLE integration_products (
  company_id  uuid NOT NULL REFERENCES companies (id),
  product_id  text NOT NULL,
  name        text NOT NULL,
  sku         text,
  unit        text,
  vat_rate    numeric(5, 2),
  active      boolean NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, product_id)
);

-- A bizonylat termék-sorai (KK3; a Készletből jött bizonylatnál a forrás tételei).
CREATE TABLE document_stock_lines (
  document_id   uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  line_no       smallint NOT NULL,
  product_id    text NOT NULL,
  product_name  text NOT NULL,
  quantity      numeric(18, 4) NOT NULL CHECK (quantity > 0),
  unit          text,
  net_amount    bigint NOT NULL,
  vat_rate      numeric(5, 2),
  vat_amount    bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (document_id, line_no)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'konyvelo_app') THEN
    GRANT SELECT, INSERT, UPDATE ON integration_settings, integration_link_codes TO konyvelo_app;
    GRANT SELECT, INSERT, UPDATE ON integration_outbox, integration_sequences, integration_inbox, integration_todos TO konyvelo_app;
    GRANT SELECT, INSERT, DELETE ON integration_nonces TO konyvelo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON integration_records, integration_products, document_stock_lines TO konyvelo_app;
  END IF;
END
$$;
