#!/bin/sh
set -e

cd /app/deploy
./loadEnv.sh dockerEnv
mv env-config.js /app/public/

cd /app
NEEDS_INSTALL=0
if [ ! -d node_modules ] || [ ! -f node_modules/.bun-install-marker ]; then
  NEEDS_INSTALL=1
elif [ package.json -nt node_modules/.bun-install-marker ]; then
  NEEDS_INSTALL=1
fi

if [ "$NEEDS_INSTALL" = "1" ]; then
  echo "[entrypoint] running bun install..."
  if [ -f bun.lock ] || [ -f bun.lockb ]; then
    bun install --frozen-lockfile
  else
    bun install
  fi
  touch node_modules/.bun-install-marker
fi

exec bunx vite --port 4000 --host
