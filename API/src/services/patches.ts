import * as Err from '@feathersjs/errors'
import type { MongoDBAdapterOptions } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'
import type { Db } from 'mongodb'

import error from '../hooks/error'
import s from '../hooks/security'
import { logger } from '../modules'
import { deletePatchFile, getAvailablePlatforms } from '../modules/expo/patch'
import type { AppLike, HookContextLike, PatchRecord, UploadRecord } from '../types'

// Decide what to do with a manual enqueue request for ONE platform, given any
// existing patch row for that (fromUpdateId, toUpdateId, platform) triple.
//
//   'create' — no usable row exists; insert a fresh pending patch
//   'reset'  — a row exists in a terminal/failed state; flip back to pending
//              so the worker retries it now (clears cooldown)
//   'skip'   — a usable row already exists; do nothing (report why)
//
// This is the core policy of the manual trigger. Consider each case:
//   - existing === undefined        → nothing there yet
//   - status 'ready'                → a patch file already exists on disk
//   - 'pending'/'generating'/'validating' → worker is already on it
//   - 'failed'                      → a previous attempt errored (cooldown may
//                                     still be ticking; manual = retry now)
//   - 'not-beneficial'             → terminal: bundles produced no useful diff.
//                                     Re-running gives the same result UNLESS
//                                     you intend manual to force a re-check.
const decideManualEnqueue = (existing?: PatchRecord): 'create' | 'reset' | 'skip' => {
  if (!existing) return 'create'
  // Only 'failed' is retried — the manual trigger's main value is bypassing
  // the worker's 4h cooldown to rebuild a previously-errored patch now.
  if (existing.status === 'failed') return 'reset'
  // Everything else is left alone: 'ready' already exists on disk; the
  // in-progress states ('pending'/'generating'/'validating') mean the worker
  // is on it; 'not-beneficial' is terminal — the same bundles would diff to
  // the same useless result, so retrying is wasted work.
  return 'skip'
}

class PatchesService extends MongoDBService {
  app: AppLike
  // @feathersjs/mongodb stores the collection in `this.options.Model` and only
  // exposes it via the async `getModel()`. The worker (claimNextPendingPatch)
  // and asset endpoint ($inc servedCount) need synchronous raw-collection
  // access, so we mirror it onto a plain instance property here.
  Model: ReturnType<Db['collection']> | undefined

  constructor(options?: Partial<MongoDBAdapterOptions>) {
    super({ Model: undefined, ...options })
  }

  setup(app: AppLike, path: string) {
    this.app = app
    ;(app.get('mongoClient') as Promise<Db>).then(async (db) => {
      const collection = db.collection('patches')
      this.options.Model = collection
      this.Model = collection
      try {
        await collection.createIndex(
          { fromUpdateId: 1, toUpdateId: 1, platform: 1 },
          { unique: true, name: 'uniq_from_to_platform' },
        )
        await collection.createIndex({ project: 1, status: 1 })
        await collection.createIndex({ toUploadId: 1 })
        await collection.createIndex({ fromUploadId: 1 })
      } catch (e) {
        logger.warn('patches: failed to create indexes', { error: e instanceof Error ? e.message : String(e) })
      }
    })
  }

  // Find patches whose TO bundle is in 'obsolete' state. We deliberately do
  // NOT include patches whose FROM is obsolete: those still help clients
  // stuck on an old (obsolete) bundle save bandwidth on upgrade to a current
  // release. The patch is "dead" only when its target has been retired.
  //
  // olderThanDays gates by patch.createdAt — a recent patch (even for an
  // obsolete target) might still be in-flight or just generated; an admin
  // setting the window to 0 explicitly opts into deleting everything.
  async getObsoleteCandidates({ project, olderThanDays = 0 }: { project?: string; olderThanDays?: number }) {
    const uploadsQuery: Record<string, unknown> = { status: 'obsolete', $limit: 10000 }
    if (project) uploadsQuery.project = project
    const obsoleteUploads = (await this.app.service('uploads').find({ query: uploadsQuery })) as
      | UploadRecord[]
      | { data?: UploadRecord[] }
    const list = Array.isArray(obsoleteUploads) ? obsoleteUploads : obsoleteUploads?.data || []
    if (!list.length) return { candidates: [], totalBytes: 0, count: 0, computedForDays: olderThanDays }

    const uploadById = new Map<string, UploadRecord>(list.map((u) => [String(u._id), u]))
    const obsoleteIds = list.map((u) => u._id)
    const patchesQuery: Record<string, unknown> = { toUploadId: { $in: obsoleteIds }, $limit: 10000 }
    if (project) patchesQuery.project = project
    const found = await this.find({ query: patchesQuery })
    const all = Array.isArray(found) ? (found as PatchRecord[]) : (found as { data?: PatchRecord[] })?.data || []

    const cutoff = olderThanDays > 0 ? new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000) : null

    let totalBytes = 0
    const candidates = all
      .filter((p) => {
        if (!cutoff) return true
        const created = p.createdAt ? new Date(p.createdAt as string) : null
        return created !== null && created <= cutoff
      })
      .map((p) => {
        const size = Number(p.size) || 0
        const servedCount = Number(p.servedCount) || 0
        totalBytes += size
        const toUp = uploadById.get(String(p.toUploadId))
        return {
          _id: p._id,
          project: p.project,
          platform: p.platform,
          fromUpdateId: p.fromUpdateId,
          toUpdateId: p.toUpdateId,
          size,
          status: p.status,
          servedCount,
          createdAt: p.createdAt,
          // Embed target-upload info so the UI table can show what's affected
          // without an extra round-trip per row.
          toUpload: toUp
            ? {
                _id: toUp._id,
                version: toUp.version,
                releaseChannel: toUp.releaseChannel,
                createdAt: toUp.createdAt,
                gitCommit: toUp.gitCommit,
              }
            : null,
        }
      })
    return { candidates, totalBytes, count: candidates.length, computedForDays: olderThanDays }
  }

  async cleanupObsolete({ project, olderThanDays = 0 }: { project?: string; olderThanDays?: number }) {
    const { candidates, totalBytes, computedForDays } = await this.getObsoleteCandidates({ project, olderThanDays })
    let removed = 0
    const errors: Array<{ id: unknown; error: string }> = []
    for (const c of candidates) {
      try {
        // Pass `reason` so the after.remove hook tags the audit row.
        // `removePatchFileBeforeDelete` (before.remove) deletes the file.
        await this.remove(c._id, { reason: 'cleanup-obsolete' } as unknown as Record<string, unknown>)
        removed++
      } catch (e) {
        errors.push({ id: c._id, error: e instanceof Error ? e.message : String(e) })
      }
    }
    this.app.service('messages').create({ action: 'update', keys: ['patches', 'patchJobs', 'diskUsage'] })
    return { removed, totalBytes, count: candidates.length, computedForDays, errors }
  }

  // Candidate "from" (base) updates for manually building a patch toward
  // `toUploadId`. Per spec: same project, same runtimeVersion, same release
  // channel — and not the target itself. Only updates with an updateId can be
  // a patch base (the updateId is the client-facing key the patch maps from).
  async getPatchSources({ project, toUploadId }: { project?: string; toUploadId?: string }) {
    if (!toUploadId) throw new Err.BadRequest('Missing toUploadId')
    const to = (await this.app.service('uploads').get(toUploadId)) as UploadRecord
    if (!to) throw new Err.NotFound('Target update not found')

    const found = await this.app.service('uploads').find({
      query: {
        project: to.project,
        version: to.version,
        releaseChannel: to.releaseChannel,
        $limit: 1000,
      },
    })
    const list = Array.isArray(found) ? (found as UploadRecord[]) : (found as { data?: UploadRecord[] })?.data || []

    const toPlatforms = getAvailablePlatforms(to)
    const sources = list
      .filter((u) => String(u._id) !== String(toUploadId) && u.updateId)
      .map((u) => {
        const platforms = getAvailablePlatforms(u).filter((p) => toPlatforms.includes(p))
        return {
          _id: u._id,
          updateId: u.updateId,
          status: u.status,
          createdAt: u.createdAt,
          releasedAt: u.releasedAt,
          gitCommit: u.gitCommit,
          gitBranch: u.gitBranch,
          platforms, // platforms patchable toward the target (intersection)
        }
      })
      // A source with no common platform can't yield a patch — drop it.
      .filter((s2) => s2.platforms.length > 0)

    return {
      target: {
        _id: to._id,
        updateId: to.updateId,
        version: to.version,
        releaseChannel: to.releaseChannel,
        platforms: toPlatforms,
      },
      sources,
    }
  }

  // Manually enqueue patch generation from one update to another. Validates
  // the from/to pair shares project + runtimeVersion + releaseChannel, then
  // queues a pending patch per common platform. The worker does the rest.
  async enqueuePatch({ fromUploadId, toUploadId }: { project?: string; fromUploadId?: string; toUploadId?: string }) {
    if (!fromUploadId || !toUploadId) throw new Err.BadRequest('Missing fromUploadId or toUploadId')
    if (String(fromUploadId) === String(toUploadId)) throw new Err.BadRequest('from and to must be different updates')

    const [from, to] = (await Promise.all([
      this.app.service('uploads').get(fromUploadId),
      this.app.service('uploads').get(toUploadId),
    ])) as [UploadRecord, UploadRecord]
    if (!from || !to) throw new Err.NotFound('Update not found')
    if (from.project !== to.project) throw new Err.BadRequest('Updates belong to different projects')
    if (from.version !== to.version) throw new Err.BadRequest('Updates have different runtime versions')
    if (from.releaseChannel !== to.releaseChannel) throw new Err.BadRequest('Updates are on different release channels')
    if (!from.updateId || !to.updateId) throw new Err.BadRequest('Both updates must have an updateId')

    const platforms = getAvailablePlatforms(from).filter((p) => getAvailablePlatforms(to).includes(p))
    if (!platforms.length) throw new Err.BadRequest('No common platform bundles between the two updates')

    const now = new Date()
    const enqueued: Array<{ platform: string; action: 'create' | 'reset' }> = []
    const skipped: Array<{ platform: string; reason: string }> = []

    for (const platform of platforms) {
      const existingRes = await this.find({
        query: { fromUpdateId: from.updateId, toUpdateId: to.updateId, platform, $limit: 1 },
      })
      const existing =
        (Array.isArray(existingRes)
          ? (existingRes as PatchRecord[])
          : (existingRes as { data?: PatchRecord[] })?.data)?.[0] || undefined

      const action = decideManualEnqueue(existing)

      if (action === 'skip') {
        skipped.push({ platform, reason: String(existing?.status || 'unknown') })
        continue
      }

      if (action === 'reset' && existing) {
        await this.patch(existing._id, { status: 'pending', nextAttemptAt: now, error: null, path: null })
        enqueued.push({ platform, action: 'reset' })
        continue
      }

      // create
      await this.create({
        project: from.project,
        platform,
        version: to.version,
        releaseChannel: to.releaseChannel,
        fromUpdateId: from.updateId,
        toUpdateId: to.updateId,
        fromUploadId: from._id,
        toUploadId: to._id,
        status: 'pending',
        attempts: 0,
        servedCount: 0,
        createdAt: now,
        nextAttemptAt: now,
        source: 'manual',
      })
      enqueued.push({ platform, action: 'create' })
    }

    this.app.service('messages').create({ action: 'update', keys: ['patches', 'patchJobs', 'diskUsage'] })
    return { enqueued, skipped, platforms }
  }

  async purgeAll({ project }: { project?: string }) {
    const query = project ? { project } : {}
    const found = await this.find({ query: { ...query, $limit: 10000 } })
    const all = Array.isArray(found) ? (found as PatchRecord[]) : (found as { data?: PatchRecord[] })?.data || []
    let removed = 0
    for (const p of all) {
      try {
        deletePatchFile(p.path)
        await this.remove(p._id, { reason: 'manual-purge' } as unknown as Record<string, unknown>)
        removed++
      } catch (e) {
        logger.warn('patches.purgeAll: failed to remove', {
          id: p._id,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
    this.app.service('messages').create({ action: 'update', keys: ['patches', 'patchJobs', 'diskUsage'] })
    return { removed }
  }

  // Re-judge existing patches against a NEW benefit ratio so a settings change
  // takes effect immediately, not only on the next generation:
  //  - a 'ready' patch that no longer clears the threshold → 'not-beneficial'
  //    (its file is deleted; the asset endpoint must stop serving it)
  //  - a 'not-beneficial' patch that now clears it → 'pending' (regenerate; the
  //    file was deleted when first rejected, so it must be rebuilt)
  // Patches with no stored compressionRatio (legacy) are left untouched.
  async reconcileBenefitRatio(newRatio: number) {
    const col = this.Model
    if (!col || typeof newRatio !== 'number') return { reclassified: 0, requeued: 0 }

    const demote = (await col
      .find({ status: 'ready', compressionRatio: { $gte: newRatio } })
      .toArray()) as unknown as PatchRecord[]
    let reclassified = 0
    for (const p of demote) {
      try {
        deletePatchFile(p.path)
        await this.patch(p._id, {
          status: 'not-beneficial',
          path: null,
          nextAttemptAt: null,
          error: `reclassified: ${((p.compressionRatio as number) * 100).toFixed(1)}% ≥ ${(newRatio * 100).toFixed(1)}% threshold`,
          completedAt: new Date(),
        })
        reclassified++
      } catch (e) {
        logger.warn('patches.reconcile: demote failed', {
          id: p._id,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }

    const requeue = (await col
      .find({ status: 'not-beneficial', compressionRatio: { $lt: newRatio, $ne: null } })
      .toArray()) as unknown as PatchRecord[]
    let requeued = 0
    for (const p of requeue) {
      try {
        await this.patch(p._id, { status: 'pending', nextAttemptAt: null, error: null, completedAt: null })
        requeued++
      } catch (e) {
        logger.warn('patches.reconcile: requeue failed', {
          id: p._id,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }

    if (reclassified || requeued) {
      this.app.service('messages').create({ action: 'update', keys: ['patches', 'patchJobs', 'diskUsage'] })
    }
    logger.info('patches.reconcile: benefit ratio applied', { newRatio, reclassified, requeued })
    return { reclassified, requeued }
  }
}

const createService = (defaultOptions?: Partial<MongoDBAdapterOptions>) =>
  new PatchesService({ ...defaultOptions, multi: true })

const removePatchFileBeforeDelete = async (context: HookContextLike) => {
  if (context.id) {
    try {
      const doc = (await context.service.get(context.id)) as PatchRecord
      if (doc?.path) deletePatchFile(doc.path)
    } catch (e) {
      /* already gone */
    }
  }
  return context
}

const broadcastChange = (context: HookContextLike) => {
  context.app.service('messages').create({ action: 'update', keys: ['patches', 'diskUsage'] })
  return context
}

// ───────────────────────────── Audit log hooks ─────────────────────────────
// Every state change on `patches` produces one append-only `patch-jobs` row.
// Hook errors are swallowed (warn-logged) — the audit log is never allowed
// to block the actual operation.

const writeJob = async (app: AppLike, fields: Record<string, unknown>) => {
  try {
    await app.service('patch-jobs').create({ at: new Date(), ...fields })
  } catch (e) {
    logger.warn('patches: audit log write failed', { error: e instanceof Error ? e.message : String(e) })
  }
}

const logCreated = async (context: HookContextLike) => {
  const doc = context.result as PatchRecord | undefined
  if (!doc?._id) return context
  await writeJob(context.app, {
    patchId: doc._id,
    project: doc.project,
    platform: doc.platform,
    fromUpdateId: doc.fromUpdateId,
    toUpdateId: doc.toUpdateId,
    event: 'created',
    status: doc.status,
    at: doc.createdAt || new Date(),
  })
  return context
}

// Snapshot the previous status BEFORE the patch is applied so the after-hook
// can detect a real transition. Cheap +1 get, only on `patches.patch` which
// is not on the hot request path (called by worker / asset endpoint logic).
const snapshotPreviousStatus = async (context: HookContextLike) => {
  if (!context.id) return context
  try {
    const existing = (await context.service.get(context.id)) as PatchRecord
    if (!context.params) context.params = {}
    ;(context.params as Record<string, unknown>)._previousStatus = existing?.status
    ;(context.params as Record<string, unknown>)._previousAttempts = existing?.attempts
  } catch (e) {
    /* doc gone — the patch call will fail naturally */
  }
  return context
}

const logStatusChange = async (context: HookContextLike) => {
  const doc = context.result as PatchRecord | undefined
  if (!doc?._id) return context
  const prev = (context.params as Record<string, unknown> | undefined)?._previousStatus as string | undefined
  if (doc.status === prev) return context // not a transition (other fields patched)
  await writeJob(context.app, {
    patchId: doc._id,
    project: doc.project,
    platform: doc.platform,
    fromUpdateId: doc.fromUpdateId,
    toUpdateId: doc.toUpdateId,
    event: 'status-changed',
    status: doc.status,
    previousStatus: prev,
    attempts: doc.attempts,
    error: doc.error,
    durationMs: doc.durationMs,
    size: doc.size,
  })
  return context
}

const logRemoved = async (context: HookContextLike) => {
  const doc = context.result as PatchRecord | undefined
  if (!doc?._id) return context
  const reason = ((context.params as Record<string, unknown> | undefined)?.reason as string) || 'manual'
  await writeJob(context.app, {
    patchId: doc._id,
    project: doc.project,
    platform: doc.platform,
    fromUpdateId: doc.fromUpdateId,
    toUpdateId: doc.toUpdateId,
    event: 'removed',
    previousStatus: doc.status,
    reason,
    size: doc.size,
  })
  return context
}

// Custom actions routed through `update` (RPC-over-feathers). Pattern matches
// utils.setRelease / utils.cleanupOldUpdates — keeps actions inside the
// service's hook chain (auth + broadcasts) rather than bolting on a new
// router.
const customUpdateActions = async (context: HookContextLike) => {
  if (context.id === 'purgeAll') {
    context.result = await context.service.purgeAll?.(context.data || {})
  } else if (context.id === 'cleanupObsolete') {
    context.result = await context.service.cleanupObsolete?.(context.data || {})
  } else if (context.id === 'enqueue') {
    context.result = await context.service.enqueuePatch?.(context.data || {})
  }
  return context
}

const customGetActions = async (context: HookContextLike) => {
  if (context.id === 'obsoleteCandidates') {
    context.result = await context.service.getObsoleteCandidates?.(context.params?.query || {})
  } else if (context.id === 'patchSources') {
    context.result = await context.service.getPatchSources?.(context.params?.query || {})
  }
  return context
}

export default {
  name: 'patches',
  createService,
  hooks: {
    before: {
      all: s.defaultSecurity(),
      find: [],
      get: [customGetActions],
      create: [s.externalMethodNotAllowed],
      update: [customUpdateActions],
      patch: [s.externalMethodNotAllowed, snapshotPreviousStatus],
      remove: [removePatchFileBeforeDelete],
    },
    after: {
      all: [],
      find: [],
      get: [],
      create: [logCreated, broadcastChange],
      update: [],
      patch: [logStatusChange, broadcastChange],
      remove: [logRemoved, broadcastChange],
    },
    error,
  },
}
