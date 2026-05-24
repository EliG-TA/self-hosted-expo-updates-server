# bsdiff Implementation Plan

Self-hosted Expo Updates Server — bsdiff binary-patch support for Expo SDK 55.

## Background

Expo SDK 55 added native client support for **bsdiff** binary patches of the launch JS bundle (Hermes bytecode). This dramatically reduces over-the-air update download sizes: typical incremental updates are 5-20× smaller as a patch versus a full bundle download.

Protocol (RFC 3229 Delta Encoding / Instance Manipulations):
- Client request headers (sent **only** for launch asset, when current ≠ requested):
  - `A-IM: bsdiff` — willing to accept binary patch
  - `Expo-Current-Update-ID: <uuid>` — running version (patch base)
  - `Expo-Requested-Update-ID: <uuid>` — version to upgrade to
- Server response when patch is available:
  - Status `226 IM Used`
  - `IM: bsdiff`
  - `expo-base-update-id: <uuid>` — must equal client's `Expo-Current-Update-ID`
  - Body — binary bsdiff patch
- Server fallback: HTTP 200 with full bundle (existing behavior). Client auto-handles fallback.

**Mobile-side prerequisite** (in `work-petsee-new-rn`, NOT this repo):
- iOS `Expo.plist`: `<key>EXUpdatesEnableBsdiffPatchSupport</key><true/>`
- Android `AndroidManifest.xml` meta-data: `expo.modules.updates.ENABLE_BSDIFF_PATCH_SUPPORT=true`

Without this flag, clients never send `A-IM: bsdiff` and the server feature stays dormant.

## Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Library | `@hot-updater/bsdiff` | WASM-based (no node-gyp / Python / C++ toolchain in Docker), purpose-built for RN bspatch flow, emits BSDIFF40 format, built-in Hermes bytecode validation |
| Generation timing | Lazy (on first request) | Zero overhead at publish; first client waits ~1-5s |
| Cache location | `<update.path>/_patches/from-<fromUpdateId>.patch` | Auto-cleanup when upload deleted |
| Toggle scope | Per-app (`apps.bsdiffEnabled`) | Canary-style rollout |
| Worker concurrency | 1 (sequential) | bsdiff is CPU+RAM heavy (~50MB per 10MB bundle) |
| Worker tick | 5s | Balance latency vs polling overhead |
| Failure cooldown | 4h (`nextAttemptAt`) | Avoid hammering on persistent failures |
| Obsolete retention | 7d after upload→obsolete | Free disk space without immediate destruction |
| Patch-jobs retention | 30d (TTL index) | Audit log without unbounded growth |
| Disk usage API | `fs.statfs` (Node 18.15+) | Cross-platform, no shell exec |
| Fallback on failure | 200 + full bundle + log error | Never break update flow |
| Validation | sha256 + size match + benefit check | See "Validation Strategy" |

## Data Model

### Collection: `patches`

```javascript
{
  _id: ObjectId,
  project: String,             // app._id
  platform: 'ios' | 'android',
  version: String,             // runtimeVersion
  releaseChannel: String,
  fromUpdateId: String,        // UUID (source bundle update)
  toUpdateId: String,          // UUID (target bundle update)
  fromUploadId: String,        // uploads._id (for cascade)
  toUploadId: String,
  status: 'pending' | 'generating' | 'validating' | 'ready' | 'failed' | 'not-beneficial',
  path: String,                // absolute path to patch file
  size: Number,                // patch bytes
  targetBundleSize: Number,    // for compression-ratio display
  compressionRatio: Number,    // size / targetBundleSize
  durationMs: Number,          // generation+validation time
  createdAt: Date,
  completedAt: Date,
  lastAttemptAt: Date,
  nextAttemptAt: Date,         // for 4h cooldown
  attempts: Number,
  error: String,
  servedCount: Number,         // increment per client download
  lastServedAt: Date,
  markedObsoleteAt: Date       // set when upload→obsolete; cleanup after 7d
}
```

Unique index: `{ fromUpdateId: 1, toUpdateId: 1, platform: 1 }`

### Collection: `patch-jobs`

```javascript
{
  _id: ObjectId,
  patchId: ObjectId,
  type: 'generate' | 'validate' | 'delete' | 'purge',
  status: 'queued' | 'running' | 'success' | 'failed',
  project: String,
  platform: String,
  fromUpdateId: String,
  toUpdateId: String,
  startedAt: Date,
  completedAt: Date,
  durationMs: Number,
  error: String,
  reason: String               // e.g., 'obsolete-7d', 'manual-purge'
}
```

TTL index on `startedAt` with 30d expiration.

### Collection: `apps` (extension)

Add field: `bsdiffEnabled: Boolean` (default `false`).

## Backend File Map

| File | Action | Purpose |
|------|--------|---------|
| `API/package.json` | edit | Add `@hot-updater/bsdiff` dependency |
| `API/src/modules/expo/patch.js` | **new** | bsdiff generation, application, validation |
| `API/src/modules/patches/worker.js` | **new** | Background queue worker + cleanup job |
| `API/src/modules/patches/index.js` | **new** | Worker bootstrap |
| `API/src/services/patches.js` | **new** | CRUD service + purgeAll custom action |
| `API/src/services/patch-jobs.js` | **new** | Audit log service (TTL) |
| `API/src/services/disk-usage.js` | **new** | `fs.statfs` + recursive dir sizes (10s cache) |
| `API/src/services/apps.js` | edit | Allow `bsdiffEnabled` field |
| `API/src/services/uploads.js` | edit | Hooks: before.remove cascade, after.patch obsolete-tracking |
| `API/src/services/utils.js` | edit | Add `getUpdateSizes` endpoint (bundle/assets per platform) |
| `API/src/modules/expo/manifest.js` | edit | Add `&updateId=&platform=&project=` to launch URL |
| `API/src/modules/expo/asset.js` | edit | Patch-serving branch with `226` + headers + `$inc servedCount` |
| `API/src/services/api.js` | edit | Pass `headers, app` into `handleAssetData` |
| `API/src/modules/feathers.config.js` | edit | Start worker after services init |

## Web UI File Map

| File | Action | Purpose |
|------|--------|---------|
| `Web/src/Services/QueryCache.js` | edit | Add queries: `patches`, `patchJobs`, `diskUsage`, `updateSizes` |
| `Web/src/Components/Layout/TopMenu.jsx` | edit | Disk-usage chip in header (Used/Total/Free) |
| `Web/src/Pages/App/UpdateInfo.jsx` | edit | Per-platform bundle sizes, assets, patches sum, total; Patches table |
| `Web/src/Pages/App/BsdiffManager.jsx` | **new** | Toggle, total patches size, purge all, jobs DataTable |
| `Web/src/Pages/App/index.jsx` | edit | Mount `<BsdiffManager />` above `<ConfigServer />` |

## Hot-Path Logic (Asset Endpoint)

```
GET /api/assets?asset=<absPath>&project=<id>&platform=<ios|android>&updateId=<target>
Headers: A-IM: bsdiff, Expo-Current-Update-ID: <current>, Expo-Requested-Update-ID: <target>

1. If 'A-IM: bsdiff' not present → fallback (current behavior, 200 + full file).
2. Load app by project; if !app.bsdiffEnabled → fallback.
3. Resolve uploads for current & target by updateId; validate same project/runtimeVersion/releaseChannel/platform; current ≠ target.
4. Lookup patches.findOne({fromUpdateId, toUpdateId, platform}):
   - status='ready':
     - if file exists at patch.path → serve patch (226 + IM + base header), $inc servedCount.
     - if file missing → mark status='failed', nextAttemptAt=now+4h, log warning; fallback.
   - status='not-beneficial' → fallback (never serve, never retry).
   - status='failed' AND nextAttemptAt <= now → reset to pending (worker will retry).
   - status in {pending,generating,validating} → fallback (worker working).
   - status='failed' AND nextAttemptAt > now → fallback (cooldown).
   - no record → insert {status:'pending', createdAt:now}; fallback.
5. Any error → fallback + logger.error.
```

## Worker Loop

`API/src/modules/patches/worker.js` started in `feathers.config.js`:

```
setInterval(tick, 5000)         // 5s queue tick
setInterval(cleanupTick, 3600000)  // 1h obsolete cleanup

tick():
  1. atomically claim one job: findOneAndUpdate(
       {status:'pending', nextAttemptAt:{$lte:now}},
       {$set:{status:'generating', lastAttemptAt:now}},
       {sort:{createdAt:1}})
  2. if no job → return.
  3. resolve paths, generatePatch(fromBundle, toBundle) → buffer.
  4. write to patch.path; record size, ratio.
  5. status='validating'; validate(patch) → see "Validation Strategy".
  6. status='ready', completedAt=now; log success in patch-jobs.
  7. on any error: status='failed', nextAttemptAt=now+4h, attempts++, error=msg; log failed.

cleanupTick():
  - find patches where markedObsoleteAt < now-7d
  - delete patch file + Mongo record + log type='delete' reason='obsolete-7d'
```

## Validation Strategy

`@hot-updater/bsdiff` only generates patches — it does **not** apply them server-side. That is fine because the native expo-updates client performs full sha256 verification of the patched bundle and auto-falls back to a full download on mismatch (see `FileDownloader.swift:611-624`, Android equivalent). Duplicating that on the server is wasted work.

After generating a patch the worker performs three cheap checks:

1. **Library-level success**: `hdiff()` did not throw. This already catches non-Hermes input (`INVALID_HBC`), bytecode-version mismatch, and library-internal `PATCH_FAILED`.
2. **Magic-bytes check**: patch begins with `BSDIFF40` — the format header that both `ios/EXUpdates/BSPatch/bspatch.c` and `android/.../BSPatch.cpp` expect. Catches truncated / corrupted writes.
3. **Benefit check**: `patch.length < 0.75 * target.length` — otherwise the patch is not worth serving (CPU on device + battery for negligible network savings). This is a **permanent terminal state** `not-beneficial` (distinct from `failed`): bundles won't change, regenerating gives the same result. Worker never retries; asset endpoint never serves.

Final sha256 correctness verification is delegated to the client (built into expo-updates SDK 55). All three server checks run in the worker (off the request path).

## Cascade Behavior

- `uploads.before.remove(id)` → find patches where `fromUploadId==id || toUploadId==id` → delete files + Mongo records + log.
- `uploads.after.patch` with `status: 'obsolete'` → set `markedObsoleteAt=now` on patches where `toUploadId==id || fromUploadId==id`.
- `uploads.after.patch` from `obsolete` back to other status → unset `markedObsoleteAt` (resurrect).

## Metrics & UI

**Disk usage** (`/disk-usage`):
- `updatesBytes` — sum of all `update.path` directories
- `patchesBytes` — sum of all `<update.path>/_patches/` directories  
- `totalBytes`, `freeBytes`, `usedBytes` — from `fs.statfs` of `/updates`
- 10-second in-memory cache (full FS walk is expensive)
- Configurable via env: `UPDATES_ROOT` (where to walk for `updatesBytes`/`patchesBytes`, default `/updates`), `DISK_STAT_PATH` (where to call `statfs`, default = `UPDATES_ROOT`)
- **macOS Docker Desktop dev caveat:** bind-mounted paths go through virtio-fs which returns synthetic `bsize=1MB` and bogus `blocks` (~254 TB). Set `DISK_STAT_PATH=/` in dev compose to point `statfs` at the VM overlay root. On Linux production this is unnecessary.

**Update sizes** (`/utils/getUpdateSizes?uploadId=<id>`):
- `bundleByPlatform: { ios: N, android: M }` — from metadata.json
- `assetsByPlatform: { ios: N, android: M }` — sum of asset file sizes
- `patchesTotal: N` — sum of related patches
- `zipSize: N` — `upload.size`
- `total: N` — sum of everything

**Top-menu chip**: "Updates: 12.3 GB · Patches: 240 MB · Used: 18.4 / 200 GB · Free: 181.6 GB"

**Per-update Patches table** (in UpdateInfo card):
- Columns: From (gitCommit), Date, Status, Size, Served, [Delete]
- Filtered by `toUploadId == update._id`

**BsdiffManager** (above ConfigServer):
- Toggle `bsdiffEnabled` (patches `apps`)
- Total patches size for this app
- Total served count
- "Purge all patches" — confirms, POST `/patches/purgeAll` { project }
- Chronological DataTable of `patch-jobs` (real-time via `messages` websocket)

## Out of Scope

- Multi-node deployments (would need Redis-backed queue instead of in-process)
- Pre-warming patches at release time (current plan is lazy-only)
- Patches for non-launch assets (not supported by Expo client)
- Compression of patches (bsdiff output is already heavily entropy-coded)

## Mobile App Enablement (work-petsee-new-rn)

Once the server is deployed and per-app `bsdiffEnabled` is turned ON, clients still won't request patches until the native flag is set:

**iOS** — `ios/<AppName>/Supporting/Expo.plist`:
```xml
<key>EXUpdatesEnableBsdiffPatchSupport</key>
<true/>
```

**Android** — `android/app/src/main/AndroidManifest.xml` inside `<application>`:
```xml
<meta-data
  android:name="expo.modules.updates.ENABLE_BSDIFF_PATCH_SUPPORT"
  android:value="true" />
```

Or, equivalently, via a config plugin in `app.json`. The flag must be present in a **native build** — OTA updates cannot enable it retroactively.

## Implementation Order

1. Dependency + `patch.js` (generation/application/validation primitives)
2. Mongo services scaffold (`patches`, `patch-jobs`) + app field
3. Worker (queue tick + cleanup tick)
4. Asset endpoint + manifest URL update + cascade hooks
5. `disk-usage` + `utils.getUpdateSizes`
6. Web UI: TopMenu chip
7. Web UI: UpdateInfo extension
8. Web UI: BsdiffManager component
9. Documentation note on mobile-side flag enablement
