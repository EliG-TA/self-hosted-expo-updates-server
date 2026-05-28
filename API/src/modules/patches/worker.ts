import type { BsdiffSettings } from '../../services/bsdiff-settings'
import { getBsdiffSettings } from '../../services/bsdiff-settings'
import type { AppLike, LoggerLike, PatchRecord, UploadRecord } from '../../types'
import loggerDefault from '../logger'
import { runGenerationJob } from './pool'

// Direct import (not via ../index) to avoid circular dep:
// feathers.config → patches/worker → modules/index → feathers.config.
const logger: LoggerLike = loggerDefault

// Worker tunables (tick cadence, cooldown, stale-reclaim window, concurrency)
// are live-configurable via the `bsdiff-settings` service and read each tick,
// so changes take effect without a restart. See services/bsdiff-settings.ts.

let timer: ReturnType<typeof setTimeout> | null = null
let started = false
let stopped = false
// Number of patches currently being generated. The tick tops this up to the
// configured concurrency; each in-flight job decrements it when it settles.
let activeCount = 0

interface PatchWorkerRecord extends PatchRecord {
  platform: string
  fromUploadId: string
  toUploadId: string
  fromUpdateId: string
  toUpdateId: string
}

const claimNextPendingPatch = async (app: AppLike, staleInProgressMs: number): Promise<PatchWorkerRecord | null> => {
  const collection = app.service('patches').Model
  if (!collection) return null
  const now = new Date()
  const staleCutoff = new Date(now.getTime() - staleInProgressMs)
  const res = await collection.findOneAndUpdate(
    {
      $or: [
        // Fresh queue item whose cooldown (if any) has elapsed.
        { status: 'pending', $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now } }] },
        // Orphaned in-progress item from a crashed/restarted run.
        { status: { $in: ['generating', 'validating'] }, lastAttemptAt: { $lte: staleCutoff } },
      ],
    },
    {
      $set: { status: 'generating', lastAttemptAt: now },
      $inc: { attempts: 1 },
    },
    // Secondary _id sort makes claim order deterministic when a batch shares
    // createdAt (manual enqueue creates android+ios with the same timestamp;
    // android is inserted first so its ObjectId sorts earlier).
    { sort: { createdAt: 1, _id: 1 }, returnDocument: 'after' },
  )
  // mongodb v6 returns the updated document directly (no `.value` wrapper).
  return (res as PatchWorkerRecord | null) || null
}

const markFailed = async (app: AppLike, patch: PatchWorkerRecord, errorMessage: string, cooldownMs: number) => {
  const now = new Date()
  logger.warn('patches.worker: marking patch failed', { id: patch._id, reason: errorMessage })
  await app.service('patches').patch(patch._id, {
    status: 'failed',
    error: errorMessage,
    nextAttemptAt: new Date(now.getTime() + cooldownMs),
    completedAt: now,
  })
}

// JSON-clone an upload record so only plain, structured-cloneable data crosses
// the worker boundary: strips ObjectId/class prototypes and converts Dates to
// ISO strings (which getMetadataSync's `new Date(releasedAt)` re-parses fine).
const toPlainUpload = (upload: UploadRecord): Record<string, unknown> =>
  JSON.parse(JSON.stringify(upload)) as Record<string, unknown>

const processOnePatch = async (app: AppLike, patchDoc: PatchWorkerRecord, settings: BsdiffSettings) => {
  const generationStartedAt = Date.now()
  logger.info('patches.worker: claimed patch', {
    id: patchDoc._id,
    platform: patchDoc.platform,
    fromUploadId: patchDoc.fromUploadId,
    toUploadId: patchDoc.toUploadId,
  })
  let fromUpload: UploadRecord
  let toUpload: UploadRecord
  try {
    ;[fromUpload, toUpload] = (await Promise.all([
      app.service('uploads').get(patchDoc.fromUploadId),
      app.service('uploads').get(patchDoc.toUploadId),
    ])) as [UploadRecord, UploadRecord]
  } catch (e) {
    await markFailed(
      app,
      patchDoc,
      `upload lookup failed: ${e instanceof Error ? e.message : String(e)}`,
      settings.cooldownMs,
    )
    return
  }

  // Heartbeat: while we hold this patch, keep its lastAttemptAt fresh so the
  // stale-reclaim branch never mistakes a legitimately long-running job (5-10s,
  // or longer under load) for a crashed one and hands it to a second worker.
  // The status guard means a no-op once the job leaves 'generating'.
  const collection = app.service('patches').Model
  const heartbeatMs = Math.max(10_000, Math.floor(settings.staleInProgressMs / 3))
  const heartbeat = setInterval(() => {
    collection
      ?.updateOne({ _id: patchDoc._id, status: 'generating' }, { $set: { lastAttemptAt: new Date() } })
      .catch(() => {})
  }, heartbeatMs)
  heartbeat.unref?.()

  // Integrity + generate + validate all run in a worker thread so the
  // synchronous WASM diff never blocks the main event loop.
  let result
  try {
    result = await runGenerationJob({
      fromUpload: toPlainUpload(fromUpload),
      toUpload: toPlainUpload(toUpload),
      platform: patchDoc.platform,
      benefitRatio: settings.patchBenefitRatio,
    })
  } catch (e) {
    logger.error('patches.worker: generation worker failed', {
      id: patchDoc._id,
      error: e instanceof Error ? e.message : String(e),
    })
    await markFailed(app, patchDoc, `worker: ${e instanceof Error ? e.message : String(e)}`, settings.cooldownMs)
    return
  } finally {
    clearInterval(heartbeat)
  }

  logger.info('patches.worker: generation result', { id: patchDoc._id, outcome: result.outcome })

  if (result.outcome === 'failed') {
    await markFailed(app, patchDoc, result.error, settings.cooldownMs)
    return
  }

  if (result.outcome === 'not-beneficial') {
    // Permanent terminal state: bundles unchanged → result would be identical.
    // Worker must never retry; asset endpoint must never serve. (Patch file
    // already deleted inside the generation worker.)
    await app.service('patches').patch(patchDoc._id, {
      status: 'not-beneficial',
      error: result.reason,
      nextAttemptAt: null,
      path: null,
      // Persist the metrics so a later benefitRatio change can re-judge this
      // patch (reconcileBenefitRatio) without regenerating it.
      size: result.size,
      targetBundleSize: result.targetSize,
      compressionRatio: result.compressionRatio,
      completedAt: new Date(),
    })
    return
  }

  await app.service('patches').patch(patchDoc._id, {
    status: 'ready',
    path: result.path,
    size: result.size,
    targetBundleSize: result.targetSize,
    compressionRatio: result.compressionRatio,
    durationMs: Date.now() - generationStartedAt,
    completedAt: new Date(),
    error: null,
  })
  logger.info('patches.worker: patch ready', {
    id: patchDoc._id,
    size: result.size,
    ratio: result.compressionRatio,
  })
}

// Self-rescheduling loop. Reads settings each cycle so tick cadence and
// concurrency changes apply on the next tick without a restart. Tops the
// in-flight pool up to `concurrency`, claiming jobs atomically so parallel
// runs never collide on the same patch.
const loop = async (app: AppLike) => {
  if (stopped) return
  const settings = await getBsdiffSettings(app)
  try {
    while (activeCount < settings.concurrency) {
      const patchDoc = await claimNextPendingPatch(app, settings.staleInProgressMs)
      if (!patchDoc) break
      activeCount++
      void processOnePatch(app, patchDoc, settings)
        .catch((e) =>
          logger.error('patches.worker: processOnePatch crashed', {
            id: patchDoc._id,
            error: e instanceof Error ? e.message : String(e),
          }),
        )
        .finally(() => {
          activeCount--
        })
    }
  } catch (e) {
    logger.error('patches.worker: tick crashed', { error: e instanceof Error ? e.message : String(e) })
  } finally {
    if (!stopped) timer = setTimeout(() => loop(app), settings.tickIntervalMs)
  }
}

export const start = (app: AppLike) => {
  if (started) return
  started = true
  stopped = false
  logger.info('patches.worker: started')
  void loop(app)
}

export const stop = () => {
  stopped = true
  started = false
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}
