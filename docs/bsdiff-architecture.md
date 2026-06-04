# bsdiff Architecture

Internal design of the bsdiff binary-patch feature, for contributors. For what it does and how to operate it, see [bsdiff Binary Patches](./bsdiff-binary-patches.md).

## Design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Patch library | Vendored fork of `@hot-updater/bsdiff` (`API/vendor/bsdiff`) | Upstream emits ENDSLEY/BSDIFF43, which expo-updates' on-device `bspatch.c` cannot apply. The fork changes only the Rust container to emit classic **BSDIFF40** (8-byte magic + 32-byte header + 3 separate bzip2 streams) — what the client requires. It stays pure-Rust WASM (no `node-gyp` / Python / C++ toolchain) and keeps the built-in Hermes validation. See `API/vendor/bsdiff/README.md`. |
| Fork packaging | Build `dist/` in Docker, install as a `.tgz` | `dist/` isn't committed (only TS `src/` + the prebuilt `assets/hdiff.wasm`). The prod image packs a tarball in a build stage; the runtime stage installs it via `file:./vendor/bsdiff/bsdiff.tgz`. Deterministic tsdown output means the tarball hash matches the lockfile, so `--frozen-lockfile` holds across macOS/linux. |
| Generation timing | Lazy | Zero publish-time overhead; only the first client on an upgrade path waits. |
| Off-thread generation | `node:worker_threads` | The bsdiff diff is a synchronous WASM call; on the main thread it would block HTTP/websockets. Running it in a worker thread lets `concurrency` truly parallelise. |
| Cache location | `<update.path>/_patches/from-<fromUpdateId>.patch` | Co-located with the target, so it's auto-cleaned when the upload is deleted. |
| Server validation | magic-bytes + benefit check (no sha256) | The native client already does full sha256 verification + auto-fallback; re-applying server-side is wasted work. |
| Patch-jobs retention | 30d (TTL index) | Audit log without unbounded growth. |
| Fallback on failure | 200 + full bundle + log | Never break the update flow. |

## Data model

The from→to transition is a first-class entity, so three collections cooperate.

### `patch-pairs`

Identity of a logical from→to transition. Stores identity only — per-pair status, sizes and served counts are rolled up on the fly from the related `patches`, so there is no denormalised state to keep in sync.

```javascript
{
  _id, project,                // app._id
  version, releaseChannel,
  fromUpdateId, toUpdateId,    // UUIDs
  fromUploadId, toUploadId,    // ObjectId → uploads (for cascade)
  createdAt, updatedAt
}
```

Unique index `{ fromUpdateId, toUpdateId }`. The pair is created/linked in a `patches` `before.create` hook, so both the lazy asset insert and manual enqueue create pairs transparently.

### `patches`

One row per `{ fromUpdateId, toUpdateId, platform }` — the concrete patch for one platform.

```javascript
{
  _id, pairId,                 // → patch-pairs
  project, platform,           // 'ios' | 'android'
  version, releaseChannel,
  fromUpdateId, toUpdateId,    // denormalised for the asset hot-path lookup
  fromUploadId, toUploadId,    // ObjectId, for cascade
  status,                      // pending | generating | ready | failed | not-beneficial
  source,                      // 'auto' | 'manual'
  path, size, targetBundleSize, compressionRatio, durationMs,
  createdAt, completedAt, lastAttemptAt, nextAttemptAt, attempts, error,
  servedCount, lastServedAt
}
```

Unique index `{ fromUpdateId, toUpdateId, platform }` — one row per triple, so both the atomic queue claim and the asset lookup are single-document operations.

### `patch-jobs`

Append-only event log of `patches` state changes, populated by Feathers hooks on the `patches` service (not ad-hoc log calls), so coverage is exhaustive: anything that mutates a patch produces exactly one entry.

```javascript
{
  _id, patchId, pairId, project, platform,
  fromUpdateId, toUpdateId,
  event,                       // created | status-changed | removed
  status, previousStatus, attempts, durationMs, size, error,
  reason,                      // removed: manual-purge | cleanup-obsolete | upload-removed | manual
  at
}
```

TTL index on `at` (30d). External clients may only `find`/`get`/`remove`; `create`/`patch`/`update` are internal-only.

### `apps` / `bsdiff-settings`

`apps` gains `bsdiffEnabled: Boolean` (default `false`). `bsdiff-settings` is a single global document (`_id: 'global'`) holding the live [worker settings](#worker).

## Asset endpoint (hot path)

```
GET /api/assets?asset=<absPath>&project=<id>&platform=<ios|android>&updateId=<target>
Headers: A-IM: bsdiff, Expo-Current-Update-ID: <current>, Expo-Requested-Update-ID: <target>
```

1. No `A-IM: bsdiff` → fallback (200 + full file).
2. Load app by `project`; `!app.bsdiffEnabled` → fallback.
3. Resolve uploads for current & target by `updateId`; require same project / version / channel / platform and current ≠ target.
4. `patches.findOne({ fromUpdateId, toUpdateId, platform })`:
   - `ready` + file present → serve (`226` + headers), `$inc servedCount`. File missing → mark `failed` + cooldown, fallback.
   - `not-beneficial` → fallback (never serve, never retry).
   - `failed` past cooldown → reset to `pending`, fallback.
   - `pending` / `generating` → fallback (worker working).
   - `failed` within cooldown → fallback.
   - no record → insert `{ status: 'pending' }`, fallback.
5. Any error → fallback + `logger.error`.

The manifest's launch-asset URL carries `&project=&updateId=&platform=` so the endpoint can resolve everything.

## Worker

A single in-process worker starts after services initialise (`feathers.config.ts`). It is a self-rescheduling loop (not a fixed `setInterval`) that re-reads settings each cycle:

1. Resolve enabled projects (`apps.bsdiffEnabled = true`); empty set → no claims.
2. Top the active pool up to `concurrency`; for each slot, atomically claim one job:
   `findOneAndUpdate({ status: 'pending', nextAttemptAt: { $lte: now }, project: { $in: enabled } }, { $set: { status: 'generating', lastAttemptAt: now } }, { sort: { createdAt: 1 } })`.
3. Run the pipeline in a worker thread: integrity check → `generatePatch` → validate.
4. Write the terminal status: `ready` (+ `completedAt`/`durationMs`/`size`/`ratio`), `not-beneficial` (persists size/ratio so a ratio change can re-judge it), or `failed` (+ `nextAttemptAt = now + cooldown`, `attempts++`).

**Claim safety.** The `pending → generating` flip is atomic, so it's race-safe across the pool and across processes (MongoDB enforces it). A stale-reclaim branch re-queues jobs stuck in `generating` past `staleInProgressMs`; a heartbeat (`lastAttemptAt` bumped while running) keeps a live job from being reclaimed, and `generatePatch` writes to a unique temp file then atomically renames, so concurrent generators can never leave a half-written file.

### Settings

One global document, editable live from the UI; reads are clamped server-side and never throw (fall back to defaults before the model is ready):

| Setting | Default | Clamp | Purpose |
|---------|---------|-------|---------|
| `tickIntervalMs` | `5000` | `[500, 600000]` | Poll cadence |
| `cooldownMs` | `4h` | `[0, 7d]` | Wait before retrying a failed patch |
| `staleInProgressMs` | `5min` | `[30s, 24h]` | Reclaim a job stuck in `generating` this long |
| `concurrency` | `1` | `[1, 8]` | Patches generated in parallel |
| `patchBenefitRatio` | `0.75` | `[0.05, 1]` | A patch is kept only if `size < ratio × target` |

The first four apply on the next cycle. Changing `patchBenefitRatio` re-judges existing patches (`reconcileBenefitRatio`): a `ready` patch whose ratio is now too high becomes `not-beneficial` (file deleted); a `not-beneficial` patch that now qualifies returns to `pending`.

## Validation

The fork only *generates* patches; it does not apply them server-side, and that's fine because the client does full sha256 verification + auto-fallback. The worker runs three cheap checks off the request path:

1. **Library success** — `hdiff()` didn't throw (catches non-Hermes input, bytecode-version mismatch, internal failures).
2. **Magic bytes** — the patch starts with `BSDIFF40`, the format the on-device `bspatch.c` requires (verified end-to-end against the actual compiled expo-updates `bspatch.c`).
3. **Benefit** — `size < patchBenefitRatio × target`, else the permanent `not-beneficial` state (regenerating gives the same result, so it's never retried or served).

The worker also refuses to build a patch when either bundle fails an **integrity check** (missing/unreadable files, unparseable metadata, missing launch bundle) — the same check the release guard and asset endpoint use, scoped per platform so an iOS problem never blocks Android.

## Metrics & disk usage

`/disk-usage` returns:
- `updatesBytes` — sum of all `update.path` directories
- `patchesBytes` — sum of all `<update.path>/_patches/` directories
- `totalBytes` / `freeBytes` / `usedBytes` — from `fs.statfs`
- 10-second in-memory cache (a full FS walk is expensive)

Env: `UPDATES_ROOT` (directory walked for the totals, default `/updates`) and `DISK_STAT_PATH` (path passed to `statfs`, default = `UPDATES_ROOT`). On macOS Docker Desktop dev, bind mounts report nonsense through virtio-fs, so the dev compose sets `DISK_STAT_PATH=/`; on Linux production this is unnecessary.

`/utils/getUpdateSizes?uploadId=<id>` returns per-platform JS bundle bytes, total unique asset bytes (each shared file counted once, with shared/per-platform counts), related patch bytes, on-disk zip size, and a grand total. A single `assetsBytes` (rather than a per-platform split) is reported because Expo shares assets across platforms — splitting bytes would double-count or require an arbitrary allocation; the breakdown lives in the *count* fields.

## Code map

### Backend (`API/`)

| Path | Purpose |
|------|---------|
| `vendor/bsdiff/**` | Vendored BSDIFF40 fork (TS `src/`, Rust, prebuilt wasm, build config) |
| `src/modules/expo/patch.ts` | Generation/application primitives + patch-file helpers |
| `src/modules/patches/worker.ts` | Queue loop, atomic claim, stale-reclaim, heartbeat |
| `src/modules/patches/pool.ts` | Worker-thread pool (one thread per job) |
| `src/modules/patches/generate.worker.ts` | Off-thread integrity → generate → validate pipeline |
| `src/services/patches.ts` | CRUD + `enqueuePatch` / `getPatchSources` / cleanup / `reconcileBenefitRatio` / `page`; pair + audit hooks |
| `src/services/patch-pairs.ts` | from→to identity + `page` rollup aggregation |
| `src/services/patch-jobs.ts` | Append-only audit log (TTL 30d) |
| `src/services/bsdiff-settings.ts` | Live worker settings singleton (read/clamp/seed) |
| `src/services/disk-usage.ts` | `fs.statfs` + recursive dir sizes (10s cache) |
| `src/services/apps.ts` | `bsdiffEnabled` field |
| `src/services/uploads.ts` | `before.remove` cascade |
| `src/services/utils.ts` | `getUpdateSizes` endpoint |
| `src/modules/expo/manifest.ts` | Adds `&project=&updateId=&platform=` to the launch URL |
| `src/modules/expo/asset.ts` | Patch-serving branch (`226` + headers + `$inc servedCount`) |
| `src/modules/expo/integrity.ts` | Bundle integrity checks (release guard, worker, asset) |
| `src/modules/feathers.config.ts` | Starts the worker after services init |

### Web (`Web/`)

| Path | Purpose |
|------|---------|
| `src/Services/QueryCache.ts` | Queries: patches, patch-pairs, patch-jobs, disk usage, update sizes |
| `src/Services/useLazyTable.ts` | Lazy (server-paginated/sorted/filtered) DataTable hook |
| `src/Components/Layout/TopMenu.tsx` | Disk-usage chip |
| `src/Pages/App/UpdateInfo.tsx` | Per-platform sizes + patches tables |
| `src/Pages/App/PatchesPanel.tsx` | Grouped patches table + pair-detail dialog |
| `src/Pages/App/BsdiffManager.tsx` | Toggle, worker settings, cleanup actions |
