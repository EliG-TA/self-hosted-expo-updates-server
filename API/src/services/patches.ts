import type { Db } from 'mongodb'
import type { MongoDBAdapterOptions } from '@feathersjs/mongodb'
import type { AppLike, HookContextLike, PatchRecord, UnknownRecord } from '../types'

import { MongoDBService } from '@feathersjs/mongodb'
import error from '../hooks/error'
import s from '../hooks/security'
import { deletePatchFile } from '../modules/expo/patch'
import { logger } from '../modules'

class PatchesService extends MongoDBService {
  app: AppLike

  constructor (options?: Partial<MongoDBAdapterOptions>) {
    super({ Model: undefined, ...options })
  }

  setup (app: AppLike, path: string) {
    this.app = app
    ;(app.get('mongoClient') as Promise<Db>).then(async (db) => {
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
        logger.warn('patches: failed to create indexes', { error: e instanceof Error ? e.message : String(e) })
      }
    })
  }

  async purgeAll ({ project }: { project?: string }) {
    const query = project ? { project } : {}
    const found = await this.find({ query: { ...query, $limit: 10000 } })
    const all = Array.isArray(found) ? found as PatchRecord[] : ((found as { data?: PatchRecord[] })?.data || [])
    let removed = 0
    for (const p of all) {
      try {
        deletePatchFile(p.path)
        await this.remove(p._id)
        removed++
      } catch (e) {
        logger.warn('patches.purgeAll: failed to remove', { id: p._id, error: e instanceof Error ? e.message : String(e) })
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

const createService = (defaultOptions?: Partial<MongoDBAdapterOptions>) => new PatchesService({ ...defaultOptions, multi: true })

const removePatchFileBeforeDelete = async (context: HookContextLike) => {
  if (context.id) {
    try {
      const doc = await context.service.get(context.id) as PatchRecord
      if (doc?.path) deletePatchFile(doc.path)
    } catch (e) { /* already gone */ }
  }
  return context
}

const broadcastChange = (context: HookContextLike) => {
  context.app.service('messages').create({ action: 'update', keys: ['patches', 'diskUsage'] })
  return context
}

const purgeAllMethod = async (context: HookContextLike) => {
  if (context.id === 'purgeAll') {
    context.result = await context.service.purgeAll?.(context.data || {})
  }
  return context
}

export default {
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
