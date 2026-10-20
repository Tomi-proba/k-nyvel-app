#!/usr/bin/env bash
# Helyi fejlesztői adatbázis létrehozása (egyszer kell lefuttatni).
#
# Két adatbázis-felhasználót hoz létre:
#   konyvelo_owner – a séma tulajdonosa, csak a migrációkat futtatja
#   konyvelo_app   – az alkalmazás ezzel fut; az audit naplót csak bővíteni tudja
# és két adatbázist: konyvelo (fejlesztés) és konyvelo_test (automata tesztek).
#
# Használat (PostgreSQL superuserként, pl.):  sudo -u postgres bash scripts/db-setup.sh
# A jelszavak a fejlesztői alapértelmezések; éles környezetben erős jelszót adjon meg:
#   OWNER_PASSWORD=... APP_PASSWORD=... bash scripts/db-setup.sh
set -euo pipefail

OWNER_PASSWORD="${OWNER_PASSWORD:-konyvelo_owner}"
APP_PASSWORD="${APP_PASSWORD:-konyvelo_app}"

psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'konyvelo_owner') THEN
    CREATE ROLE konyvelo_owner LOGIN PASSWORD '${OWNER_PASSWORD}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'konyvelo_app') THEN
    CREATE ROLE konyvelo_app LOGIN PASSWORD '${APP_PASSWORD}';
  END IF;
END
\$\$;
SQL

for db in konyvelo konyvelo_test; do
  if ! psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${db}'" | grep -q 1; then
    psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${db} OWNER konyvelo_owner ENCODING 'UTF8' TEMPLATE template0"
  fi
  psql -v ON_ERROR_STOP=1 -d "${db}" -c "REVOKE ALL ON SCHEMA public FROM PUBLIC; ALTER SCHEMA public OWNER TO konyvelo_owner; GRANT USAGE ON SCHEMA public TO konyvelo_app;"
done

echo "Kész. Következő lépés: npm run db:migrate"
