import * as Err from '@feathersjs/errors'
import * as fs from 'fs'
import * as path from 'path'

import type { LoggerLike } from '../../types'
import loggerDefault from '../logger'
import { COOLDOWN_MS } from '../patches/worker'
import { isLaunchBundleHealthy } from './integrity'
import { getLaunchAssetPath } from './patch'
const logger: LoggerLike = loggerDefault

const PATCH_TERMINAL_NOT_BENEFICIAL = 'not-beneficial'
const PATCH_TERMINAL_READY = 'ready'
const PATCH_IN_PROGRESS = ['pending', 'generating', 'validating']

const wantsBsdiffPatch = (headers) => {
  const aIm = headers['a-im'] || headers['A-IM']
  if (!aIm) return false
  return String(aIm)
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .includes('bsdiff')
}

const buildFallback = (assetPath, contentType) => ({
  type: 'asset',
  path: assetPath,
  contentType: decodeURI(contentType),
})

/**
 * Decide whether to serve a bsdiff patch for this launch-asset request.
 *
 * Returns one of:
 *   { decision: 'serve-patch', patchDoc }
 *   { decision: 'mark-failed-then-fallback', patchDoc, reason }  // file missing
 *   { decision: 'queue-then-fallback', insertDoc }                // no record yet
 *   { decision: 'reset-then-fallback', patchDoc }                 // failed past cooldown
 *   { decision: 'fallback' }                                      // any other case
 *
 * Status semantics:
 *   - 'ready' + file exists      → serve
 *   - 'ready' + file missing     → mark failed (cooldown) → fallback
 *   - 'not-beneficial'           → terminal, never serve, never retry
 *   - 'pending'/'generating'/'validating' → worker busy → fallback
 *   - 'failed' + cooldown done   → reset to pending → fallback
 *   - 'failed' + still cooling   → fallback
 *   - no record                  → enqueue → fallback
 */
const decidePatchAction = (existing, now) => {
  if (!existing) {
    return { decision: 'queue-then-fallback' }
  }
  if (existing.status === PATCH_TERMINAL_READY) {
    if (existing.path && fs.existsSync(existing.path)) {
      return { decision: 'serve-patch', patchDoc: existing }
    }
    return {
      decision: 'mark-failed-then-fallback',
      patchDoc: existing,
      reason: `patch file missing at ${existing.path}`,
    }
  }
  if (existing.status === PATCH_TERMINAL_NOT_BENEFICIAL) {
    return { decision: 'fallback' }
  }
  if (PATCH_IN_PROGRESS.includes(existing.status)) {
    return { decision: 'fallback' }
  }
  if (existing.status === 'failed') {
    const cooldownDone = !existing.nextAttemptAt || new Date(existing.nextAttemptAt) <= now
    if (cooldownDone) return { decision: 'reset-then-fallback', patchDoc: existing }
    return { decision: 'fallback' }
  }
  return { decision: 'fallback' }
}

const isLaunchAssetPath = (assetPath, upload, platform) => {
  try {
    const expected = path.resolve(getLaunchAssetPath(upload, platform))
    return path.resolve(assetPath) === expected
  } catch (e) {
    return false
  }
}

const tryHandlePatch = async (app, { query, headers }, fallback) => {
  const { asset, project, platform, updateId, contentType } = query
  if (!wantsBsdiffPatch(headers)) return fallback
  if (!project || !platform || !updateId) return fallback
  if (platform !== 'ios' && platform !== 'android') return fallback

  const currentUpdateId = headers['expo-current-update-id'] || headers['Expo-Current-Update-ID']
  const requestedUpdateId = headers['expo-requested-update-id'] || headers['Expo-Requested-Update-ID']
  if (!currentUpdateId || !requestedUpdateId) return fallback
  if (currentUpdateId.toLowerCase() === requestedUpdateId.toLowerCase()) return fallback

  // Per-app toggle
  let application
  try {
    application = await app.service('apps').get(project)
  } catch (e) {
    return fallback
  }
  if (!application?.bsdiffEnabled) return fallback

  // Resolve uploads
  let toUpload, fromUpload
  try {
    const [toMatches, fromMatches] = await Promise.all([
      app.service('uploads').find({ query: { updateId: requestedUpdateId, $limit: 1 } }),
      app.service('uploads').find({ query: { updateId: currentUpdateId, $limit: 1 } }),
    ])
    toUpload = toMatches?.[0] || toMatches?.data?.[0]
    fromUpload = fromMatches?.[0] || fromMatches?.data?.[0]
  } catch (e) {
    logger.warn('asset.patch: upload lookup failed', { error: e.message })
    return fallback
  }
  if (!toUpload || !fromUpload) return fallback

  // Cross-version safety
  if (toUpload.project !== project) return fallback
  if (toUpload.project !== fromUpload.project) return fallback
  if (toUpload.version !== fromUpload.version) return fallback
  if (toUpload.releaseChannel !== fromUpload.releaseChannel) return fallback

  // Verify the requested asset is actually the launch bundle of toUpload
  if (!isLaunchAssetPath(asset, toUpload, platform)) return fallback

  // Integrity gate — never serve or queue patches based on broken bundles.
  // We check both ends because:
  //   - if the FROM bundle is broken, our generated patch would diff against
  //     corrupt input → server-side hash mismatch on validation, or worse,
  //     a syntactically valid but semantically wrong patch.
  //   - if the TO bundle is broken, the patch would reconstruct corrupt
  //     output, which the client would reject (or worse, accept).
  const fromHealth = isLaunchBundleHealthy(fromUpload, platform)
  if (!fromHealth.healthy) {
    logger.warn('asset.patch: skipping — FROM bundle has integrity errors', {
      fromUpdateId: currentUpdateId,
      blocking: fromHealth.blocking.map((b) => b.message),
    })
    return fallback
  }
  const toHealth = isLaunchBundleHealthy(toUpload, platform)
  if (!toHealth.healthy) {
    logger.warn('asset.patch: skipping — TO bundle has integrity errors', {
      toUpdateId: requestedUpdateId,
      blocking: toHealth.blocking.map((b) => b.message),
    })
    return fallback
  }

  const patches = app.service('patches')
  const now = new Date()

  let existing = null
  try {
    const found = await patches.find({
      query: {
        fromUpdateId: currentUpdateId,
        toUpdateId: requestedUpdateId,
        platform,
        $limit: 1,
      },
    })
    existing = found?.[0] || found?.data?.[0] || null
  } catch (e) {
    logger.warn('asset.patch: patches lookup failed', { error: e.message })
    return fallback
  }

  const decision = decidePatchAction(existing, now)

  if (decision.decision === 'serve-patch') {
    // increment served count via raw $inc (Feathers patch doesn't support operators)
    if (patches.Model) {
      patches.Model.updateOne(
        { _id: decision.patchDoc._id },
        { $inc: { servedCount: 1 }, $set: { lastServedAt: now } },
      ).catch((e) => logger.warn('asset.patch: servedCount inc failed', { error: e.message }))
    }
    return {
      type: 'patch',
      path: decision.patchDoc.path,
      baseUpdateId: currentUpdateId,
    }
  }

  if (decision.decision === 'mark-failed-then-fallback') {
    logger.warn('asset.patch: ready patch file missing, marking failed', {
      id: decision.patchDoc._id,
      reason: decision.reason,
    })
    patches
      .patch(decision.patchDoc._id, {
        status: 'failed',
        error: decision.reason,
        nextAttemptAt: new Date(now.getTime() + COOLDOWN_MS),
        path: null,
      })
      .catch((e) => logger.warn('asset.patch: failed to mark failed', { error: e.message }))
    return fallback
  }

  if (decision.decision === 'reset-then-fallback') {
    patches
      .patch(decision.patchDoc._id, {
        status: 'pending',
        nextAttemptAt: now,
        error: null,
      })
      .catch((e) => logger.warn('asset.patch: failed to reset to pending', { error: e.message }))
    return fallback
  }

  if (decision.decision === 'queue-then-fallback') {
    patches
      .create({
        project,
        platform,
        version: toUpload.version,
        releaseChannel: toUpload.releaseChannel,
        fromUpdateId: currentUpdateId,
        toUpdateId: requestedUpdateId,
        fromUploadId: fromUpload._id,
        toUploadId: toUpload._id,
        status: 'pending',
        attempts: 0,
        servedCount: 0,
        createdAt: now,
        nextAttemptAt: now,
      })
      .catch((e) => {
        // unique-index violation = someone else already enqueued; safe to ignore
        if (e?.code !== 11000 && !String(e?.message || '').includes('duplicate key')) {
          logger.warn('asset.patch: enqueue failed', { error: e.message })
        }
      })
    return fallback
  }

  return fallback
}

export const handleAssetData = async (app, { query, headers }) => {
  const { asset, contentType } = query
  if (!asset || !contentType) {
    throw new Err.BadRequest('No asset or contentType provided.')
  }

  if (asset.includes('app.json') || asset.includes('package.json') || !asset.startsWith('/updates/')) {
    throw new Err.BadRequest('Invalid asset name.')
  }

  const assetPath = path.resolve(path.join(asset))
  if (!fs.existsSync(assetPath)) {
    throw new Err.BadRequest(`Asset "${asset}" does not exist.`)
  }

  const fallback = buildFallback(assetPath, contentType)

  try {
    return await tryHandlePatch(app, { query, headers }, fallback)
  } catch (e) {
    logger.error('asset.patch: unexpected error, falling back to full bundle', { error: e.message })
    return fallback
  }
}

export const handleAssetResponse = (res) => {
  if (res.data.type === 'patch') {
    const patchBuf = fs.readFileSync(res.data.path, null)
    res.status(226)
    res.set('IM', 'bsdiff')
    res.set('expo-base-update-id', res.data.baseUpdateId)
    res.type('application/octet-stream')
    res.end(patchBuf)
    return
  }
  const asset = fs.readFileSync(res.data.path, null)
  res.type(res.data.contentType)
  res.end(asset)
}

export const getJSONInfo = ({ path: paramPath }) => {
  if (!paramPath) throw new Err.BadRequest('Missing path parameter')

  const appJsonPath = path.resolve(`${paramPath}/app.json`)
  const pkgJsonPath = path.resolve(`${paramPath}/package.json`)
  if (!fs.existsSync(appJsonPath)) throw new Err.GeneralError('Error: app.json not found')
  if (!fs.existsSync(pkgJsonPath)) throw new Err.GeneralError('Error: package.json not found')

  const appJsonBuffer = fs.readFileSync(path.resolve(appJsonPath), null)
  const appJson = JSON.parse(appJsonBuffer.toString('utf-8'))

  const pkgJsonBuffer = fs.readFileSync(path.resolve(pkgJsonPath), null)
  const pkgJson = JSON.parse(pkgJsonBuffer.toString('utf-8'))
  return {
    appJson: appJson.expo,
    dependencies: pkgJson.dependencies,
  }
}

export { decidePatchAction }
