import type { MongoDBAdapterOptions } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'
import type { Db } from 'mongodb'

import error from '../hooks/error'
import s from '../hooks/security'
import { logger } from '../modules'
import type { AppLike, HookContextLike, UnknownRecord } from '../types'
import type { BsdiffSettings } from './bsdiff-settings'
import { clampBsdiffSettings } from './bsdiff-settings'
import { buildListQuery, idMatch } from './lib/list-query'

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

  // Apply the audit-log retention. `ttlDays === 0` means keep rows forever →
  // drop the TTL index. Otherwise size the `ttl_at` index: createIndex can't
  // change expireAfterSeconds on an existing index (it errors on option
  // mismatch), so we collMod an existing index and only createIndex when it's
  // missing. Called at boot (from the stored setting) and on every change.
  async applyTtl(ttlDays: number) {
    try {
      const db = (await this.app.get('mongoClient')) as Db
      const col = db.collection('patch-jobs')
      if (!ttlDays || ttlDays <= 0) {
        // No expiry: drop the TTL index if present (ignore "index not found").
        await col.dropIndex('ttl_at').catch(() => undefined)
        return
      }
      const expireAfterSeconds = Math.round(ttlDays * 24 * 60 * 60)
      try {
        await db.command({ collMod: 'patch-jobs', index: { name: 'ttl_at', expireAfterSeconds } })
      } catch (e) {
        // Index (or collection) not there yet → create it fresh.
        await col.createIndex({ at: 1 }, { expireAfterSeconds, name: 'ttl_at' })
      }
    } catch (e) {
      logger.warn('patch-jobs: failed to apply TTL', { error: e instanceof Error ? e.message : String(e) })
    }
  }

  setup(app: AppLike, path: string) {
    this.app = app
    ;(app.get('mongoClient') as Promise<Db>).then(async (db) => {
      const collection = db.collection('patch-jobs')
      this.options.Model = collection
      this.Model = collection
      try {
        await collection.createIndex({ project: 1, at: -1 })
        await collection.createIndex({ patchId: 1, at: -1 })
      } catch (e) {
        logger.warn('patch-jobs: failed to create indexes', { error: e instanceof Error ? e.message : String(e) })
      }
      // Size the TTL index from the stored setting (default 30d). Read the doc
      // straight from the DB — the bsdiff-settings service Model may not be
      // ready yet during parallel setup.
      try {
        const settingsDoc = await db.collection('bsdiff-settings').findOne({ _id: 'global' as never })
        const { patchJobsTtlDays } = clampBsdiffSettings((settingsDoc || {}) as unknown as Partial<BsdiffSettings>)
        await this.applyTtl(patchJobsTtlDays)
      } catch (e) {
        logger.warn('patch-jobs: failed to init TTL', { error: e instanceof Error ? e.message : String(e) })
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
