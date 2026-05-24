const s = require('../hooks/security')
const Err = require('@feathersjs/errors')
const { generateSelfSigned } = require('../modules/expo/certs')
const { getMetadataSync } = require('../modules/expo/helpers')
const { checkSingleIntegrity } = require('../modules/expo/integrity')
const fs = require('fs')
const path = require('path')

const UPLOADS_ROOT = process.env.UPLOADS_ROOT || '/uploads'
const UPDATES_ROOT = process.env.UPDATES_ROOT || '/updates'

const dirSizeRecursive = (dir) => {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try { entries = fs.readdirSync(cur, { withFileTypes: true }) } catch (e) { continue }
    for (const entry of entries) {
      const full = path.join(cur, entry.name)
      try {
        if (entry.isDirectory()) stack.push(full)
        else if (entry.isFile()) total += fs.statSync(full).size
      } catch (e) { /* ignore */ }
    }
  }
  return total
}

class Service {
  constructor (options) {
    this.options = options || {}
  }

  setup (app) {
    this.app = app
  }

  async setRelease ({ uploadId }) {
    if (!uploadId) throw new Err.BadRequest('Missing uploadId or path')

    const upload = await this.app.service('uploads').get(uploadId)
    if (!upload) throw new Err.NotFound('Upload not found')

    // Pre-flight: refuse to release/rollback an upload whose files are
    // broken — clients would hit 404/corrupt-bundle errors. Warnings are
    // OK (e.g. updateId/updateHash missing from older records).
    const integrity = checkSingleIntegrity(upload)
    if (integrity.errorCount > 0) {
      const lines = integrity.issues
        .filter(i => i.severity === 'error')
        .map(i => `• ${i.message}`)
        .join('\n')
      throw new Err.BadRequest(
        `Cannot release: this update has ${integrity.errorCount} integrity error(s):\n${lines}`
      )
    }

    const uploads = await this.app.service('uploads').find({ query: { project: upload.project, version: upload.version, releaseChannel: upload.releaseChannel } })

    await Promise.all(uploads.map(upd =>
      this.app.service('uploads').patch(upd._id, {
        status: upd._id.toString() === upload._id.toString() ? 'released' : (upd.status === 'ready' ? 'ready' : 'obsolete'),
        releasedAt: upd._id.toString() === upload._id.toString() ? new Date().toISOString() : null
      })
    ))
    return { message: 'Update Set' }
  }

  async deleteRelease ({ uploadId }) {
    if (!uploadId) throw new Err.BadRequest('Missing uploadId or path')

    const upload = await this.app.service('uploads').get(uploadId)
    if (!upload) throw new Err.NotFound('Upload not found')

    if(upload.path) fs.rmSync(upload.path, { recursive: true, force: true })
    if(upload.filename) fs.rmSync(upload.filename, { force: true })

    await this.app.service('uploads').remove(upload._id)

    return { message: 'Update Deleted' }
  }

  async update (id, data) {
    if (id === 'release') return this.setRelease(data)
    if (id === 'delete') return this.deleteRelease(data)
    if (id === 'cleanupOldUpdates') return this.cleanupOldUpdates(data || {})
    if (id === 'checkIntegrity') return this.checkIntegrity(data || {})
    if (id === 'scanOrphans') return this.scanOrphans(data || {})
    if (id === 'deleteOrphan') return this.deleteOrphan(data || {})

    throw new Err.BadRequest('Invalid request.')
  }

  /**
   * Find files on disk that no `uploads` document references:
   *   - zip archives in UPLOADS_ROOT not matched by any upload.filename
   *   - extracted directories in UPDATES_ROOT/<project>/<version>/<id>
   *     not matched by any upload.path
   *
   * Zips are scanned globally (we can't tell project from a zip name
   * alone), dirs are scoped to the requested project.
   */
  async scanOrphans ({ project }) {
    if (!project) throw new Err.BadRequest('Missing project')

    const allUploads = await this.app.service('uploads').find({ query: {} })
    const knownZips = new Set(allUploads.map(u => u.filename).filter(Boolean))
    const knownPaths = new Set(allUploads.map(u => u.path).filter(Boolean))

    const orphans = []

    // Orphan zips — global scan of UPLOADS_ROOT.
    try {
      const entries = fs.readdirSync(UPLOADS_ROOT, { withFileTypes: true })
      for (const e of entries) {
        if (!e.isFile()) continue
        if (e.name.startsWith('.')) continue // skip .gitkeep, dotfiles
        const full = path.join(UPLOADS_ROOT, e.name)
        if (knownZips.has(full)) continue
        let st = null
        try { st = fs.statSync(full) } catch (err) { continue }
        orphans.push({
          type: 'zip',
          path: full,
          name: e.name,
          sizeBytes: st.size,
          modifiedAt: st.mtime
        })
      }
    } catch (e) { /* uploads root missing */ }

    // Orphan dirs — per-project scan of UPDATES_ROOT/<project>/<version>/<id>.
    const projectDir = path.join(UPDATES_ROOT, project)
    try {
      const versions = fs.readdirSync(projectDir, { withFileTypes: true })
      for (const v of versions) {
        if (!v.isDirectory()) continue
        const versionDir = path.join(projectDir, v.name)
        let uploadDirs
        try { uploadDirs = fs.readdirSync(versionDir, { withFileTypes: true }) } catch (e) { continue }
        for (const u of uploadDirs) {
          if (!u.isDirectory()) continue
          const full = path.join(versionDir, u.name)
          if (knownPaths.has(full)) continue

          let mtime = null
          try { mtime = fs.statSync(full).mtime } catch (e) { /* ignore */ }
          const sizeBytes = dirSizeRecursive(full)

          orphans.push({
            type: 'dir',
            path: full,
            name: u.name,
            sizeBytes,
            modifiedAt: mtime,
            project,
            version: v.name
          })
        }
      }
    } catch (e) { /* project dir missing */ }

    const totalBytes = orphans.reduce((acc, o) => acc + (o.sizeBytes || 0), 0)
    return {
      project,
      orphanCount: orphans.length,
      zipCount: orphans.filter(o => o.type === 'zip').length,
      dirCount: orphans.filter(o => o.type === 'dir').length,
      totalBytes,
      orphans
    }
  }

  async deleteOrphan ({ path: targetPath, type }) {
    if (!targetPath) throw new Err.BadRequest('Missing path')
    // Safety: only allow paths inside our managed roots. Without this gate
    // the endpoint becomes a remote-delete primitive against the API host.
    if (!targetPath.startsWith(UPLOADS_ROOT + '/') && !targetPath.startsWith(UPDATES_ROOT + '/')) {
      throw new Err.BadRequest('Refusing to delete path outside managed roots')
    }
    const existed = fs.existsSync(targetPath)
    try {
      fs.rmSync(targetPath, { force: true, recursive: type === 'dir' })
    } catch (e) {
      throw new Err.GeneralError(`Delete failed: ${e.message}`)
    }
    const removed = !fs.existsSync(targetPath)
    return { path: targetPath, existed, removed }
  }

  /**
   * Walk every upload for the given project and report missing/broken
   * files. Per-upload heavy lifting lives in modules/expo/integrity.ts;
   * here we just iterate and aggregate counters / row summaries.
   *
   * When called with a single uploadId, returns the same shape but with
   * exactly one row in `problems` (or none, if the upload is clean) —
   * the Release dialog uses this to gate the Release/Rollback action.
   */
  async checkIntegrity ({ project, uploadId }) {
    if (!project && !uploadId) throw new Err.BadRequest('Missing project or uploadId')

    const uploads = uploadId
      ? [await this.app.service('uploads').get(uploadId)]
      : await this.app.service('uploads').find({ query: { project } })

    const problems = []
    const categoryCounts = {}

    for (const up of uploads) {
      const { issues, errorCount, warningCount } = checkSingleIntegrity(up)
      if (!issues.length) continue

      for (const iss of issues) {
        categoryCounts[iss.category] = (categoryCounts[iss.category] || 0) + 1
      }

      problems.push({
        _id: up._id,
        updateId: up.updateId,
        version: up.version,
        releaseChannel: up.releaseChannel,
        status: up.status,
        createdAt: up.createdAt,
        issues,
        errorCount,
        warningCount
      })
    }

    const errorRowCount = problems.filter(p => p.errorCount > 0).length
    const warningRowCount = problems.filter(p => p.errorCount === 0 && p.warningCount > 0).length

    return {
      project,
      checkedCount: uploads.length,
      problemCount: problems.length,
      errorRowCount,
      warningRowCount,
      categoryCounts,
      problems
    }
  }

  /**
   * Find uploads safe to delete:
   *   1. status is anything except 'released' (released = currently live for
   *      some channel+version — never touch)
   *   2. createdAt is older than `olderThanDays`
   *   3. No client currently reports the upload's updateId as `currentUpdate`
   *      (nobody is pinned to this bundle right now)
   *
   * `clients.currentUpdate` is overwritten whenever a device upgrades, so
   * once everyone has migrated off an old release the field never points
   * at it again. Combined with the age check this gives a safe
   * "old AND nobody's on it AND not the active release" rule.
   */
  async getOldUpdatesCleanupCandidates ({ project, olderThanDays = 30 }) {
    if (!project) throw new Err.BadRequest('Missing project')

    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
    const cleanable = await this.app.service('uploads').find({
      query: { project, status: { $ne: 'released' } }
    })

    const candidates = []
    let totalBytes = 0

    for (const up of cleanable) {
      // (1) age gate — skip uploads created more recently than the window.
      const createdAt = up.createdAt ? new Date(up.createdAt) : null
      if (!createdAt || createdAt > cutoff) continue

      // (2) skip if anyone is still on this updateId right now (only
      // meaningful if the upload actually has an updateId — e.g. a 'ready'
      // upload that was never released still gets one assigned on extract).
      if (up.updateId) {
        const activeNow = await this.app.service('clients').find({
          query: { currentUpdate: up.updateId, $limit: 1 }
        })
        const stillActive = (activeNow?.data || activeNow || []).length > 0
        if (stillActive) continue
      }

      // Compute size with the SAME logic as the update info card. On failure
      // leave the field null so the UI can show "—" rather than a wrong number.
      let sizeBytes = null
      try {
        const sizes = await this.getUpdateSizes({ query: { uploadId: up._id } })
        sizeBytes = sizes.total
      } catch (e) { /* leave sizeBytes = null */ }

      candidates.push({
        _id: up._id,
        updateId: up.updateId,
        version: up.version,
        releaseChannel: up.releaseChannel,
        gitCommit: up.gitCommit,
        status: up.status,
        createdAt: up.createdAt,
        sizeBytes
      })
      if (typeof sizeBytes === 'number') totalBytes += sizeBytes
    }

    return {
      project,
      olderThanDays,
      count: candidates.length,
      totalBytes,
      candidates
    }
  }

  async cleanupOldUpdates ({ project, olderThanDays = 30 }) {
    const { candidates, totalBytes } = await this.getOldUpdatesCleanupCandidates({ project, olderThanDays })
    let removed = 0
    const errors = []
    for (const c of candidates) {
      try {
        await this.deleteRelease({ uploadId: c._id })
        removed++
      } catch (e) {
        errors.push({ uploadId: c._id, error: e.message })
      }
    }
    return { removed, totalBytes, errors }
  }

  async getUpdateSizes ({ query }) {
    const uploadId = query?.uploadId
    if (!uploadId) throw new Err.BadRequest('Missing uploadId')

    const upload = await this.app.service('uploads').get(uploadId)
    if (!upload) throw new Err.NotFound('Upload not found')

    const result = {
      uploadId,
      zipBytes: Number(upload.size) || 0,
      bundleByPlatform: { ios: 0, android: 0 },
      assetsBytes: 0,
      assetsCount: 0,
      assetsSharedCount: 0,
      assetsIosOnlyCount: 0,
      assetsAndroidOnlyCount: 0,
      total: 0
    }

    let metadata = null
    try { ({ metadataJson: metadata } = getMetadataSync(upload)) } catch (e) { /* no metadata */ }

    if (metadata?.fileMetadata && upload.path) {
      // Bundles are platform-specific (different Hermes bytecode targets).
      for (const platform of ['ios', 'android']) {
        const platformMeta = metadata.fileMetadata[platform]
        if (!platformMeta?.bundle) continue
        try {
          const bundleFull = path.join(upload.path, platformMeta.bundle)
          result.bundleByPlatform[platform] = fs.statSync(bundleFull).size
        } catch (e) { /* missing */ }
      }

      // Assets are mostly shared across platforms (MD5-keyed by content).
      // Dedupe by path so the same file doesn't get counted twice.
      const iosPaths = new Set((metadata.fileMetadata.ios?.assets || []).map(a => a.path))
      const androidPaths = new Set((metadata.fileMetadata.android?.assets || []).map(a => a.path))
      const allPaths = new Set([...iosPaths, ...androidPaths])

      result.assetsCount = allPaths.size
      result.assetsSharedCount = [...iosPaths].filter(p => androidPaths.has(p)).length
      result.assetsIosOnlyCount = [...iosPaths].filter(p => !androidPaths.has(p)).length
      result.assetsAndroidOnlyCount = [...androidPaths].filter(p => !iosPaths.has(p)).length

      for (const assetPath of allPaths) {
        try {
          const full = path.join(upload.path, assetPath)
          result.assetsBytes += fs.statSync(full).size
        } catch (e) { /* missing */ }
      }
    }

    result.total =
      result.zipBytes +
      result.bundleByPlatform.ios + result.bundleByPlatform.android +
      result.assetsBytes

    return result
  }

  async get (id, params) {
    if (id === 'generateSelfSigned') return generateSelfSigned()
    if (id === 'getUploadKey') return ({ uploadKey: this.app.get('uploadKey') })
    if (id === 'updateSizes') return this.getUpdateSizes(params || {})
    if (id === 'oldUpdatesCleanupCandidates') {
      return this.getOldUpdatesCleanupCandidates(params?.query || {})
    }
    throw new Err.BadRequest('Invalid request.')
  }
}

module.exports = {
  name: 'utils',
  createService: (options) => new Service(options),
  hooks: {
    before: {
      all: s.defaultSecurity(),
      find: [s.methodNotAllowed],
      get: [],
      create: [s.methodNotAllowed],
      update: [],
      patch: [s.methodNotAllowed],
      remove: [s.methodNotAllowed]
    },
    after: {
      all: [],
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: []
    }
  }
}

module.exports.Service = Service
