const fs = require('fs')
const path = require('path')
const { getMetadataSync, getUpdateHash } = require('./helpers')
const { getLaunchAssetPath } = require('./patch')

const isReadable = (p) => {
  try { fs.accessSync(p, fs.constants.R_OK); return true } catch (e) { return false }
}

/**
 * Inspect a single upload document and return its integrity issues.
 * Issue shape: { severity: 'error' | 'warning', category: string, message: string }
 *
 * Used by:
 *   - the full project-wide integrity walk (utils.checkIntegrity)
 *   - the pre-flight guard in utils.setRelease
 *   - the asset endpoint patch flow (refuses to serve / queue a patch
 *     for broken bundles)
 *   - the patches worker (refuses to generate patches between broken bundles)
 */
const checkSingleIntegrity = (up) => {
  const issues = []
  const err = (category, message) => issues.push({ severity: 'error', category, message })
  const warn = (category, message) => issues.push({ severity: 'warning', category, message })

  if (!up.filename) err('zip', 'zip path not recorded in DB')
  else if (!fs.existsSync(up.filename)) err('zip', 'zip archive missing on disk')
  else if (!isReadable(up.filename)) err('zip', 'zip archive not readable (permission)')

  const hasDir = !!up.path && fs.existsSync(up.path)
  if (!up.path) err('dir', 'extracted path not recorded in DB')
  else if (!hasDir) err('dir', 'extracted directory missing on disk')
  else if (!isReadable(up.path)) err('dir', 'extracted directory not readable (permission)')

  if (!up.updateId) warn('db', 'updateId missing in DB')
  if (!up.updateHash) warn('db', 'updateHash missing in DB')

  if (hasDir && isReadable(up.path)) {
    let metadata = null
    try { ({ metadataJson: metadata } = getMetadataSync(up)) }
    catch (e) { err('metadata', `metadata.json: ${e.message}`) }

    const appJsonPath = path.join(up.path, 'app.json')
    if (!fs.existsSync(appJsonPath)) err('app-json', 'app.json missing')
    else if (!isReadable(appJsonPath)) err('app-json', 'app.json not readable')
    else {
      try { JSON.parse(fs.readFileSync(appJsonPath, 'utf-8')) }
      catch (e) { err('app-json', `app.json invalid JSON: ${e.message}`) }
    }

    const pkgPath = path.join(up.path, 'package.json')
    if (!fs.existsSync(pkgPath)) err('package-json', 'package.json missing')
    else if (!isReadable(pkgPath)) err('package-json', 'package.json not readable')
    else {
      try { JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) }
      catch (e) { err('package-json', `package.json invalid JSON: ${e.message}`) }
    }

    if (metadata && up.updateHash) {
      try {
        const computed = getUpdateHash(up.path)
        if (computed !== up.updateHash) {
          err('hash', `updateHash drift (db=${up.updateHash.slice(0, 12)}…, fs=${computed.slice(0, 12)}…)`)
        }
      } catch (e) { /* metadata read already reported */ }
    }

    if (metadata?.fileMetadata) {
      for (const platform of ['ios', 'android']) {
        const platMeta = metadata.fileMetadata[platform]
        if (!platMeta) continue

        let bundleFull = null
        try { bundleFull = getLaunchAssetPath(up, platform) }
        catch (e) { err('bundle', `${platform} bundle: ${e.message}`) }

        if (bundleFull) {
          if (!fs.existsSync(bundleFull)) err('bundle', `${platform} bundle missing`)
          else if (!isReadable(bundleFull)) err('bundle', `${platform} bundle not readable (permission)`)
          else {
            try {
              const st = fs.statSync(bundleFull)
              if (st.size === 0) err('bundle', `${platform} bundle is empty (0 bytes)`)
            } catch (e) { /* unlikely */ }
          }
        }

        let missingAssetCount = 0
        for (const asset of (platMeta.assets || [])) {
          const full = path.join(up.path, asset.path)
          if (!fs.existsSync(full)) missingAssetCount++
        }
        if (missingAssetCount > 0) {
          err('asset', `${platform}: ${missingAssetCount} asset file(s) missing`)
        }
      }
    }
  }

  return {
    issues,
    errorCount: issues.filter(i => i.severity === 'error').length,
    warningCount: issues.filter(i => i.severity === 'warning').length
  }
}

/**
 * Narrower check: does this upload have any error that would make a launch
 * bundle for the given platform broken? Used by asset/patch flows so we
 * don't fail on iOS issues when an Android client is asking.
 */
const isLaunchBundleHealthy = (up, platform) => {
  const { issues } = checkSingleIntegrity(up)
  const blocking = issues.filter(i => {
    if (i.severity !== 'error') return false
    // Categories that affect bundle serving regardless of platform:
    if (['zip', 'dir', 'metadata'].includes(i.category)) return true
    // Bundle category: only block if message mentions our platform.
    if (i.category === 'bundle') return i.message.toLowerCase().includes(platform)
    // Other categories (app-json, package-json, hash, asset) don't break the
    // launch bundle stream itself — clients can still receive bytes.
    return false
  })
  return { healthy: blocking.length === 0, blocking }
}

module.exports = { checkSingleIntegrity, isLaunchBundleHealthy }
