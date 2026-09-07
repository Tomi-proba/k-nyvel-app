#!/usr/bin/env bash
# Egyszeri beállítás a Codespace/devcontainer létrehozásakor: függőségek,
# .env, adatbázis migráció és seed adatok. Ez után a start.sh minden
# konténer-indításkor elindítja a dev szervert.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> npm install"
npm install

echo "==> .env létrehozása"
cat > .env <<EOF
DATABASE_URL="postgresql://postgres:postgres@db:5432/knyvel?schema=public"
AUTH_SECRET="$(openssl rand -base64 32)"
NEXTAUTH_URL="http://localhost:3000"
STORAGE_DRIVER="local"
LOCAL_STORAGE_DIR="./storage"
S3_ENDPOINT=""
S3_REGION="auto"
S3_BUCKET=""
S3_ACCESS_KEY_ID=""
S3_SECRET_ACCESS_KEY=""
S3_PUBLIC_BASE_URL=""
OCR_PROVIDER="mock"
EOF

echo "==> Várakozás a PostgreSQL-re (db:5432)"
for i in $(seq 1 60); do
  if (echo > /dev/tcp/db/5432) >/dev/null 2>&1; then
    echo "PostgreSQL elérhető."
    break
  fi
  sleep 1
done

echo "==> Prisma migráció"
npx prisma migrate deploy

echo "==> Seed adatok"
npm run db:seed

echo "==> Kész. A start.sh indítja a dev szervert."
