import type { AppLike, UnknownRecord } from '../types'
import { logger } from '../modules'
class Service {
  options: UnknownRecord
  app: AppLike

  constructor (options?: UnknownRecord) {
    this.options = options || {}
  }

  setup (app: AppLike) {
    this.app = app
  }

  async get (data?: unknown) {
    return 'NotFound'
  }

  async find () {
    try {
      const [user] = await this.app.services.users.find({ query: { $limit: 1 } }) as UnknownRecord[]
      return { ok: !!user }
    } catch (error) {
      logger.error('API - public/status', { error })
    }
    return { ok: false }
  }
}

export default {
  name: 'status',
  createService: (params?: UnknownRecord) => new Service(params),
  hooks: {
    before: {
      all: [],
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
