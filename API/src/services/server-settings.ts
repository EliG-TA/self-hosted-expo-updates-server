import type { MongoDBAdapterOptions } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'
import type { Db } from 'mongodb'

import s from '../hooks/security'
// Import the logger from its leaf module, NOT the '../modules' barrel, to avoid
// the services/index ↔ modules import cycle (see bsdiff-settings for context).
import logger from '../modules/logger'
import type { AppLike, HookContextLike, UnknownRecord } from '../types'

// Global web-app settings (single-process, server-wide). NOT tied to any one
// feature — currently just the disk-usage cache window. Stored as ONE doc so
// values can be read live without a restart.
export interface ServerSettings {
  diskUsageCacheMs: number // how long the /disk-usage result is cached in-process
}

export const SERVER_SETTINGS_DEFAULTS: ServerSettings = {
  diskUsageCacheMs: 30 * 1000, // 30s
}

const DOC_ID = 'global'

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export const clampServerSettings = (input: Partial<ServerSettings>): ServerSettings => {
  const d = SERVER_SETTINGS_DEFAULTS
  return {
    diskUsageCacheMs: clampInt(input.diskUsageCacheMs, 1000, 60 * 60 * 1000, d.diskUsageCacheMs),
  }
}

class ServerSettingsService extends MongoDBService {
  app: AppLike
  Model: ReturnType<Db['collection']> | undefined

  constructor(options?: Partial<MongoDBAdapterOptions>) {
    super({ Model: undefined, ...options })
  }

  setup(app: AppLike) {
    this.app = app
    ;(app.get('mongoClient') as Promise<Db>).then(async (db) => {
      const collection = db.collection('server-settings')
      this.options.Model = collection
      this.Model = collection
      try {
        await collection.updateOne(
          { _id: DOC_ID as unknown as import('mongodb').ObjectId },
          { $setOnInsert: { ...SERVER_SETTINGS_DEFAULTS, createdAt: new Date() } },
          { upsert: true },
        )
      } catch (e) {
        logger.warn('server-settings: failed to seed defaults', {
          error: e instanceof Error ? e.message : String(e),
        })
      }
    })
  }
}

// Live read used by disk-usage on each request. Reads the raw collection to skip
// hooks/auth and always returns clamped, defaulted values — never throws.
export const getServerSettings = async (app: AppLike): Promise<ServerSettings> => {
  try {
    const model = app.service('server-settings').Model
    if (model) {
      const doc = (await model.findOne({ _id: DOC_ID })) as Partial<ServerSettings> | null
      if (doc) return clampServerSettings(doc)
    }
  } catch (e) {
    logger.warn('server-settings: read failed, using defaults', {
      error: e instanceof Error ? e.message : String(e),
    })
  }
  return { ...SERVER_SETTINGS_DEFAULTS }
}

const createService = (defaultOptions?: Partial<MongoDBAdapterOptions>) =>
  new ServerSettingsService({ ...defaultOptions, disableObjectify: true })

// Merge the (possibly partial) patch over current values, then clamp — so a
// partial patch can't reset untouched fields to defaults.
const sanitizeOnPatch = async (context: HookContextLike) => {
  const current = ((await context.service.Model?.findOne({ _id: DOC_ID })) ||
    SERVER_SETTINGS_DEFAULTS) as Partial<ServerSettings>
  const incoming = (context.data as Partial<ServerSettings>) || {}
  context.data = { ...clampServerSettings({ ...current, ...incoming }), updatedAt: new Date() } as UnknownRecord
  return context
}

const broadcastChange = (context: HookContextLike) => {
  context.app.service('messages').create({ action: 'update', keys: ['serverSettings'] })
  return context
}

export default {
  name: 'server-settings',
  createService,
  hooks: {
    before: {
      all: s.defaultSecurity(),
      create: [s.externalMethodNotAllowed],
      update: [s.externalMethodNotAllowed],
      patch: [sanitizeOnPatch],
      remove: [s.externalMethodNotAllowed],
    },
    after: {
      patch: [broadcastChange],
    },
  },
}
