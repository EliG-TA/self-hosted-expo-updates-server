import type { MongoDBAdapterOptions } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'
import type { Db } from 'mongodb'

import error from '../hooks/error'
import s from '../hooks/security'
import { logger } from '../modules'
import type { AppLike, HookContextLike } from '../types'

const TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days

class PatchJobsService extends MongoDBService {
  app: AppLike

  constructor(options?: Partial<MongoDBAdapterOptions>) {
    super({ Model: undefined, ...options })
  }

  setup(app: AppLike, path: string) {
    this.app = app
    ;(app.get('mongoClient') as Promise<Db>).then(async (db) => {
      const collection = db.collection('patch-jobs')
      this.options.Model = collection
      try {
        await collection.createIndex({ startedAt: 1 }, { expireAfterSeconds: TTL_SECONDS, name: 'ttl_startedAt' })
        await collection.createIndex({ project: 1, startedAt: -1 })
        await collection.createIndex({ patchId: 1 })
      } catch (e) {
        logger.warn('patch-jobs: failed to create indexes', { error: e instanceof Error ? e.message : String(e) })
      }
    })
  }
}

const createService = (defaultOptions?: Partial<MongoDBAdapterOptions>) => new PatchJobsService(defaultOptions)

const broadcastJob = (context: HookContextLike) => {
  context.app.service('messages').create({ action: 'update', keys: ['patchJobs'] })
  return context
}

export default {
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
      remove: [],
    },
    after: {
      all: [],
      find: [],
      get: [],
      create: [broadcastJob],
      update: [],
      patch: [],
      remove: [broadcastJob],
    },
    error,
  },
}
