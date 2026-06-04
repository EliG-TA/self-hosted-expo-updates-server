# bsdiff Binary Patches

Reference for the bsdiff binary-patch support in the Self-Hosted Expo Updates Server. For a quick setup walkthrough see *Advanced Features → bsdiff binary patches* in the main [README](../README.md); for the data model, worker mechanics and code map see [bsdiff Architecture](./bsdiff-architecture.md).

## Overview

Expo SDK 55 added native client support for **bsdiff binary patches** of the launch JS bundle (Hermes bytecode). Instead of downloading a whole new bundle, the client downloads a small binary patch against the bundle it is already running — typically 5-20× smaller, so updates are faster and use far less bandwidth.

The server generates patches lazily, caches them on disk, serves them over the standard asset endpoint, and falls back to a full bundle whenever a patch isn't available or applicable — so the feature can never break an update.

## Protocol

The mechanism follows RFC 3229 *Delta Encoding / Instance Manipulations*. The client sends these headers automatically, only for the launch asset, when its current bundle differs from the requested one:

| Header | Meaning |
|--------|---------|
| `A-IM: bsdiff` | The client accepts a binary patch |
| `Expo-Current-Update-ID: <uuid>` | Bundle currently running (the patch base) |
| `Expo-Requested-Update-ID: <uuid>` | Bundle being upgraded to |

When a patch is available the server responds `226 IM Used` with `IM: bsdiff`, `expo-base-update-id: <uuid>` (equal to the client's current update) and the binary patch as the body. Otherwise it responds with a plain `200` and the full bundle. The client verifies the reconstructed bundle by sha256 and auto-falls back to a full download on any mismatch.

## Enabling the feature

Two independent switches must both be on.

**1. Server, per app** — the `bsdiffEnabled` flag on the app (toggled from the dashboard). Controls whether the server generates and serves patches for that app; use it as a canary rollout knob. Turning it off stops new generation immediately.

**2. Client, per build** — the Expo config property `updates.enableBsdiffPatchSupport`, which **defaults to `true`** on SDK 55+. A standard build already requests patches; you only need to set it if it was previously disabled:

```json
{ "expo": { "updates": { "enableBsdiffPatchSupport": true } } }
```

This is a build-time setting baked into the native project by `expo prebuild` / EAS Build — it cannot be toggled via OTA. The native equivalents (for bare/ejected projects) are `EXUpdatesEnableBsdiffPatchSupport=true` in iOS `Expo.plist` and the `expo.modules.updates.ENABLE_BSDIFF_PATCH_SUPPORT=true` meta-data in Android `AndroidManifest.xml`. Without it the client never sends `A-IM: bsdiff` and the feature stays dormant.

## How patches are produced

- **Lazy.** A patch is created the first time a client requests an upgrade path. That client gets a full-bundle fallback; once the patch is ready (~1-5s) every subsequent client gets it instantly.
- **Off-thread.** A background worker generates patches in a worker thread, so the CPU/RAM-heavy diff never blocks request handling. Generation cadence, concurrency, retry cooldown and the benefit threshold are configurable live from the UI.
- **Validated cheaply.** The server only checks that generation succeeded, the patch carries the `BSDIFF40` magic header, and it is meaningfully smaller than the full bundle. Full sha256 correctness is delegated to the client. A patch that isn't smaller than `patchBenefitRatio × bundle` is marked `not-beneficial` and never served or retried.

See [bsdiff Architecture](./bsdiff-architecture.md) for the queue, claim safety and validation details.

## Manual patch generation

Admins can pre-generate a patch instead of waiting for a client — useful to pre-warm a popular upgrade path or to retry a failed patch without waiting out the cooldown.

- **Pick a base.** The UI lists eligible base updates (same project, runtime version and release channel as the target, each sharing at least one platform bundle).
- **Enqueue.** The chosen pair is queued per shared platform; the worker picks it up like any other job.

Manual enqueue is **not** gated on `bsdiffEnabled`, so you can pre-warm patches before flipping the toggle — they still won't be served until it's on.

## Maintenance & cleanup

- **Automatic cascade.** Deleting an upload removes every patch that references it (file + record) and prunes the now-empty from→to pair.
- **Obsolete cleanup** (two-phase, admin-driven). A read-only preview lists patches whose **target** update is now obsolete (optionally older than a chosen window) and the disk space they occupy; confirming re-runs the predicate server-side and removes them. A patch *from* an obsolete bundle *to* a live one is kept — it still helps clients stuck on the old bundle.
- **Purge all** removes every patch for an app.

## Metrics & dashboard

- **Disk usage chip** (header) — shows a `Patches` total alongside updates/used/free. The chip is part of the general disk-usage feature (documented in the README), not bsdiff itself; it just happens to surface patch bytes too.
- **Patches table** — patches grouped by from→to pair, with per-platform status, size, compression ratio and served count; a detail dialog shows both platforms and the cross-platform job history. Server-side paginated/sorted/filtered with realtime refresh.
- **Bsdiff manager** (app screen) — the `bsdiffEnabled` toggle, total patches size and served count, the live worker-settings tab, and the cleanup actions above.

## Limitations

- **Single-node.** The queue is in-process; multiple instances would each poll independently (the atomic claim keeps that *safe*, but a shared queue would be needed to coordinate at scale).
- **Lazy only.** Patches are generated on request or by manual enqueue, never automatically at release time.
- **Launch asset only.** The Expo client only patches the launch bundle.
- **No patch compression.** bsdiff output is already heavily entropy-coded.
