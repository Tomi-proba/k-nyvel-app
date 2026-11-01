-- I6 (TERV.md F18): a központnak legutóbb elküldött Teendő-lista lenyomata cégenként. A Könyvelő csak akkor
-- küldi újra a listát, ha a lenyomat változott, vagy ha az utolsó küldés óta letelt a frissítési idő.

CREATE TABLE integration_todo_mirror (
  company_id  uuid PRIMARY KEY REFERENCES companies (id),
  hash        text NOT NULL,
  sent_at     timestamptz NOT NULL
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'konyvelo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON integration_todo_mirror TO konyvelo_app;
  END IF;
END $$;
