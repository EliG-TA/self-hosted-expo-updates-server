const fs = require('fs')
const path = require('path')
const { getMetadataSync, getUpdateHash } = require('./helpers')

const isReadable = (p) => {
  try { fs.accessSync(p, fs.constants.R_OK); return true } catch (e) { return false }
}

// Inlined here because the only other place this logic lives is bsdiff's
// patch.ts (which we don't depend on). Two short copies are cheaper than a
// new shared module the moment bsdiff isn't loaded.
const launchBundlePath = (upload, platform) => {
  const { metadataJson } = getMetadataSync(upload)
  const platformMeta = metadataJson?.fileMetadata?.[platform]
  if (!platformMeta?.bundle) {
    throw new Error(`No bundle for platform ${platform} in update ${upload.updateId}`)
  }
  return path.join(upload.path, platformMeta.bundle)
}

/**
 * Inspect a single upload document and return its integrity issues.
 * Issue shape: { severity: 'error' | 'warning', category: string, message: string }
 *
 * Used by:
 *   - the full project-wide integrity walk (utils.checkIntegrity)
 *   - the pre-flight guard in utils.setRelease
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
        try { bundleFull = launchBundlePath(up, platform) }
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

module.exports = { checkSingleIntegrity }
