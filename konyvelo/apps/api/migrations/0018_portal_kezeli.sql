-- Felhasználókezelés egy helyen (AWEBOLDAL TERV.md F25): a portálról érkezett tagok szerepét a portál adja.
-- A közös belépés és a portál tagság-jelzése ezt igazítja; a Könyvelő Tagok oldalán az ilyen tag szerepe nem
-- változtatható és nem távolítható el (a portálon kell). Önálló futásnál (közös belépés nélkül) minden a régi.
ALTER TABLE company_memberships ADD COLUMN portal_kezeli boolean NOT NULL DEFAULT false;

ALTER TABLE auth_events DROP CONSTRAINT auth_events_event_check;
ALTER TABLE auth_events ADD CONSTRAINT auth_events_event_check CHECK (event IN (
  'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGIN_BLOCKED', 'LOGOUT', 'PASSWORD_CHANGED',
  'TOTP_ENABLED', 'TOTP_SUCCESS', 'TOTP_FAILURE', 'RECOVERY_CODE_USED',
  'SSO_LOGIN', 'SSO_FAILURE', 'SSO_LINKED', 'SSO_LOGOUT', 'SSO_ROLE_SYNC', 'SSO_ACCESS_REVOKED'
));
