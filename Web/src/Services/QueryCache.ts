import type { QueryKey, UseQueryResult } from '@tanstack/react-query'
import { keepPreviousData, QueryClient, useQuery } from '@tanstack/react-query'

import type { DynamicData, QueryKeyValue } from '../types'
import { FC } from './FeathersClient'

const time = {
  seconds: 1000,
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
}

const queryConfig = {
  rare: {
    staleTime: 1 * time.hours,
    gcTime: 2 * time.hours,
    // Preserve last data during refetch so paginators/sorts don't reset
    // and collapsed/expanded cards don't flicker on background refresh.
    placeholderData: keepPreviousData,
  },
  frequent: {
    staleTime: 5 * time.minutes,
    gcTime: 10 * time.minutes,
    placeholderData: keepPreviousData,
  },
  autoFetchFrequent: {
    staleTime: 3 * time.minutes,
    gcTime: 5 * time.minutes,
    refetchInterval: 30 * time.seconds,
    placeholderData: keepPreviousData,
  },
}

export const queryClient = new QueryClient()

const asQueryKey = (queryKey: QueryKeyValue): QueryKey => (Array.isArray(queryKey) ? [...queryKey] : [queryKey])

type AppQuery = {
  config: Record<string, unknown>
  queryFn: (...args: unknown[]) => Promise<unknown> | unknown
  defaultKeys?: unknown[]
  noInitalPrefetch?: boolean
}

const runQuery = (queryKey: QueryKeyValue, queryFn: AppQuery['queryFn']) => queryFn(...asQueryKey(queryKey))

const queryNotFound: AppQuery = {
  config: {},
  queryFn: (key) => {
    throw new Error('Query Not Found: ' + key)
  },
}

const queries: Record<string, AppQuery> = {
  published: {
    config: queryConfig.rare,
    queryFn: (key, project) =>
      FC.service('uploads').find({ query: { status: 'released', project, $sort: { releasedAt: -1 } } }),
    noInitalPrefetch: true,
  },
  uploads: {
    config: queryConfig.frequent,
    queryFn: (key, project) => FC.service('uploads').find({ query: { project, $sort: { createdAt: -1 } } }),
    noInitalPrefetch: true,
  },
  uploadKey: {
    config: queryConfig.rare,
    queryFn: () => FC.service('utils').get('getUploadKey'),
  },
  apps: {
    config: queryConfig.rare,
    queryFn: () => FC.service('apps').find({}),
  },
  app: {
    config: queryConfig.rare,
    queryFn: (key, id) => (id ? FC.service('apps').get(id) : {}),
    noInitalPrefetch: true,
  },
  stats: {
    config: queryConfig.rare,
    queryFn: (key, app) => FC.service('stats').get(app),
    noInitalPrefetch: true,
  },
  diskUsage: {
    config: { staleTime: 15 * time.seconds, gcTime: 60 * time.seconds, refetchInterval: 30 * time.seconds },
    queryFn: () => FC.service('disk-usage').find(),
  },
  updateSizes: {
    config: queryConfig.frequent,
    queryFn: (key, uploadId) => (uploadId ? FC.service('utils').get('updateSizes', { query: { uploadId } }) : null),
    noInitalPrefetch: true,
  },
  patches: {
    config: queryConfig.frequent,
    queryFn: (key, project) =>
      FC.service('patches').find({
        query: { ...(project ? { project } : {}), $sort: { createdAt: -1 }, $limit: 500 },
      }),
    noInitalPrefetch: true,
  },
  patchJobs: {
    config: queryConfig.frequent,
    queryFn: (key, project) =>
      FC.service('patch-jobs').find({
        query: { ...(project ? { project } : {}), $sort: { at: -1 }, $limit: 500 },
      }),
    noInitalPrefetch: true,
  },
  patchSources: {
    config: queryConfig.frequent,
    queryFn: (key, project, toUploadId) =>
      toUploadId ? FC.service('patches').get('patchSources', { query: { project, toUploadId } }) : null,
    noInitalPrefetch: true,
  },
  bsdiffSettings: {
    config: queryConfig.rare,
    queryFn: () => FC.service('bsdiff-settings').get('global'),
    noInitalPrefetch: true,
  },
  // Server-side paginated/sorted/filtered lists. `params` (the 2nd key element)
  // is an object {project, skip, limit, sortField, sortOrder, filters, search};
  // react-query keys on it so changing page/sort/filter refetches.
  patchJobsPage: {
    config: queryConfig.frequent,
    queryFn: (key, params) => FC.service('patch-jobs').get('page', { query: params || {} }),
    noInitalPrefetch: true,
  },
  patchesPage: {
    config: queryConfig.frequent,
    queryFn: (key, params) => FC.service('patches').get('page', { query: params || {} }),
    noInitalPrefetch: true,
  },
  patchPairsPage: {
    config: queryConfig.frequent,
    queryFn: (key, params) => FC.service('patch-pairs').get('page', { query: params || {} }),
    noInitalPrefetch: true,
  },
}

export const useCQuery = <T = DynamicData>(
  queryKey: QueryKeyValue,
  // `enabled` lets callers defer a fetch until the data is actually visible
  // (e.g. a collapsed card / unopened tab). Combined with the client-ready
  // gate so we never fetch before auth is established.
  options?: { enabled?: boolean },
): UseQueryResult<T> => {
  const { queryFn, config } = queries[Array.isArray(queryKey) ? queryKey[0] : queryKey] || queryNotFound
  return useQuery({
    queryKey: asQueryKey(queryKey),
    queryFn: () => runQuery(queryKey, queryFn) as T,
    ...config,
    enabled: FC.isReady() && (options?.enabled ?? true),
  })
}

export const prefetchQuery = (queryKey: QueryKeyValue) => {
  const { queryFn, config } = queries[Array.isArray(queryKey) ? queryKey[0] : queryKey] || queryNotFound
  queryClient.prefetchQuery({ queryKey: asQueryKey(queryKey), queryFn: () => runQuery(queryKey, queryFn), ...config })
}

export const prefetchQueries = () => {
  Object.entries(queries).forEach(([queryKey, { config, queryFn, defaultKeys, noInitalPrefetch }]) => {
    const key = defaultKeys ? [queryKey, ...defaultKeys] : queryKey
    !noInitalPrefetch &&
      queryClient.prefetchQuery({ queryKey: asQueryKey(key), queryFn: () => runQuery(key, queryFn), ...config })
  })
}

export const invalidateQuery = (queryKey: QueryKeyValue | QueryKeyValue[]) =>
  (Array.isArray(queryKey) ? queryKey : [queryKey]).forEach((key) =>
    queryClient.invalidateQueries({ queryKey: asQueryKey(key), refetchType: 'all' }),
  )
