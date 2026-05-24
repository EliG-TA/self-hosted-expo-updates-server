import { useQuery, queryCache } from 'react-query'
import { FC } from './FeathersClient'

const time = {
  seconds: 1000,
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000
}

const queryConfig = {
  rare: {
    staleTime: 1 * time.hours,
    cacheTime: 2 * time.hours,
    // Preserve last data during refetch so paginators/sorts don't reset
    // and collapsed/expanded cards don't flicker on background refresh.
    keepPreviousData: true
  },
  frequent: {
    staleTime: 5 * time.minutes,
    cacheTime: 10 * time.minutes,
    keepPreviousData: true
  },
  autoFetchFrequent: {
    staleTime: 3 * time.minutes,
    cacheTime: 5 * time.minutes,
    refetchInterval: 30 * time.seconds,
    keepPreviousData: true
  }
}

const queryNotFound = {
  config: {},
  queryFn: (key) => { throw new Error('Query Not Found: ' + key) }
}

const queries = {
  published: {
    config: queryConfig.rare,
    queryFn: (key, project) => FC.client.service('uploads').find({ query: { status: 'released', project, $sort: { releasedAt: -1 } } }),
    noInitalPrefetch: true
  },
  uploads: {
    config: queryConfig.frequent,
    queryFn: (key, project) => FC.client.service('uploads').find({ query: { project, $sort: { createdAt: -1 } } }),
    noInitalPrefetch: true
  },
  uploadKey: {
    config: queryConfig.rare,
    queryFn: () => FC.client.service('utils').get('getUploadKey')
  },
  apps: {
    config: queryConfig.rare,
    queryFn: () => FC.client.service('apps').find({})
  },
  app: {
    config: queryConfig.rare,
    queryFn: (key, id) => id ? FC.client.service('apps').get(id) : {},
    noInitalPrefetch: true
  },
  stats: {
    config: queryConfig.rare,
    queryFn: (key, app) => FC.client.service('stats').get(app),
    noInitalPrefetch: true
  },
  diskUsage: {
    config: { staleTime: 15 * time.seconds, cacheTime: 60 * time.seconds, refetchInterval: 30 * time.seconds },
    queryFn: () => FC.client.service('disk-usage').find()
  },
  updateSizes: {
    config: queryConfig.frequent,
    queryFn: (key, uploadId) => uploadId
      ? FC.client.service('utils').get('updateSizes', { query: { uploadId } })
      : null,
    noInitalPrefetch: true
  },
  patches: {
    config: queryConfig.frequent,
    queryFn: (key, project) => FC.client.service('patches').find({
      query: { ...(project ? { project } : {}), $sort: { createdAt: -1 }, $limit: 500 }
    }),
    noInitalPrefetch: true
  },
  patchJobs: {
    config: queryConfig.frequent,
    queryFn: (key, project) => FC.client.service('patch-jobs').find({
      query: { ...(project ? { project } : {}), $sort: { startedAt: -1 }, $limit: 200 }
    }),
    noInitalPrefetch: true
  }
}

export const useCQuery = (queryKey) => {
  const { queryFn, config } = queries[Array.isArray(queryKey) ? queryKey[0] : queryKey] || queryNotFound
  return useQuery({ queryKey, queryFn, config: { ...config, enabled: FC.isReady() } })
}

export const prefetchQuery = (queryKey) => {
  const { queryFn, config } = queries[Array.isArray(queryKey) ? queryKey[0] : queryKey] || queryNotFound
  queryCache.prefetchQuery(queryKey, queryFn, config)
}

export const prefetchQueries = () => {
  Object.entries(queries).forEach(([queryKey, { config, queryFn, defaultKeys, noInitalPrefetch }]) => {
    const key = defaultKeys ? [queryKey, ...defaultKeys] : queryKey
    !noInitalPrefetch && queryCache.prefetchQuery(key, queryFn, config)
  })
}

export const invalidateQuery = (queryKey) =>
  (Array.isArray(queryKey) ? queryKey : [queryKey])
    .forEach(key => queryCache.invalidateQueries(key, { refetchInactive: true, force: true }))
