#!/usr/bin/env bash
# GitHub Codespaces: minden indításkor (szüneteltetés utáni újraindításkor is) lefut,
# és a háttérben elindítja a programot, így nem kell parancsot beírni.
# A program kimenete: /tmp/konyvelo-dev.log (megtekintés: tail -f /tmp/konyvelo-dev.log).
set -uo pipefail
cd "$(dirname "$0")/.."

# Megvárjuk az adatbázist.
for _ in $(seq 1 60); do
  (echo > /dev/tcp/127.0.0.1/5432) 2>/dev/null && break
  sleep 1
done

# Ha már fut (pl. csak újracsatlakoztunk), nem indítunk még egyet.
if ! (echo > /dev/tcp/127.0.0.1/5173) 2>/dev/null; then
  setsid nohup npm run dev > /tmp/konyvelo-dev.log 2>&1 < /dev/null &
fi
