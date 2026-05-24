const { generatePatch, validatePatch, deletePatchFile } = require('../expo/patch')
const { isLaunchBundleHealthy } = require('../expo/integrity')
// Direct import (not via ../index) to avoid circular dep:
// feathers.config → patches/worker → modules/index → feathers.config.
const logger = require('../logger')

const TICK_INTERVAL_MS = 5000
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
const COOLDOWN_MS = 4 * 60 * 60 * 1000 // 4 hours
const OBSOLETE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

let tickHandle = null
let cleanupHandle = null
let processing = false

const claimNextPendingPatch = async (app) => {
  const collection = app.service('patches').Model
  if (!collection) return null
  const now = new Date()
  const res = await collection.findOneAndUpdate(
    {
      status: 'pending',
      $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now } }]
    },
    {
      $set: { status: 'generating', lastAttemptAt: now },
      $inc: { attempts: 1 }
    },
    { sort: { createdAt: 1 }, returnDocument: 'after' }
  )
  return res?.value || null
}

const logJob = async (app, fields) => {
  try {
    await app.service('patch-jobs').create({
      ...fields,
      startedAt: fields.startedAt || new Date()
    })
  } catch (e) {
    logger.warn('patches.worker: failed to write job log', { error: e.message })
  }
}

const markFailed = async (app, patch, errorMessage, jobType = 'generate', startedAt) => {
  const now = new Date()
  await app.service('patches').patch(patch._id, {
    status: 'failed',
    error: errorMessage,
    nextAttemptAt: new Date(now.getTime() + COOLDOWN_MS),
    completedAt: now
  })
  await logJob(app, {
    patchId: patch._id,
    type: jobType,
    status: 'failed',
    project: patch.project,
    platform: patch.platform,
    fromUpdateId: patch.fromUpdateId,
    toUpdateId: patch.toUpdateId,
    startedAt: startedAt || now,
    completedAt: now,
    durationMs: now.getTime() - (startedAt ? startedAt.getTime() : now.getTime()),
    error: errorMessage
  })
}

const processOnePatch = async (app, patchDoc) => {
  const generationStartedAt = new Date()
  let fromUpload, toUpload
  try {
    [fromUpload, toUpload] = await Promise.all([
      app.service('uploads').get(patchDoc.fromUploadId),
      app.service('uploads').get(patchDoc.toUploadId)
    ])
  } catch (e) {
    await markFailed(app, patchDoc, `upload lookup failed: ${e.message}`, 'generate', generationStartedAt)
    return
  }

  // Integrity pre-flight — never diff against a broken bundle. The patch
  // would either fail to generate, produce an invalid output, or
  // (worst case) silently produce semantically-corrupt bytes.
  const fromHealth = isLaunchBundleHealthy(fromUpload, patchDoc.platform)
  if (!fromHealth.healthy) {
    await markFailed(app, patchDoc, `FROM bundle integrity: ${fromHealth.blocking.map(b => b.message).join('; ')}`, 'generate', generationStartedAt)
    return
  }
  const toHealth = isLaunchBundleHealthy(toUpload, patchDoc.platform)
  if (!toHealth.healthy) {
    await markFailed(app, patchDoc, `TO bundle integrity: ${toHealth.blocking.map(b => b.message).join('; ')}`, 'generate', generationStartedAt)
    return
  }

  // Generation
  let genResult
  try {
    genResult = await generatePatch(fromUpload, toUpload, patchDoc.platform)
  } catch (e) {
    logger.error('patches.worker: generation failed', { id: patchDoc._id, error: e.message })
    await markFailed(app, patchDoc, `generation: ${e.message}`, 'generate', generationStartedAt)
    return
  }

  const generationCompletedAt = new Date()
  await logJob(app, {
    patchId: patchDoc._id,
    type: 'generate',
    status: 'success',
    project: patchDoc.project,
    platform: patchDoc.platform,
    fromUpdateId: patchDoc.fromUpdateId,
    toUpdateId: patchDoc.toUpdateId,
    startedAt: generationStartedAt,
    completedAt: generationCompletedAt,
    durationMs: generationCompletedAt.getTime() - generationStartedAt.getTime()
  })

  await app.service('patches').patch(patchDoc._id, {
    status: 'validating',
    path: genResult.path,
    size: genResult.size,
    targetBundleSize: genResult.targetSize,
    compressionRatio: genResult.size / genResult.targetSize
  })

  // Validation (magic-bytes + benefit check; client does sha256 verify)
  const validationStartedAt = new Date()
  let validation
  try {
    validation = await validatePatch({
      patchPath: genResult.path,
      expectedTargetSize: genResult.targetSize
    })
  } catch (e) {
    deletePatchFile(genResult.path)
    await markFailed(app, patchDoc, `validation crash: ${e.message}`, 'validate', validationStartedAt)
    return
  }

  const validationCompletedAt = new Date()

  if (!validation.ok) {
    deletePatchFile(genResult.path)
    const isNotBeneficial = !!validation.notBeneficial
    await logJob(app, {
      patchId: patchDoc._id,
      type: 'validate',
      status: isNotBeneficial ? 'success' : 'failed',
      project: patchDoc.project,
      platform: patchDoc.platform,
      fromUpdateId: patchDoc.fromUpdateId,
      toUpdateId: patchDoc.toUpdateId,
      startedAt: validationStartedAt,
      completedAt: validationCompletedAt,
      durationMs: validationCompletedAt.getTime() - validationStartedAt.getTime(),
      reason: isNotBeneficial ? 'not-beneficial' : undefined,
      error: isNotBeneficial ? undefined : validation.reason
    })
    if (isNotBeneficial) {
      // Permanent terminal state: bundles unchanged → result would be identical.
      // Worker must never retry; asset endpoint must never serve.
      await app.service('patches').patch(patchDoc._id, {
        status: 'not-beneficial',
        error: validation.reason,
        nextAttemptAt: null,
        path: null,
        completedAt: validationCompletedAt
      })
    } else {
      await app.service('patches').patch(patchDoc._id, {
        status: 'failed',
        error: validation.reason,
        nextAttemptAt: new Date(Date.now() + COOLDOWN_MS),
        path: null,
        completedAt: validationCompletedAt
      })
    }
    return
  }

  await app.service('patches').patch(patchDoc._id, {
    status: 'ready',
    completedAt: validationCompletedAt,
    durationMs: validationCompletedAt.getTime() - generationStartedAt.getTime(),
    error: null
  })
  await logJob(app, {
    patchId: patchDoc._id,
    type: 'validate',
    status: 'success',
    project: patchDoc.project,
    platform: patchDoc.platform,
    fromUpdateId: patchDoc.fromUpdateId,
    toUpdateId: patchDoc.toUpdateId,
    startedAt: validationStartedAt,
    completedAt: validationCompletedAt,
    durationMs: validationCompletedAt.getTime() - validationStartedAt.getTime()
  })
  logger.info('patches.worker: patch ready', {
    id: patchDoc._id,
    size: genResult.size,
    ratio: genResult.size / genResult.targetSize
  })
}

const tick = async (app) => {
  if (processing) return
  processing = true
  try {
    const patchDoc = await claimNextPendingPatch(app)
    if (!patchDoc) return
    await processOnePatch(app, patchDoc)
  } catch (e) {
    logger.error('patches.worker: tick crashed', { error: e.message })
  } finally {
    processing = false
  }
}

const cleanupObsoletePatches = async (app) => {
  const collection = app.service('patches').Model
  if (!collection) return
  const cutoff = new Date(Date.now() - OBSOLETE_RETENTION_MS)
  let cursor
  try {
    cursor = collection.find({ markedObsoleteAt: { $lte: cutoff } })
  } catch (e) {
    logger.warn('patches.worker.cleanup: query failed', { error: e.message })
    return
  }
  const docs = await cursor.toArray()
  for (const doc of docs) {
    const startedAt = new Date()
    try {
      deletePatchFile(doc.path)
      await app.service('patches').remove(doc._id)
      await logJob(app, {
        patchId: doc._id,
        type: 'delete',
        status: 'success',
        project: doc.project,
        platform: doc.platform,
        fromUpdateId: doc.fromUpdateId,
        toUpdateId: doc.toUpdateId,
        startedAt,
        completedAt: new Date(),
        durationMs: 0,
        reason: 'obsolete-7d'
      })
    } catch (e) {
      logger.warn('patches.worker.cleanup: failed to remove', { id: doc._id, error: e.message })
    }
  }
}

const cleanupTick = async (app) => {
  try {
    await cleanupObsoletePatches(app)
  } catch (e) {
    logger.error('patches.worker: cleanup crashed', { error: e.message })
  }
}

const start = (app) => {
  if (tickHandle) return
  tickHandle = setInterval(() => tick(app), TICK_INTERVAL_MS)
  cleanupHandle = setInterval(() => cleanupTick(app), CLEANUP_INTERVAL_MS)
  // run cleanup once at startup
  cleanupTick(app)
  logger.info('patches.worker: started', { tickMs: TICK_INTERVAL_MS, cleanupMs: CLEANUP_INTERVAL_MS })
}

const stop = () => {
  if (tickHandle) { clearInterval(tickHandle); tickHandle = null }
  if (cleanupHandle) { clearInterval(cleanupHandle); cleanupHandle = null }
}

module.exports = {
  start,
  stop,
  // exported for tests
  tick,
  cleanupObsoletePatches,
  COOLDOWN_MS,
  OBSOLETE_RETENTION_MS
}
