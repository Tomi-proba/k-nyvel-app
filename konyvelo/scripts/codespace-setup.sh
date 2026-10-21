#!/usr/bin/env bash
# GitHub Codespaces: egyszeri előkészítés (a Codespace létrehozásakor fut le).
# Telepíti a csomagokat, létrehozza a .env-et, az adatbázist és a táblákat.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ Csomagok telepítése…"
npx -y npm@11 install --no-audit --no-fund

if [ ! -f .env ]; then
  # Az adatbázis-konténer hálózatán futunk, így az a localhost-on érhető el.
  cp .env.example .env
  # A böngésző a Codespace saját címén éri el a programot; ezt engedélyezzük.
  if [ -n "${CODESPACE_NAME:-}" ]; then
    sed -i "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://${CODESPACE_NAME}-5173.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}|" .env
  fi
fi

echo "▶ Várakozás az adatbázisra…"
for _ in $(seq 1 60); do
  (echo > /dev/tcp/127.0.0.1/5432) 2>/dev/null && break
  sleep 1
done

PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres npm run db:setup
npm run db:migrate
echo "✓ Kész. A program a Codespace indulásakor magától elindul (napló: /tmp/konyvelo-dev.log)."
