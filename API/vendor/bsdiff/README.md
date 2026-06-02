# @hot-updater/bsdiff — vendored fork (BSDIFF40)

Source fork of [`@hot-updater/bsdiff`](https://github.com/gronxb/hot-updater/tree/main/packages/bsdiff)
v0.32.0, modified to emit **classic Colin Percival BSDIFF40** patches instead
of the upstream **ENDSLEY/BSDIFF43** format.

## Why

`expo-updates` (SDK 55) applies launch-bundle binary patches on-device with a
classic `bspatch.c` (byte-identical on iOS and Android) that hard-requires the
`BSDIFF40` magic + 32-byte header + **three separate bzip2 streams**:

```
node_modules/expo-updates/ios/EXUpdates/BSPatch/bspatch.c
  line 289:  if (memcmp(header_bytes, "BSDIFF40", 8) != 0) goto done;
```

Upstream emits `ENDSLEY/BSDIFF43` (16-byte magic + single bzip2 stream), which
the client cannot apply — it falls back to a full download, so the feature
yields zero savings. This fork makes the server emit patches the client uses.

## What changed vs upstream

Only the Rust patch container (`rust/hdiff-wasm/src/lib.rs`):

- The pure-Rust `bsdiff` crate still does the suffix-array diff (its output is
  an interleaved control/diff/extra stream).
- `generate_bsdiff40_patch()` demuxes that into the three logical sections,
  bzip2-compresses each independently, and assembles the BSDIFF40 container.
- `apply_bsdiff40_patch()` reverses it.
- `src/internal/bsdiff.ts`: two error-message strings ENDSLEY → BSDIFF40.
- `package.json`: `build` script no longer shells out to `pnpm`; devDeps and
  pnpm `catalog:` refs trimmed to the concrete versions needed to run `tsdown`.

No C dependencies: `bsdiff` is pure Rust, `bzip2 0.6` uses `libbz2-rs-sys`, so
the crate compiles to `wasm32-unknown-unknown` with no C toolchain.

## Build model (no `dist` in the repo)

`dist/` is **not** committed (see `.gitignore`). It is produced at image-build
time and the package is consumed as a tarball:

```bash
bun install          # dev deps (tsdown, typescript)
bun run build        # tsdown -> dist/ (uses the committed assets/hdiff.wasm)
bun pm pack          # -> @hot-updater-bsdiff-<ver>.tgz
```

- The prod `API/Dockerfile` does this in a dedicated build stage and installs
  the resulting `.tgz` (`API/package.json` → `file:./vendor/bsdiff.tgz`).
- The dev `API/docker-entrypoint.sh` builds+packs the tarball before
  `bun install` when it is missing or the sources changed.

`assets/hdiff.wasm` **is** committed (the wasm rarely changes — only when the
Rust changes — and rebuilding it needs a Rust toolchain). To rebuild it:

```bash
node scripts/wasm-build/build-wasm.mjs   # needs rustup + cargo
```

## Verified

A forked patch was applied by the **actual** expo-updates `bspatch.c` (compiled
from `node_modules/expo-updates`); the reconstructed bundle was sha256-identical
to the target.
