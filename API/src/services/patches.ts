// @ts-nocheck
const { MongoDBService } = require('@feathersjs/mongodb')
const s = require('../hooks/security')
const error = require('../hooks/error')
const { deletePatchFile } = require('../modules/expo/patch')
const { logger } = require('../modules')

class PatchesService extends MongoDBService {
  setup (app, path) {
    this.app = app
    app.get('mongoClient').then(async (db) => {
      const collection = db.collection('patches')
      this.options.Model = collection
      try {
        await collection.createIndex(
          { fromUpdateId: 1, toUpdateId: 1, platform: 1 },
          { unique: true, name: 'uniq_from_to_platform' }
        )
        await collection.createIndex({ project: 1, status: 1 })
        await collection.createIndex({ toUploadId: 1 })
        await collection.createIndex({ fromUploadId: 1 })
        await collection.createIndex({ markedObsoleteAt: 1 })
      } catch (e) {
        logger.warn('patches: failed to create indexes', { error: e.message })
      }
    })
  }

  async purgeAll ({ project }) {
    const query = project ? { project } : {}
    const all = await this.find({ query: { ...query, $limit: 10000 } })
    let removed = 0
    for (const p of all) {
      try {
        deletePatchFile(p.path)
        await this.remove(p._id)
        removed++
      } catch (e) {
        logger.warn('patches.purgeAll: failed to remove', { id: p._id, error: e.message })
      }
    }
    await this.app.service('patch-jobs').create({
      type: 'purge',
      status: 'success',
      project: project || null,
      reason: 'manual-purge',
      startedAt: new Date(),
      completedAt: new Date(),
      durationMs: 0,
      patchesRemoved: removed
    })
    this.app.service('messages').create({ action: 'update', keys: ['patches', 'patchJobs', 'diskUsage'] })
    return { removed }
  }
}

const createService = (defaultOptions) => new PatchesService({ ...defaultOptions, multi: true })

const removePatchFileBeforeDelete = async (context) => {
  if (context.id) {
    try {
      const doc = await context.service.get(context.id)
      if (doc?.path) deletePatchFile(doc.path)
    } catch (e) { /* already gone */ }
  }
  return context
}

const broadcastChange = (context) => {
  context.app.service('messages').create({ action: 'update', keys: ['patches', 'diskUsage'] })
  return context
}

const purgeAllMethod = async (context) => {
  if (context.id === 'purgeAll') {
    context.result = await context.service.purgeAll(context.data || {})
  }
  return context
}

module.exports = {
  name: 'patches',
  createService,
  hooks: {
    before: {
      all: s.defaultSecurity(),
      find: [],
      get: [],
      create: [s.methodNotAllowed],
      update: [purgeAllMethod],
      patch: [s.methodNotAllowed],
      remove: [removePatchFileBeforeDelete]
    },
    after: {
      all: [],
      find: [],
      get: [],
      create: [broadcastChange],
      update: [],
      patch: [broadcastChange],
      remove: [broadcastChange]
    },
    error
  }
}
