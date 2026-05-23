#!/bin/sh
set -e
cd /server

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

exec bun --watch --inspect=0.0.0.0:9229 run src/index.ts
