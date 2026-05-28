#!/bin/sh
set -e
cd /server

NEEDS_INSTALL=0
if [ ! -d node_modules ] || [ ! -f node_modules/.bun-install-marker ]; then
  NEEDS_INSTALL=1
elif [ package.json -nt node_modules/.bun-install-marker ]; then
  NEEDS_INSTALL=1
fi

# Build the vendored @hot-updater/bsdiff fork tarball (its dist/ is not committed,
# see vendor/bsdiff/.gitignore). The wasm is committed, so build-wasm.mjs falls
# back to it — no Rust needed. (Re)pack when the tarball is missing or any source
# is newer than it; that also forces a reinstall of the file: dependency.
BSDIFF_DIR=vendor/bsdiff
BSDIFF_TGZ="$BSDIFF_DIR/bsdiff.tgz"
NEED_PACK=0
if [ ! -f "$BSDIFF_TGZ" ]; then
  NEED_PACK=1
elif [ -n "$(find "$BSDIFF_DIR/src" "$BSDIFF_DIR/rust" "$BSDIFF_DIR/assets" "$BSDIFF_DIR/package.json" "$BSDIFF_DIR/tsdown.config.ts" -newer "$BSDIFF_TGZ" 2>/dev/null || true)" ]; then
  NEED_PACK=1
fi
if [ "$NEED_PACK" = "1" ]; then
  echo "[entrypoint] building @hot-updater/bsdiff fork tarball..."
  ( cd "$BSDIFF_DIR" && bun install && bun run build && bun pm pack --filename bsdiff.tgz )
  NEEDS_INSTALL=1
fi

if [ "$NEEDS_INSTALL" = "1" ]; then
  echo "[entrypoint] running bun install..."
  if [ -f bun.lock ] || [ -f bun.lockb ]; then
    # Fall back to a non-frozen install when the fork tarball was changed
    # locally (its hash drifts from the committed lockfile).
    bun install --frozen-lockfile || bun install
  else
    bun install
  fi
  touch node_modules/.bun-install-marker
fi

exec bun --watch --inspect=0.0.0.0:9229 run src/index.ts
