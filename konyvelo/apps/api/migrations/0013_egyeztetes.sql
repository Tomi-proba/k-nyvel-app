-- I4 (TERV.md F16): egyeztető ellenőrzések.
--
-- - expected_amount: a Készletből jött piszkozat tartozik oldalának összege létrehozáskor (a Készlet
--   adataiból). A könyvelt összeggel összevetve látszik, ha a jóváhagyó módosította (E3). A már
--   könyvelt régi tételeknél nem ismert (NULL): ezeket az egyeztetés nem veti össze, de kimutatja.
-- - integration_reconciliations: a központtól kapott legutóbbi egyeztetési eredmény cégenként.

ALTER TABLE integration_records ADD COLUMN expected_amount bigint;

UPDATE integration_records r
   SET expected_amount = (SELECT coalesce(sum(l.amount), 0) FROM journal_lines l WHERE l.document_id = r.document_id AND l.side = 'D')
 WHERE r.kind IN ('PURCHASE', 'COGS', 'RETURN', 'INVENTORY', 'CASH')
   AND r.document_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM documents d WHERE d.id = r.document_id AND d.status = 'DRAFT');

CREATE TABLE integration_reconciliations (
  company_id   uuid PRIMARY KEY REFERENCES companies (id),
  run_id       uuid NOT NULL,
  at           timestamptz NOT NULL,
  as_of        date NOT NULL,
  period_from  date NOT NULL,
  period_to    date NOT NULL,
  results      jsonb NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'konyvelo_app') THEN
    GRANT SELECT, INSERT, UPDATE ON integration_reconciliations TO konyvelo_app;
  END IF;
END
$$;
