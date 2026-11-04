-- Közös belépés (AWEBOLDAL TERV.md F21): kötelező kétlépcsős azonosítás (TOTP) a régi belépésben is,
-- belépés a portál jegyével, fiók-összekapcsolás, kilépési jelzés, tétlenségi idő.
--
-- A meglévő munkamenetek aal = 1-re állnak: a következő kérésnél a felhasználónak be kell állítania (vagy
-- meg kell adnia) a kétlépcsős kódot. Adat nem vész el; a jelszavak maradnak.

-- ---------- Kétlépcsős azonosítás ----------

ALTER TABLE users
  ADD COLUMN totp_secret     text,         -- AES-256-GCM-mel titkosítva (TOTP_KULCS); beállítás közben is itt van
  ADD COLUMN totp_enabled_at timestamptz,  -- null: még nincs bekapcsolva
  ADD COLUMN totp_last_step  bigint;       -- a legutóbb elfogadott 30 mp-es lépés (ugyanaz a kód kétszer nem jó)

CREATE TABLE user_recovery_codes (
  id        bigserial PRIMARY KEY,
  user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at   timestamptz,
  UNIQUE (user_id, code_hash)
);

-- ---------- Munkamenet: hitelesítési szint, portál-munkamenet, tétlenség ----------

ALTER TABLE sessions
  ADD COLUMN aal               smallint NOT NULL DEFAULT 1 CHECK (aal IN (1, 2)),
  ADD COLUMN portal_sid        text,     -- a portál munkamenete (kilépési jelzéskor ez alapján töröljük)
  ADD COLUMN portal_sub        text,
  ADD COLUMN portal_company_id uuid,     -- a jegyben kapott portál-cég (cég-összerendeléshez)
  ADD COLUMN idle_minutes      integer CHECK (idle_minutes BETWEEN 1 AND 720),
  ADD COLUMN max_expires_at    timestamptz; -- abszolút felső határ (12 óra)
CREATE INDEX sessions_portal_sid_idx ON sessions (portal_sid) WHERE portal_sid IS NOT NULL;

-- ---------- Közös belépés ----------

-- A portál felhasználója (sub) ↔ a Könyvelő felhasználója. Csak a régi belépéssel (jelszó + kétlépcsős kód)
-- vagy a cég összerendelése utáni automatikus létrehozással jön létre, e-mail-cím egyezése alapján soha.
CREATE TABLE sso_links (
  portal_sub text PRIMARY KEY,
  user_id    uuid NOT NULL UNIQUE REFERENCES users (id),
  linked_at  timestamptz NOT NULL DEFAULT now(),
  method     text NOT NULL CHECK (method IN ('REGI_BELEPES', 'UJ_FIOK'))
);

-- A felhasznált jegyek azonosítói (egy jegy csak egyszer használható).
CREATE TABLE sso_used_tickets (
  jti        text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);

-- Összekapcsolásra váró belépés (a jegy már felhasználva; 10 percig érvényes).
CREATE TABLE sso_pending (
  token_hash        text PRIMARY KEY,
  portal_sub        text NOT NULL,
  portal_sid        text NOT NULL,
  email             text NOT NULL,
  name              text NOT NULL,
  portal_company_id uuid NOT NULL,
  portal_role       text NOT NULL,
  module_role       text,
  idle_minutes      integer NOT NULL,
  expires_at        timestamptz NOT NULL
);

-- A Könyvelő cégének párja a portálon (egy portál-cég legfeljebb egy Könyvelő-céghez tartozhat).
ALTER TABLE companies ADD COLUMN portal_company_id uuid UNIQUE;

-- ---------- Belépési események ----------

ALTER TABLE auth_events DROP CONSTRAINT auth_events_event_check;
ALTER TABLE auth_events ADD CONSTRAINT auth_events_event_check CHECK (event IN (
  'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGIN_BLOCKED', 'LOGOUT', 'PASSWORD_CHANGED',
  'TOTP_ENABLED', 'TOTP_SUCCESS', 'TOTP_FAILURE', 'RECOVERY_CODE_USED',
  'SSO_LOGIN', 'SSO_FAILURE', 'SSO_LINKED', 'SSO_LOGOUT'
));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'konyvelo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON user_recovery_codes TO konyvelo_app;
    GRANT SELECT, INSERT ON sso_links TO konyvelo_app;
    GRANT SELECT, INSERT, DELETE ON sso_used_tickets, sso_pending TO konyvelo_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO konyvelo_app;
  END IF;
END $$;
