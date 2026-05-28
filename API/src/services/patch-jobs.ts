import type { MongoDBAdapterOptions } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'
import type { Db } from 'mongodb'

import error from '../hooks/error'
import s from '../hooks/security'
import { logger } from '../modules'
import type { AppLike, HookContextLike } from '../types'

const TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days

// Append-only event log of state changes on `patches`. One row per event:
//   - 'created'         — a new patch row was enqueued
//   - 'status-changed'  — patches.status went prev → next
//   - 'removed'         — patch row was deleted (with reason: purge | cleanup-obsolete | upload-removed | manual)
// Rows are written automatically by hooks on the `patches` service so audit
// coverage stays exhaustive without scattering log() calls through the code.
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
        await collection.createIndex({ at: 1 }, { expireAfterSeconds: TTL_SECONDS, name: 'ttl_at' })
        await collection.createIndex({ project: 1, at: -1 })
        await collection.createIndex({ patchId: 1, at: -1 })
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
      // Internal-only: rows are written by `patches` service hooks. Forbid
      // external clients from spoofing audit entries.
      create: [s.externalMethodNotAllowed],
      update: [s.methodNotAllowed],
      patch: [s.methodNotAllowed],
      remove: [s.externalMethodNotAllowed],
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
