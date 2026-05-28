import { getBsdiffSettings } from '../../services/bsdiff-settings'
import type { BsdiffSettings } from '../../services/bsdiff-settings'
import type { AppLike, LoggerLike, PatchRecord, UploadRecord } from '../../types'
import { isLaunchBundleHealthy } from '../expo/integrity'
import { deletePatchFile, generatePatch, validatePatch } from '../expo/patch'
import loggerDefault from '../logger'

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

const claimNextPendingPatch = async (
  app: AppLike,
  staleInProgressMs: number,
): Promise<PatchWorkerRecord | null> => {
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

const processOnePatch = async (app: AppLike, patchDoc: PatchWorkerRecord, settings: BsdiffSettings) => {
  const generationStartedAt = new Date()
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
    await markFailed(app, patchDoc, `upload lookup failed: ${e instanceof Error ? e.message : String(e)}`, settings.cooldownMs)
    return
  }
  logger.info('patches.worker: uploads resolved, running integrity + generation', { id: patchDoc._id })

  // Integrity pre-flight — never diff against a broken bundle. The patch
  // would either fail to generate, produce an invalid output, or
  // (worst case) silently produce semantically-corrupt bytes.
  const fromHealth = isLaunchBundleHealthy(fromUpload, patchDoc.platform)
  if (!fromHealth.healthy) {
    await markFailed(app, patchDoc, `FROM bundle integrity: ${fromHealth.blocking.map((b) => b.message).join('; ')}`, settings.cooldownMs)
    return
  }
  const toHealth = isLaunchBundleHealthy(toUpload, patchDoc.platform)
  if (!toHealth.healthy) {
    await markFailed(app, patchDoc, `TO bundle integrity: ${toHealth.blocking.map((b) => b.message).join('; ')}`, settings.cooldownMs)
    return
  }

  // Generation
  logger.info('patches.worker: starting generatePatch (bsdiff)', { id: patchDoc._id })
  let genResult
  try {
    genResult = await generatePatch(fromUpload, toUpload, patchDoc.platform)
    logger.info('patches.worker: generatePatch done', {
      id: patchDoc._id,
      size: genResult.size,
      targetSize: genResult.targetSize,
    })
  } catch (e) {
    logger.error('patches.worker: generation failed', {
      id: patchDoc._id,
      error: e instanceof Error ? e.message : String(e),
    })
    await markFailed(app, patchDoc, `generation: ${e instanceof Error ? e.message : String(e)}`, settings.cooldownMs)
    return
  }

  await app.service('patches').patch(patchDoc._id, {
    status: 'validating',
    path: genResult.path,
    size: genResult.size,
    targetBundleSize: genResult.targetSize,
    compressionRatio: genResult.size / genResult.targetSize,
  })

  // Validation (magic-bytes + benefit check; client does sha256 verify)
  let validation
  try {
    validation = await validatePatch({
      patchPath: genResult.path,
      expectedTargetSize: genResult.targetSize,
      benefitRatio: settings.patchBenefitRatio,
    })
  } catch (e) {
    deletePatchFile(genResult.path)
    await markFailed(app, patchDoc, `validation crash: ${e instanceof Error ? e.message : String(e)}`, settings.cooldownMs)
    return
  }

  const validationCompletedAt = new Date()
  logger.info('patches.worker: validation result', {
    id: patchDoc._id,
    ok: validation.ok,
    notBeneficial: !!validation.notBeneficial,
    reason: validation.reason,
  })

  if (!validation.ok) {
    deletePatchFile(genResult.path)
    if (validation.notBeneficial) {
      // Permanent terminal state: bundles unchanged → result would be identical.
      // Worker must never retry; asset endpoint must never serve.
      await app.service('patches').patch(patchDoc._id, {
        status: 'not-beneficial',
        error: validation.reason,
        nextAttemptAt: null,
        path: null,
        completedAt: validationCompletedAt,
      })
    } else {
      await markFailed(app, patchDoc, validation.reason, settings.cooldownMs)
    }
    return
  }

  await app.service('patches').patch(patchDoc._id, {
    status: 'ready',
    completedAt: validationCompletedAt,
    durationMs: validationCompletedAt.getTime() - generationStartedAt.getTime(),
    error: null,
  })
  logger.info('patches.worker: patch ready', {
    id: patchDoc._id,
    size: genResult.size,
    ratio: genResult.size / genResult.targetSize,
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
