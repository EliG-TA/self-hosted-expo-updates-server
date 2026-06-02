import type { MongoDBAdapterOptions } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'
import type { Db } from 'mongodb'

import error from '../hooks/error'
import s from '../hooks/security'
import { logger } from '../modules'
import type { AppLike, HookContextLike, UnknownRecord } from '../types'
import { buildListQuery, idMatch } from './lib/list-query'

const TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days

// Append-only event log of state changes on `patches`. One row per event:
//   - 'created'         — a new patch row was enqueued
//   - 'status-changed'  — patches.status went prev → next
//   - 'removed'         — patch row was deleted (with reason: purge | cleanup-obsolete | upload-removed | manual)
// Rows are written automatically by hooks on the `patches` service so audit
// coverage stays exhaustive without scattering log() calls through the code.
class PatchJobsService extends MongoDBService {
  app: AppLike
  Model: ReturnType<Db['collection']> | undefined

  constructor(options?: Partial<MongoDBAdapterOptions>) {
    super({ Model: undefined, ...options })
  }

  // Server-side page for the Job History table: filter + sort + paginate with
  // a total count, all whitelisted (see buildListQuery). Returns { data, total }.
  async page(query: UnknownRecord = {}) {
    const col = this.Model
    if (!col) return { data: [], total: 0 }
    const base: UnknownRecord = {}
    // Match the old client filter: this project's rows plus project-less ones.
    if (query.project) base.project = { $in: [query.project, null] }
    // Scope to one patch / one from→to pair (the detail dialog fetches a
    // single pair's combined history across platforms this way).
    if (query.patchId) base.patchId = idMatch(query.patchId)
    if (query.pairId) base.pairId = idMatch(query.pairId)
    if (query.fromUpdateId) base.fromUpdateId = query.fromUpdateId
    if (query.toUpdateId) base.toUpdateId = query.toUpdateId
    const { filter, sort, skip, limit } = buildListQuery(query, {
      base,
      sortable: ['at', 'event', 'status', 'platform', 'attempts', 'durationMs', 'size', 'fromUpdateId', 'toUpdateId'],
      defaultSort: ['at', -1],
      enumFilters: ['event', 'status', 'platform'],
      searchFields: ['fromUpdateId', 'toUpdateId'],
    })
    const [data, total] = await Promise.all([
      col.find(filter).sort(sort).skip(skip).limit(limit).toArray(),
      col.countDocuments(filter),
    ])
    return { data, total }
  }

  setup(app: AppLike, path: string) {
    this.app = app
    ;(app.get('mongoClient') as Promise<Db>).then(async (db) => {
      const collection = db.collection('patch-jobs')
      this.options.Model = collection
      this.Model = collection
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
  context.app.service('messages').create({ action: 'update', keys: ['patchJobs', 'patchJobsPage'] })
  return context
}

// RPC-over-feathers: `get('page', { query })` → server-side paginated list.
const customGetActions = async (context: HookContextLike) => {
  if (context.id === 'page') {
    context.result = await context.service.page?.((context.params?.query as UnknownRecord) || {})
  }
  return context
}

export default {
  name: 'patch-jobs',
  createService,
  hooks: {
    before: {
      all: s.defaultSecurity(),
      find: [],
      get: [customGetActions],
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
