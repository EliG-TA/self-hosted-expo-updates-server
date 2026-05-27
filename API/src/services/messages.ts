import s from '../hooks/security'
import type { AppLike, UnknownRecord } from '../types'

class Service {
  options: UnknownRecord
  app: AppLike

  constructor(options?: UnknownRecord) {
    this.options = options || {}
  }

  setup(app: AppLike) {
    this.app = app
  }

  async create(data?: unknown, params?: UnknownRecord) {
    return 'OK'
  }
}

export default {
  name: 'messages',
  createService: (options?: UnknownRecord) => new Service(options),
  hooks: {
    before: {
      all: s.defaultSecurity(),
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: [],
    },
    after: {
      all: [],
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: [],
    },
  },
}

export { Service }
