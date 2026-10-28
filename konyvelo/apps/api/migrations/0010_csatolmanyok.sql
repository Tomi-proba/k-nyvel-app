-- K9: csatolmányok a bizonylatokhoz (beszkennelt számla PDF-je vagy képe).
--
-- A fájl a fájltárolóban van (helyi mappa vagy S3, beállításból); itt a leírása és a SHA-256 lenyomata.
-- Könyvelt bizonylat csatolmánya nem törölhető és nem módosítható (Szt. 169. §), csak újabb tölthető fel.
--
-- Sértetlenség:
-- - a könyvelés előtt feltöltött csatolmányok lenyomata a bizonylat tartalmi hash-ébe számít
--   (in_document_hash = true);
-- - minden könyvelt bizonylathoz tartozó csatolmány bekerül a cégenkénti csatolmány-láncba
--   (chain_seq, prev_hash, chain_hash), a bizonylat tartalmi hash-ével együtt. Így egy fájl utólagos
--   cseréje, törlése vagy egy csatolmány eltüntetése kimutatható.

CREATE TABLE attachments (
  id                uuid PRIMARY KEY,
  company_id        uuid NOT NULL REFERENCES companies (id),
  document_id       uuid NOT NULL REFERENCES documents (id),
  file_name         text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  mime_type         text NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes        integer NOT NULL CHECK (size_bytes > 0),
  sha256            char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key       text NOT NULL UNIQUE,
  uploaded_at       timestamptz NOT NULL,
  uploaded_by       uuid NOT NULL REFERENCES users (id),
  in_document_hash  boolean NOT NULL DEFAULT false,
  chain_seq         bigint,
  prev_hash         text,
  chain_hash        text,
  UNIQUE (company_id, chain_seq),
  CHECK ((chain_seq IS NULL) = (chain_hash IS NULL))
);
CREATE INDEX attachments_document_idx ON attachments (document_id, uploaded_at);

-- Könyvelt bizonylat csatolmánya nem módosítható és nem törölhető; a lánc egyszer kitöltött mezői sem.
CREATE FUNCTION attachments_protect() RETURNS trigger AS $$
DECLARE
  posted boolean;
BEGIN
  SELECT status = 'POSTED' INTO posted FROM documents WHERE id = OLD.document_id;
  IF TG_OP = 'DELETE' THEN
    IF posted THEN
      RAISE EXCEPTION 'Könyvelt bizonylat csatolmánya nem törölhető (Szt. 169. §). Újabb csatolmány feltölthető mellé.';
    END IF;
    RETURN OLD;
  END IF;
  -- A láncba vett csatolmány semmilyen mezője nem változhat.
  IF OLD.chain_hash IS NOT NULL THEN
    RAISE EXCEPTION 'Könyvelt bizonylat csatolmánya nem módosítható.';
  END IF;
  IF NEW.id <> OLD.id OR NEW.company_id <> OLD.company_id OR NEW.document_id <> OLD.document_id OR NEW.sha256 <> OLD.sha256
     OR NEW.size_bytes <> OLD.size_bytes OR NEW.storage_key <> OLD.storage_key OR NEW.file_name <> OLD.file_name OR NEW.mime_type <> OLD.mime_type
     OR NEW.uploaded_at <> OLD.uploaded_at OR NEW.uploaded_by <> OLD.uploaded_by THEN
    RAISE EXCEPTION 'A csatolmány adatai nem módosíthatók; töltse fel újra.';
  END IF;
  -- Könyvelt bizonylatnál csak a láncba vétel (a lánc mezőinek első kitöltése) megengedett.
  IF posted AND NEW.in_document_hash <> OLD.in_document_hash THEN
    RAISE EXCEPTION 'Könyvelt bizonylat csatolmánya nem módosítható.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attachments_protect BEFORE UPDATE OR DELETE ON attachments
  FOR EACH ROW EXECUTE FUNCTION attachments_protect();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'konyvelo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON attachments TO konyvelo_app;
  END IF;
END
$$;
