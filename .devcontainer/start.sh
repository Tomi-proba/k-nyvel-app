#!/usr/bin/env bash
# Minden konténer-indításkor lefut (postStartCommand): megvárja az
# adatbázist, majd háttérben elindítja a Next.js dev szervert, hogy a
# Codespace port-forward automatikusan felajánlja az előnézetet.
set -uo pipefail
cd "$(dirname "$0")/.."

for i in $(seq 1 60); do
  if (echo > /dev/tcp/db/5432) >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Ha korábbi futásból maradt fenn dev szerver, ne indítsunk másikat.
if ! pgrep -f "next dev" >/dev/null 2>&1; then
  nohup npm run dev > /tmp/dev.log 2>&1 &
  disown
fi
