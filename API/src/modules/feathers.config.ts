import configuration from '@feathersjs/configuration'
import socketio from '@feathersjs/socketio'

import appHooks from '../hooks/app'
import services from '../services'
import type { AppLike, LoggerLike, UnknownRecord } from '../types'
import channels from './channels'
import type { ExpressLike } from './express.config'
import expressconfig from './express.config'
import loggerDefault from './logger'
import mongodb from './mongodb'
import * as patchesWorker from './patches/worker'

const logger: LoggerLike = loggerDefault

export type FeathersExpressLike = ExpressLike & {
  (...args: unknown[]): AppLike & {
    configure(service: unknown): void
    hooks(hooks: unknown): void
    use(...args: unknown[]): void
    listen(port: unknown): Promise<unknown>
  }
  rest(): unknown
  notFound(): unknown
  errorHandler(options: UnknownRecord): unknown
}

export default (express: FeathersExpressLike) =>
  (
    app: AppLike & { configure(service: unknown): void; hooks(hooks: unknown): void; use(...args: unknown[]): void },
  ) => {
    // Load Feathers configuration
    app.configure(configuration())

    // Load Express configuration
    app.configure(expressconfig(express))

    // Set up Providers
    app.configure(express.rest())
    app.configure(socketio({ cookie: false }))

    // Database Adapter
    app.configure(mongodb)

    // SConfiguring Services
    app.configure(services)

    // Setting up Feathres Services and Hooks
    app.configure(channels)
    app.hooks(appHooks)

    // Configure a middleware for 404s and the error handler
    app.use(express.notFound())
    app.use(express.errorHandler({ logger }))

    // Background bsdiff patch generation queue. Polls patches with status
    // 'pending' on a timer and walks them through generate → validate.
    patchesWorker.start(app)
  }
