import type { MongoDBAdapterOptions } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'
import type { Db } from 'mongodb'

import error from '../hooks/error'
import s from '../hooks/security'
import { logger } from '../modules'
import { deletePatchFile } from '../modules/expo/patch'
import type { AppLike, HookContextLike, PatchRecord, UploadRecord } from '../types'

class PatchesService extends MongoDBService {
  app: AppLike

  constructor(options?: Partial<MongoDBAdapterOptions>) {
    super({ Model: undefined, ...options })
  }

  setup(app: AppLike, path: string) {
    this.app = app
    ;(app.get('mongoClient') as Promise<Db>).then(async (db) => {
      const collection = db.collection('patches')
      this.options.Model = collection
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
  }
  return context
}

const customGetActions = async (context: HookContextLike) => {
  if (context.id === 'obsoleteCandidates') {
    context.result = await context.service.getObsoleteCandidates?.(context.params?.query || {})
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
