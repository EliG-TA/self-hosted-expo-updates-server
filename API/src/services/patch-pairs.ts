import type { MongoDBAdapterOptions } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'
import type { Db } from 'mongodb'

import error from '../hooks/error'
import s from '../hooks/security'
import { logger } from '../modules'
import type { AppLike, HookContextLike, UnknownRecord } from '../types'
import { idMatch } from './lib/list-query'

// A `patch-pair` is the logical from→to transition. Per-platform `patches`
// reference it via `pairId`; `patch-jobs` history rows carry `pairId` too. The
// pair stores identity only — status/sizes are rolled up on the fly from its
// patches (see page()), so there is no denormalized state to keep in sync.
interface EnsurePairInput {
  project?: string
  version?: string
  releaseChannel?: string
  fromUpdateId?: string
  toUpdateId?: string
  fromUploadId?: unknown
  toUploadId?: unknown
}

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const toInt = (v: unknown, fallback: number) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) ? n : fallback
}
const asArray = (v: unknown) =>
  Array.isArray(v) ? v.filter((x) => x != null && x !== '') : v != null && v !== '' ? [v] : []

// Sort keys exposed to the table → aggregation field (whitelist).
// Per-pair aggregates (`totalSize`, `avgRatio`, `totalServed`,
// `latestCreatedAt`) come from $addFields below — sorting by them is
// equivalent to sorting pairs by their summary row.
const SORT_FIELDS: Record<string, string> = {
  latest: 'latestCreatedAt',
  latestCreatedAt: 'latestCreatedAt',
  totalSize: 'totalSize',
  avgRatio: 'avgRatio',
  totalServed: 'totalServed',
  createdAt: 'createdAt',
  fromUpdateId: 'fromUpdateId',
  toUpdateId: 'toUpdateId',
}

class PatchPairsService extends MongoDBService {
  app: AppLike
  Model: ReturnType<Db['collection']> | undefined

  constructor(options?: Partial<MongoDBAdapterOptions>) {
    super({ Model: undefined, ...options })
  }

  // Upsert the pair for a from→to (called from the patches before.create hook
  // so both the asset endpoint and manual enqueue create pairs transparently).
  // Identity is set once; only updatedAt changes on later patches.
  async ensure(data: EnsurePairInput) {
    const col = this.Model
    if (!col || !data.fromUpdateId || !data.toUpdateId) return null
    const now = new Date()
    const res = await col.findOneAndUpdate(
      { fromUpdateId: data.fromUpdateId, toUpdateId: data.toUpdateId },
      {
        $setOnInsert: {
          project: data.project,
          version: data.version,
          releaseChannel: data.releaseChannel,
          fromUpdateId: data.fromUpdateId,
          toUpdateId: data.toUpdateId,
          fromUploadId: data.fromUploadId,
          toUploadId: data.toUploadId,
          createdAt: now,
        },
        $set: { updatedAt: now },
      },
      { upsert: true, returnDocument: 'after' },
    )
    return (res as UnknownRecord | null)?._id ?? null
  }

  // Remove pairs that have no patches left (called after the uploads cascade
  // deletes patches) so the table doesn't show empty pairs.
  async pruneEmpty() {
    const col = this.Model
    if (!col) return { removed: 0 }
    const orphans = await col
      .aggregate([
        { $lookup: { from: 'patches', localField: '_id', foreignField: 'pairId', as: 'p' } },
        { $match: { p: { $size: 0 } } },
        { $project: { _id: 1 } },
      ])
      .toArray()
    let removed = 0
    for (const o of orphans) {
      await col.deleteOne({ _id: (o as UnknownRecord)._id as never })
      removed++
    }
    return { removed }
  }

  // Server-side page for the pairs table: one row per from→to, with its
  // per-platform patches embedded and rolled-up totals — filter/sort/paginate
  // by pair, all whitelisted. Returns { data, total }.
  async page(query: UnknownRecord = {}) {
    const col = this.Model
    if (!col) return { data: [], total: 0 }

    const limit = Math.min(100, Math.max(1, toInt(query.limit, 25)))
    const skip = Math.max(0, toInt(query.skip, 0))
    const sortField = SORT_FIELDS[String(query.sortField)] || 'latestCreatedAt'
    const sortOrder = toInt(query.sortOrder, -1) >= 0 ? 1 : -1

    const preMatch: UnknownRecord = {}
    if (query.project) preMatch.project = query.project
    // Per-update directional scoping: incoming patches → toUploadId fixed,
    // outgoing → fromUploadId fixed. Stored as ObjectId; idMatch lets the
    // client pass either a string or an ObjectId.
    if (query.fromUploadId) preMatch.fromUploadId = idMatch(query.fromUploadId)
    if (query.toUploadId) preMatch.toUploadId = idMatch(query.toUploadId)
    if (typeof query.search === 'string' && query.search.trim()) {
      const rx = { $regex: escapeRegex(query.search.trim()), $options: 'i' }
      preMatch.$or = [{ fromUpdateId: rx }, { toUpdateId: rx }]
    }

    const filters = (query.filters && typeof query.filters === 'object' ? query.filters : {}) as UnknownRecord
    const statusSel = asArray(filters.status)
    const platformSel = asArray(filters.platform)
    const postMatch: UnknownRecord = {}
    if (statusSel.length) postMatch['platforms.status'] = { $in: statusSel }
    if (platformSel.length) postMatch['platforms.platform'] = { $in: platformSel }

    // Date-range filter on the synthetic `latestCreatedAt` (newest patch in
    // the pair). Filters by pair, not individual platform — consistent with
    // pagination being per-pair. From/to are inclusive; the client snaps to
    // start-of-day / end-of-day before sending.
    const dateRanges = (
      query.dateRanges && typeof query.dateRanges === 'object' ? query.dateRanges : {}
    ) as UnknownRecord
    const createdRange = dateRanges.createdAt as { from?: unknown; to?: unknown } | undefined
    if (createdRange && typeof createdRange === 'object') {
      const cond: UnknownRecord = {}
      if (typeof createdRange.from === 'string' && createdRange.from) {
        const d = new Date(createdRange.from)
        if (!isNaN(d.getTime())) cond.$gte = d
      }
      if (typeof createdRange.to === 'string' && createdRange.to) {
        const d = new Date(createdRange.to)
        if (!isNaN(d.getTime())) cond.$lte = d
      }
      if (Object.keys(cond).length) postMatch.latestCreatedAt = cond
    }

    const pipeline: UnknownRecord[] = [
      { $match: preMatch },
      { $lookup: { from: 'patches', localField: '_id', foreignField: 'pairId', as: 'platforms' } },
      {
        $addFields: {
          totalSize: { $sum: '$platforms.size' },
          totalServed: { $sum: '$platforms.servedCount' },
          // "Last updated" semantically — prefers `completedAt` (set when
          // the worker finishes) and falls back to `createdAt` for pending
          // patches. Need `$map` over the platforms array because $ifNull
          // works on scalars, not on the implicit array path expansion of
          // `$platforms.completedAt`.
          latestCreatedAt: {
            $max: {
              $map: {
                input: '$platforms',
                as: 'p',
                in: { $ifNull: ['$$p.completedAt', '$$p.createdAt'] },
              },
            },
          },
          // Average compression ratio across the pair's platforms. Skips
          // null/undefined entries because $avg returns null when ALL inputs
          // are null — that null is then sortable (nulls land at one end).
          avgRatio: { $avg: '$platforms.compressionRatio' },
        },
      },
      ...(Object.keys(postMatch).length ? [{ $match: postMatch }] : []),
      { $sort: { [sortField]: sortOrder, _id: 1 } },
      { $facet: { data: [{ $skip: skip }, { $limit: limit }], total: [{ $count: 'n' }] } },
    ]

    const [res] = (await col.aggregate(pipeline).toArray()) as Array<{ data?: unknown[]; total?: Array<{ n: number }> }>
    return { data: res?.data || [], total: res?.total?.[0]?.n || 0 }
  }

  setup(app: AppLike, path: string) {
    this.app = app
    ;(app.get('mongoClient') as Promise<Db>).then(async (db) => {
      const collection = db.collection('patch-pairs')
      this.options.Model = collection
      this.Model = collection
      try {
        await collection.createIndex({ fromUpdateId: 1, toUpdateId: 1 }, { unique: true, name: 'uniq_from_to' })
        await collection.createIndex({ project: 1 })
      } catch (e) {
        logger.warn('patch-pairs: failed to create indexes', { error: e instanceof Error ? e.message : String(e) })
      }
    })
  }
}

const createService = (defaultOptions?: Partial<MongoDBAdapterOptions>) => new PatchPairsService(defaultOptions)

const customGetActions = async (context: HookContextLike) => {
  if (context.id === 'page') {
    context.result = await context.service.page?.((context.params?.query as UnknownRecord) || {})
  }
  return context
}

export default {
  name: 'patch-pairs',
  createService,
  hooks: {
    before: {
      all: s.defaultSecurity(),
      find: [],
      get: [customGetActions],
      create: [s.externalMethodNotAllowed],
      update: [s.externalMethodNotAllowed],
      patch: [s.externalMethodNotAllowed],
      remove: [s.externalMethodNotAllowed],
    },
    error,
  },
}
