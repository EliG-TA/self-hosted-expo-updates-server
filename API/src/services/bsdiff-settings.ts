import type { MongoDBAdapterOptions } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'
import type { Db } from 'mongodb'

import s from '../hooks/security'
// Import the logger from its leaf module, NOT the '../modules' barrel: the
// barrel pulls in feathers.config → services/index, which would form an import
// cycle (services/index → bsdiff-settings → modules → … → services/index) and
// hit a TDZ error on the `services` array.
import logger from '../modules/logger'
import type { AppLike, HookContextLike, UnknownRecord } from '../types'

// Global (single-process) bsdiff worker/generation tunables. Stored as ONE doc
// so the worker can read live values each tick — changing them takes effect
// without a restart. NOT per-app: there is one in-process worker loop.
export interface BsdiffSettings {
  tickIntervalMs: number // worker poll cadence
  cooldownMs: number // wait before retrying a failed patch
  staleInProgressMs: number // reclaim a generating/validating patch stuck this long
  concurrency: number // max patches generated in parallel
  patchBenefitRatio: number // patch must be < ratio×target, else 'not-beneficial'
}

export const BSDIFF_SETTINGS_DEFAULTS: BsdiffSettings = {
  tickIntervalMs: 5000,
  cooldownMs: 4 * 60 * 60 * 1000, // 4h
  staleInProgressMs: 5 * 60 * 1000, // 5min
  concurrency: 1,
  patchBenefitRatio: 0.75,
}

const DOC_ID = 'global'

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
const clampFloat = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

// Safety net independent of the UI's min/max. These bounds guard the host:
// a sub-second tick busy-spins the loop; a huge concurrency OOMs (bsdiff uses
// ~50MB RAM per 10MB bundle); too-short stale window can reclaim a still-running
// generation. Tune the numbers here to match your deployment hardware.
export const clampBsdiffSettings = (input: Partial<BsdiffSettings>): BsdiffSettings => {
  const d = BSDIFF_SETTINGS_DEFAULTS
  return {
    tickIntervalMs: clampInt(input.tickIntervalMs, 500, 600_000, d.tickIntervalMs),
    cooldownMs: clampInt(input.cooldownMs, 0, 7 * 24 * 60 * 60 * 1000, d.cooldownMs),
    staleInProgressMs: clampInt(input.staleInProgressMs, 30_000, 24 * 60 * 60 * 1000, d.staleInProgressMs),
    concurrency: clampInt(input.concurrency, 1, 8, d.concurrency),
    patchBenefitRatio: clampFloat(input.patchBenefitRatio, 0.05, 1, d.patchBenefitRatio),
  }
}

class BsdiffSettingsService extends MongoDBService {
  app: AppLike
  // Synchronous raw-collection handle for the worker hot path (see PatchesService).
  Model: ReturnType<Db['collection']> | undefined

  constructor(options?: Partial<MongoDBAdapterOptions>) {
    super({ Model: undefined, ...options })
  }

  setup(app: AppLike) {
    this.app = app
    ;(app.get('mongoClient') as Promise<Db>).then(async (db) => {
      const collection = db.collection('bsdiff-settings')
      this.options.Model = collection
      this.Model = collection
      try {
        // Seed the singleton with defaults on first boot; never overwrite an
        // admin's stored values on later boots ($setOnInsert).
        await collection.updateOne(
          { _id: DOC_ID as unknown as import('mongodb').ObjectId },
          { $setOnInsert: { ...BSDIFF_SETTINGS_DEFAULTS, createdAt: new Date() } },
          { upsert: true },
        )
      } catch (e) {
        logger.warn('bsdiff-settings: failed to seed defaults', {
          error: e instanceof Error ? e.message : String(e),
        })
      }
    })
  }
}

// Live read used by the worker (each tick) and the asset endpoint (rare
// failed-patch branch). Reads the raw collection to skip hooks/auth/pagination
// and always returns clamped, defaulted values — never throws.
export const getBsdiffSettings = async (app: AppLike): Promise<BsdiffSettings> => {
  try {
    const model = app.service('bsdiff-settings').Model
    if (model) {
      const doc = (await model.findOne({ _id: DOC_ID })) as Partial<BsdiffSettings> | null
      if (doc) return clampBsdiffSettings(doc)
    }
  } catch (e) {
    logger.warn('bsdiff-settings: read failed, using defaults', {
      error: e instanceof Error ? e.message : String(e),
    })
  }
  return { ...BSDIFF_SETTINGS_DEFAULTS }
}

const createService = (defaultOptions?: Partial<MongoDBAdapterOptions>) =>
  new BsdiffSettingsService({ ...defaultOptions, disableObjectify: true })

// Merge the (possibly partial) patch over the current stored values, then
// clamp — so a partial patch can't reset untouched fields to defaults.
const sanitizeOnPatch = async (context: HookContextLike) => {
  const current = ((await context.service.Model?.findOne({ _id: DOC_ID })) ||
    BSDIFF_SETTINGS_DEFAULTS) as Partial<BsdiffSettings>
  // Stash the pre-change ratio so the after-hook can detect a real change and
  // reconcile existing patches (see reconcileIfRatioChanged).
  const params = (context.params || (context.params = {})) as UnknownRecord
  params._prevBenefitRatio = current.patchBenefitRatio
  const incoming = (context.data as Partial<BsdiffSettings>) || {}
  context.data = { ...clampBsdiffSettings({ ...current, ...incoming }), updatedAt: new Date() } as UnknownRecord
  return context
}

const broadcastChange = (context: HookContextLike) => {
  context.app.service('messages').create({ action: 'update', keys: ['bsdiffSettings'] })
  return context
}

// A benefitRatio change must take effect on EXISTING patches right away, not
// only on the next generation: re-judge ready ↔ not-beneficial. Fire-and-forget
// so the settings save responds immediately (reconcile can touch many patches).
const reconcileIfRatioChanged = (context: HookContextLike) => {
  const prev = (context.params as UnknownRecord | undefined)?._prevBenefitRatio as number | undefined
  const next = (context.result as Partial<BsdiffSettings> | undefined)?.patchBenefitRatio
  if (typeof next === 'number' && prev !== next) {
    void Promise.resolve(context.app.service('patches').reconcileBenefitRatio?.(next)).catch((e) =>
      logger.warn('bsdiff-settings: patch reconcile failed', {
        error: e instanceof Error ? e.message : String(e),
      }),
    )
  }
  return context
}

export default {
  name: 'bsdiff-settings',
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
      patch: [broadcastChange, reconcileIfRatioChanged],
    },
  },
}
