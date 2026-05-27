import type { AppLike, ClientRecord, UnknownRecord } from '../types'
import s from '../hooks/security'

import * as Err from '@feathersjs/errors'
import { hanldeManifestData, handleManifestResponse } from '../modules/expo/manifest'
import { handleAssetData, handleAssetResponse } from '../modules/expo/asset'
import { getRequestParams } from '../modules/expo/request'

class Service {
  options: UnknownRecord
  app: AppLike
  throttleTime: number
  throttleController: Record<string, { lastCall?: number; debounce?: ReturnType<typeof setTimeout> }>

  constructor (options?: UnknownRecord) {
    this.options = options || {}
  }

  setup (app: AppLike) {
    this.app = app
    const throttleTime = app.get('statsThrottle')
    this.throttleTime = typeof throttleTime === 'number' ? throttleTime : Number(throttleTime) || 5000
    this.throttleController = {}
  }

  sendReactQueryUpdate (project: string) {
    this.throttleController[project].lastCall = Date.now()
    this.app.service('messages').create({ action: 'update', keys: [['stats', project]] })
  }

  updateClientsReactQuery (project: string) {
    if (!this.throttleController[project]) { // Never called an update before, calling now
      this.throttleController[project] = {}
      this.sendReactQueryUpdate(project)
      return true
    }

    const timeSinceLastCall = Date.now() - this.throttleController[project].lastCall

    if (timeSinceLastCall > this.throttleTime) { // Enough time passed, calling now
      this.sendReactQueryUpdate(project)
    } else {
      // Not Enough time passed, debouncing
      clearTimeout(this.throttleController[project].debounce)
      this.throttleController[project].debounce = setTimeout(() => {
        this.sendReactQueryUpdate(project)
      }, this.throttleTime - timeSinceLastCall)
    }
  }

  async clientMetrics (id: unknown, { query, headers }: { query: UnknownRecord; headers: Record<string, string | undefined> }) {
    const {
      project,
      platform,
      runtimeVersion,
      releaseChannel
    } = getRequestParams({ query, headers })

    const _id = headers['eas-client-id']
    const embeddedUpdate = headers['expo-embedded-update-id']
    const currentUpdate = headers['expo-current-update-id']
    if (!_id) return false
    const [client] = await this.app.service('clients').find({ query: { _id } }) as ClientRecord[]
    if (client) {
      await this.app.service('clients').patch(client._id, {
        lastSeen: new Date().toISOString(),
        version: runtimeVersion,
        embeddedUpdate,
        currentUpdate,
        updateCount: 1 + (client.updateCount || 0)
      })
    } else {
      await this.app.service('clients').create({
        _id: headers['eas-client-id'],
        lastSeen: new Date().toISOString(),
        firstSeen: new Date().toISOString(),
        project,
        version: runtimeVersion,
        platform,
        releaseChannel,
        embeddedUpdate,
        currentUpdate,
        updateCount: 1
      })
    }
    this.updateClientsReactQuery(project)
  }

  async get (id: string, { query, headers }: { query: UnknownRecord; headers: Record<string, string | undefined> }) {
    if (id === 'manifest') {
      this.clientMetrics(id, { query, headers })
      return hanldeManifestData(this.app, { query, headers })
    }

    if (id === 'assets') return handleAssetData(this.app, { query, headers })
    throw new Err.BadRequest('Invalid request.')
  }
}

const apiService = new Service()

export default {
  name: 'api',
  createService: (options?: UnknownRecord) => apiService,
  middleware: (req: { headers: Record<string, string | undefined> }, res: { data: { type: string } }, next: () => void) => {
    const protocolVersion = req.headers["expo-protocol-version"];

    if (res.data.type === 'manifest') return handleManifestResponse(res, protocolVersion)
    if (res.data.type === 'asset') return handleAssetResponse(res)
    next()
  },
  hooks: {
    before: {
      all: [],
      find: [s.methodNotAllowed],
      get: [],
      create: [s.methodNotAllowed],
      update: [s.methodNotAllowed],
      patch: [s.methodNotAllowed],
      remove: [s.methodNotAllowed]
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

export { Service }
