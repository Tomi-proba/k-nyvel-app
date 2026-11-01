-- I6b (TERV.md F19, KK10): a központnak legutóbb elküldött nyitott-tétel lista lenyomata cégenként. A Könyvelő
-- csak akkor küldi újra, ha a lenyomat változott, vagy ha az utolsó küldés óta letelt a frissítési idő.

CREATE TABLE integration_open_items_mirror (
  company_id  uuid PRIMARY KEY REFERENCES companies (id),
  hash        text NOT NULL,
  sent_at     timestamptz NOT NULL
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'konyvelo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON integration_open_items_mirror TO konyvelo_app;
  END IF;
END $$;
