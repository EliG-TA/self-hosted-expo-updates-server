import type { AppLike, ClientRecord, UnknownRecord } from '../types'
import s from '../hooks/security'

import moment from 'moment'

interface UpdateStats {
  onThisVersion: number
  lastSeen?: string | Date
}

interface StatsBucket {
  version?: string
  platform?: string
  releaseChannel?: string
  embeddedUpdates: Set<string>
  updates: Record<string, UpdateStats>
}

class Service {
  options: UnknownRecord
  app: AppLike

  constructor (options?: UnknownRecord) {
    this.options = options || {}
  }

  setup (app: AppLike) {
    this.app = app
  }

  async get (project: string) {
    const clients = await this.app.service('clients').find({ query: { project } }) as ClientRecord[]
    const stats: Record<string, StatsBucket> = {}

    // First pass — accumulate per-(version,platform,channel) totals and
    // collect *all* embedded update IDs seen (one runtime can have multiple
    // native builds, each with its own embedded bundle).
    clients.forEach(({ version, platform, embeddedUpdate, currentUpdate, releaseChannel, lastSeen }) => {
      const key = `${version}-${platform}-${releaseChannel}`
      if (!stats[key]) {
        stats[key] = {
          version,
          platform,
          releaseChannel,
          embeddedUpdates: new Set(),
          updates: {}
        }
      }
      if (embeddedUpdate) stats[key].embeddedUpdates.add(embeddedUpdate)
      if (!currentUpdate) return
      if (!stats[key].updates[currentUpdate]) {
        stats[key].updates[currentUpdate] = { onThisVersion: 0, lastSeen }
      }
      stats[key].updates[currentUpdate].onThisVersion++
      if (moment(lastSeen).isAfter(stats[key].updates[currentUpdate].lastSeen)) {
        stats[key].updates[currentUpdate].lastSeen = lastSeen
      }
    })

    // Second pass — flatten and mark which updates correspond to embedded
    // builds (an update is "embedded" if it appears in the group's
    // embeddedUpdates set).
    const result = Object.values(stats).map(({ updates, embeddedUpdates, ...rest }) => {
      const embeddedList = [...embeddedUpdates]
      return {
        ...rest,
        embeddedUpdates: embeddedList,
        updates: Object.entries(updates).map(([updateId, fields]) => ({
          updateId,
          ...fields,
          isBuild: embeddedUpdates.has(updateId)
        }))
      }
    }).sort((a, b) => a.version > b.version ? -1 : a.version < b.version ? 1 : 0)

    return result
  }
}

export default {
  name: 'stats',
  createService: (params?: UnknownRecord) => new Service(params),
  hooks: {
    before: {
      all: s.defaultSecurity(),
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: []
    },
    after: {
      all: [],
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: []
    }
  }
}
