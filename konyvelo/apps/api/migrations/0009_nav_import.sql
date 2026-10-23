-- 7. lépés: NAV Online Számla import az eÁFA NAV-átjáróján keresztül (PLAN 10.).
-- A Könyvelőben NAV-titok nincs: a PLAN 4.8 pontjában tervezett nav_credentials tábla elmarad.
-- Egy cég adatai soha nem érhetők el pusztán az adószám ismeretében (TERV.md D13): az
-- összekapcsoláshoz az eÁFA-ból kapott, egyszer használható kapcsolódási kód kell.

-- Cégenként legfeljebb egy összekapcsolás az eÁFA-val. A link_id-t az eÁFA adja a kód beváltásakor;
-- minden átjáró-kérés ezzel hivatkozik a cégre. Bontáskor a sor törlődik (a nyoma az audit naplóban).
CREATE TABLE nav_connections (
  company_id          uuid PRIMARY KEY REFERENCES companies (id),
  link_id             uuid NOT NULL UNIQUE,
  environment         text NOT NULL CHECK (environment IN ('TEST', 'PRODUCTION')),
  eafa_taxpayer_name  text NOT NULL,
  eafa_tax_number     text NOT NULL,
  linked_at           timestamptz NOT NULL DEFAULT now(),
  linked_by           uuid NOT NULL REFERENCES users (id),
  -- A cég NAV-kapcsolatának utolsó ismert állapota az eÁFA szerint (a Teendőkhöz).
  remote_state        text CHECK (remote_state IN ('OK', 'NOT_TESTED', 'BROKEN', 'UNREACHABLE', 'NOT_CONFIGURED', 'REVOKED')),
  remote_title        text,
  remote_action       text,
  remote_checked_at   timestamptz
);

-- Egy import: irány és időszak; a 35 napnál hosszabb időszakot a program ablakokra bontja.
CREATE TABLE nav_import_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies (id),
  direction       text NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  date_from       date NOT NULL,
  date_to         date NOT NULL CHECK (date_to >= date_from),
  status          text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'DONE', 'FAILED')),
  windows_total   integer NOT NULL,
  windows_done    integer NOT NULL DEFAULT 0,
  found_count     integer NOT NULL DEFAULT 0,
  new_count       integer NOT NULL DEFAULT 0,
  error_code      text,
  error_message   text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  started_by      uuid NOT NULL REFERENCES users (id),
  finished_at     timestamptz
);
CREATE INDEX nav_import_runs_company_idx ON nav_import_runs (company_id, started_at DESC);

-- A NAV-ból jött számlák (a kivonat adatai). Ez könyvelési javaslat, nem bizonylat: a felhasználó
-- jóváhagyásával lesz belőle bizonylat (document_id). Egy számla csak egyszer kerülhet be.
-- Összegek fillérben, előjelesen (a módosító és a sztornó számla összege negatív is lehet).
CREATE TABLE nav_invoices (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL REFERENCES companies (id),
  direction                 text NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  invoice_number            text NOT NULL,
  operation                 text NOT NULL CHECK (operation IN ('CREATE', 'MODIFY', 'STORNO')),
  modification_index        integer NOT NULL DEFAULT 0,
  original_invoice_number   text,
  invoice_category          text,
  supplier_tax_number       text NOT NULL,
  supplier_name             text,
  customer_tax_number       text,
  customer_name             text,
  issue_date                date NOT NULL,
  delivery_date             date,
  payment_date              date,
  payment_method            text,
  currency                  text,
  net_amount_huf            bigint,
  vat_amount_huf            bigint,
  completeness_indicator    boolean,
  ins_date                  timestamptz,
  raw_digest                jsonb NOT NULL,
  -- A teljes számlaadat (kérésre töltjük le): a kiolvasott adatok és a NAV XML-je base64-ben.
  invoice_data              jsonb,
  invoice_xml_base64        text,
  data_fetched_at           timestamptz,
  status                    text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'IGNORED')),
  ignored_reason            text,
  document_id               uuid REFERENCES documents (id) ON DELETE SET NULL,
  first_run_id              uuid REFERENCES nav_import_runs (id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, direction, supplier_tax_number, invoice_number, modification_index)
);
CREATE INDEX nav_invoices_company_idx ON nav_invoices (company_id, issue_date DESC);
CREATE INDEX nav_invoices_original_idx ON nav_invoices (company_id, direction, original_invoice_number);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'konyvelo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON nav_connections TO konyvelo_app;
    GRANT SELECT, INSERT, UPDATE ON nav_import_runs, nav_invoices TO konyvelo_app;
  END IF;
END
$$;
