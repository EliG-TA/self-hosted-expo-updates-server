import type { Db } from 'mongodb'
import type { AppLike, UnknownRecord } from '../types'
import { MongoDBService } from '@feathersjs/mongodb'
import error from '../hooks/error'
import api from './api'
import apps from './apps'
import authentication from './authentication'
import clients from './clients'
import diskUsage from './disk-usage'
import messages from './messages'
import patchJobs from './patch-jobs'
import patches from './patches'
import stats from './stats'
import status from './status'
import upload from './upload'
import uploads from './uploads'
import users from './users'
import utils from './utils'

type Configurator = (app: AppLike & { configure(service: unknown): void; use(name: string, service: unknown, middleware?: unknown): void }) => void

interface ServiceDefinition {
  name?: string
  middleware?: (req: unknown, res: unknown, next: () => void) => void
  noBsonIDs?: boolean
  hooks?: UnknownRecord
  createService?: (options: UnknownRecord) => unknown
}

type ServiceModule = ServiceDefinition | Configurator

const defaultMiddleware = (req: unknown, res: unknown, next: () => void) => {
  next()
}

const services: ServiceModule[] = [
  api,
  apps,
  authentication,
  clients,
  diskUsage,
  messages,
  patchJobs,
  patches,
  stats,
  status,
  upload,
  uploads,
  users,
  utils
]

export default function configureServices (app?: AppLike & { configure(service: unknown): void; use(name: string, service: unknown, middleware?: unknown): void }) {
  if (!app) return services

  const defaultOptions = {
    paginate: app.get('paginate'),
    whitelist: ['$regex', '$exists']
  }

  services.forEach((service: ServiceModule) => {
    if (typeof service === 'function') {
      app.configure(service)
      return true
    }

    const { name, middleware, noBsonIDs, hooks, createService } = service
    if (!name) {
      app.configure(service)
      return true
    }

    if (createService) {
      const createdService = createService(defaultOptions)
      app.use(name, createdService, middleware || defaultMiddleware)
    } else {
      const opts = {
        ...defaultOptions,
        ...(noBsonIDs ? { disableObjectify: true } : {}),
        Model: (app.get('mongoClient') as Promise<Db>).then((db) => db.collection(name))
      }
      app.use(name, new MongoDBService(opts))
    }

    app.service(name).hooks({ ...hooks, error })
  })
}
