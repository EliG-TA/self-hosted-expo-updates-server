import { useEffect, useMemo, useState } from 'react'
import type { DataTableFilterMeta } from 'primereact/datatable'

import { useCQuery } from './QueryCache'

export interface LazyTableResult<T> {
  value: T[]
  totalRecords: number
  loading: boolean
  first: number
  rows: number
  sortField: string
  sortOrder: 1 | -1
  filters: DataTableFilterMeta
  onPage: (e: { first: number; rows: number }) => void
  onSort: (e: { sortField?: string; sortOrder?: number | null }) => void
  onFilter: (e: { filters: DataTableFilterMeta }) => void
}

// Drives a server-side paginated/sorted/filtered table backed by a QueryCache
// `*Page` query (service.get('page', { query })). All filters live in
// PrimeReact's `filters` model so they render INSIDE column headers
// (filterDisplay="row"): `enumFields` are multi-select columns (value array →
// server $in); `searchField` is a text-input column whose value (debounced)
// becomes the server `search`.
export function useLazyTable<T>(
  resource: 'patchJobsPage' | 'patchesPage' | 'patchPairsPage',
  base: Record<string, unknown>,
  opts: {
    enabled?: boolean
    rows?: number
    defaultSortField: string
    defaultSortOrder?: 1 | -1
    enumFields?: string[]
    searchField?: string
  },
): LazyTableResult<T> {
  const enumFields = opts.enumFields ?? []
  const searchField = opts.searchField

  const [first, setFirst] = useState(0)
  const [rows, setRows] = useState(opts.rows ?? 25)
  const [sortField, setSortField] = useState(opts.defaultSortField)
  const [sortOrder, setSortOrder] = useState<1 | -1>(opts.defaultSortOrder ?? -1)
  const [filters, setFilters] = useState<DataTableFilterMeta>(() => {
    const m: DataTableFilterMeta = {}
    for (const f of enumFields) m[f] = { value: null, matchMode: 'in' }
    if (searchField) m[searchField] = { value: null, matchMode: 'contains' }
    return m
  })

  const enumValues: Record<string, unknown[]> = {}
  for (const f of enumFields) {
    const v = (filters[f] as { value?: unknown } | undefined)?.value
    if (Array.isArray(v) && v.length) enumValues[f] = v
  }
  const enumKey = JSON.stringify(enumValues)

  // Debounce the free-text search so typing doesn't refetch on every keystroke.
  const rawSearch = searchField ? ((filters[searchField] as { value?: unknown } | undefined)?.value as string) || '' : ''
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(rawSearch)
      setFirst(0)
    }, 300)
    return () => clearTimeout(t)
  }, [rawSearch])

  const baseKey = JSON.stringify(base)
  const params = useMemo(
    () => ({ ...base, skip: first, limit: rows, sortField, sortOrder, filters: enumValues, search: search || undefined }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseKey, first, rows, sortField, sortOrder, enumKey, search],
  )

  const { data, isFetching } = useCQuery<{ data: T[]; total: number }>([resource, params], { enabled: opts.enabled })

  return {
    value: data?.data ?? [],
    totalRecords: data?.total ?? 0,
    loading: isFetching,
    first,
    rows,
    sortField,
    sortOrder,
    filters,
    onPage: (e) => {
      setFirst(e.first)
      setRows(e.rows)
    },
    onSort: (e) => {
      if (e.sortField) setSortField(e.sortField)
      setSortOrder(e.sortOrder === 1 ? 1 : e.sortOrder === -1 ? -1 : opts.defaultSortOrder ?? -1)
      setFirst(0)
    },
    onFilter: (e) => {
      setFilters(e.filters)
      setFirst(0)
    },
  }
}
