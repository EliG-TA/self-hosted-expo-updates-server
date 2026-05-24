const s = require('../hooks/security')
const Err = require('@feathersjs/errors')
const { generateSelfSigned } = require('../modules/expo/certs')
const { getMetadataSync } = require('../modules/expo/helpers')
const fs = require('fs')
const path = require('path')

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

    throw new Err.BadRequest('Invalid request.')
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
