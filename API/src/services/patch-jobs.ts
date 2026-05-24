const { MongoDBService } = require('@feathersjs/mongodb')
const s = require('../hooks/security')
const error = require('../hooks/error')
const { logger } = require('../modules')

const TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days

class PatchJobsService extends MongoDBService {
  setup (app, path) {
    this.app = app
    app.get('mongoClient').then(async (db) => {
      const collection = db.collection('patch-jobs')
      this.options.Model = collection
      try {
        await collection.createIndex(
          { startedAt: 1 },
          { expireAfterSeconds: TTL_SECONDS, name: 'ttl_startedAt' }
        )
        await collection.createIndex({ project: 1, startedAt: -1 })
        await collection.createIndex({ patchId: 1 })
      } catch (e) {
        logger.warn('patch-jobs: failed to create indexes', { error: e.message })
      }
    })
  }
}

const createService = (defaultOptions) => new PatchJobsService(defaultOptions)

const broadcastJob = (context) => {
  context.app.service('messages').create({ action: 'update', keys: ['patchJobs'] })
  return context
}

module.exports = {
  name: 'patch-jobs',
  createService,
  hooks: {
    before: {
      all: s.defaultSecurity(),
      find: [],
      get: [],
      create: [],
      update: [s.methodNotAllowed],
      patch: [s.methodNotAllowed],
      remove: []
    },
    after: {
      all: [],
      find: [],
      get: [],
      create: [broadcastJob],
      update: [],
      patch: [],
      remove: [broadcastJob]
    },
    error
  }
}
