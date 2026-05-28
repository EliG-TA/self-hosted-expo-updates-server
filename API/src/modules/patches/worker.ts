import type { AppLike, LoggerLike, PatchRecord, UploadRecord } from '../../types'
import { isLaunchBundleHealthy } from '../expo/integrity'
import { deletePatchFile, generatePatch, validatePatch } from '../expo/patch'
import loggerDefault from '../logger'

// Direct import (not via ../index) to avoid circular dep:
// feathers.config → patches/worker → modules/index → feathers.config.
const logger: LoggerLike = loggerDefault

const TICK_INTERVAL_MS = 5000
const COOLDOWN_MS = 4 * 60 * 60 * 1000 // 4 hours

let tickHandle: ReturnType<typeof setInterval> | null = null
let processing = false

interface PatchWorkerRecord extends PatchRecord {
  platform: string
  fromUploadId: string
  toUploadId: string
  fromUpdateId: string
  toUpdateId: string
}

const claimNextPendingPatch = async (app: AppLike): Promise<PatchWorkerRecord | null> => {
  const collection = app.service('patches').Model
  if (!collection) return null
  const now = new Date()
  const res = await collection.findOneAndUpdate(
    {
      status: 'pending',
      $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now } }],
    },
    {
      $set: { status: 'generating', lastAttemptAt: now },
      $inc: { attempts: 1 },
    },
    { sort: { createdAt: 1 }, returnDocument: 'after' },
  )
  return (res?.value as PatchWorkerRecord | undefined) || null
}

const markFailed = async (app: AppLike, patch: PatchWorkerRecord, errorMessage: string) => {
  const now = new Date()
  await app.service('patches').patch(patch._id, {
    status: 'failed',
    error: errorMessage,
    nextAttemptAt: new Date(now.getTime() + COOLDOWN_MS),
    completedAt: now,
  })
}

const processOnePatch = async (app: AppLike, patchDoc: PatchWorkerRecord) => {
  const generationStartedAt = new Date()
  let fromUpload: UploadRecord
  let toUpload: UploadRecord
  try {
    ;[fromUpload, toUpload] = (await Promise.all([
      app.service('uploads').get(patchDoc.fromUploadId),
      app.service('uploads').get(patchDoc.toUploadId),
    ])) as [UploadRecord, UploadRecord]
  } catch (e) {
    await markFailed(app, patchDoc, `upload lookup failed: ${e instanceof Error ? e.message : String(e)}`)
    return
  }

  // Integrity pre-flight — never diff against a broken bundle. The patch
  // would either fail to generate, produce an invalid output, or
  // (worst case) silently produce semantically-corrupt bytes.
  const fromHealth = isLaunchBundleHealthy(fromUpload, patchDoc.platform)
  if (!fromHealth.healthy) {
    await markFailed(app, patchDoc, `FROM bundle integrity: ${fromHealth.blocking.map((b) => b.message).join('; ')}`)
    return
  }
  const toHealth = isLaunchBundleHealthy(toUpload, patchDoc.platform)
  if (!toHealth.healthy) {
    await markFailed(app, patchDoc, `TO bundle integrity: ${toHealth.blocking.map((b) => b.message).join('; ')}`)
    return
  }

  // Generation
  let genResult
  try {
    genResult = await generatePatch(fromUpload, toUpload, patchDoc.platform)
  } catch (e) {
    logger.error('patches.worker: generation failed', {
      id: patchDoc._id,
      error: e instanceof Error ? e.message : String(e),
    })
    await markFailed(app, patchDoc, `generation: ${e instanceof Error ? e.message : String(e)}`)
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
    })
  } catch (e) {
    deletePatchFile(genResult.path)
    await markFailed(app, patchDoc, `validation crash: ${e instanceof Error ? e.message : String(e)}`)
    return
  }

  const validationCompletedAt = new Date()

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
      await markFailed(app, patchDoc, validation.reason)
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

const tick = async (app: AppLike) => {
  if (processing) return
  processing = true
  try {
    const patchDoc = await claimNextPendingPatch(app)
    if (!patchDoc) return
    await processOnePatch(app, patchDoc)
  } catch (e) {
    logger.error('patches.worker: tick crashed', { error: e instanceof Error ? e.message : String(e) })
  } finally {
    processing = false
  }
}

export const start = (app: AppLike) => {
  if (tickHandle) return
  tickHandle = setInterval(() => tick(app), TICK_INTERVAL_MS)
  logger.info('patches.worker: started', { tickMs: TICK_INTERVAL_MS })
}

export const stop = () => {
  if (tickHandle) {
    clearInterval(tickHandle)
    tickHandle = null
  }
}

export { COOLDOWN_MS, tick }
