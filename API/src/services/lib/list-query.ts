import { ObjectId } from 'mongodb'

import type { UnknownRecord } from '../../types'

// ObjectId-valued reference fields (pairId, patchId, *UploadId) arrive from the
// client as plain strings, but raw-collection queries don't coerce non-_id
// fields like the feathers adapter does. Match both representations.
export const idMatch = (v: unknown) =>
  typeof v === 'string' && ObjectId.isValid(v) ? { $in: [v, new ObjectId(v)] } : v

// Turns untrusted client list params into a safe Mongo query. Field names for
// sort and filters are matched against per-call whitelists (never taken raw
// from the client), and the free-text search is regex-escaped — so this can't
// be used for query injection or to sort/scan on an unindexed field.

export interface ListQueryInput {
  skip?: unknown
  limit?: unknown
  sortField?: unknown
  sortOrder?: unknown // 1 = asc, -1 = desc (PrimeReact convention)
  filters?: UnknownRecord // field -> value | value[]  (enum multi-select → $in)
  search?: unknown // free text matched against searchFields
}

export interface ListQueryConfig {
  base?: UnknownRecord // always-applied scalar constraints (e.g. project)
  sortable: string[]
  defaultSort: [string, 1 | -1]
  enumFilters: string[]
  searchFields: string[]
  maxLimit?: number
}

export interface BuiltListQuery {
  filter: UnknownRecord
  sort: Record<string, 1 | -1>
  skip: number
  limit: number
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const toInt = (value: unknown, fallback: number) => {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) ? n : fallback
}

export const buildListQuery = (input: ListQueryInput, cfg: ListQueryConfig): BuiltListQuery => {
  const maxLimit = cfg.maxLimit ?? 100
  const limit = Math.min(maxLimit, Math.max(1, toInt(input.limit, 25)))
  const skip = Math.max(0, toInt(input.skip, 0))

  const sortField = typeof input.sortField === 'string' && cfg.sortable.includes(input.sortField) ? input.sortField : cfg.defaultSort[0]
  const sortOrder = toInt(input.sortOrder, cfg.defaultSort[1]) >= 0 ? 1 : -1
  const sort: Record<string, 1 | -1> = { [sortField]: sortOrder }

  const filter: UnknownRecord = { ...(cfg.base || {}) }

  const rawFilters = (input.filters && typeof input.filters === 'object' ? input.filters : {}) as UnknownRecord
  for (const field of cfg.enumFilters) {
    const v = rawFilters[field]
    const values = Array.isArray(v) ? v.filter((x) => x != null && x !== '') : v != null && v !== '' ? [v] : []
    if (values.length) filter[field] = { $in: values }
  }

  if (typeof input.search === 'string' && input.search.trim() && cfg.searchFields.length) {
    const rx = { $regex: escapeRegex(input.search.trim()), $options: 'i' }
    filter.$or = cfg.searchFields.map((f) => ({ [f]: rx }))
  }

  return { filter, sort, skip, limit }
}
