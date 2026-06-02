import compress from 'compression'
import cors from 'cors'
import helmetModule from 'helmet'
import * as path from 'path'
import favicon from 'serve-favicon'

import type { AppLike, UnknownRecord } from '../types'

const helmet = helmetModule

const addWebhookRawBody = (req: { url?: string; rawBody?: Buffer }, res: unknown, buf: Buffer) => {
  req.url && req.url === '/webhooks' && (req.rawBody = buf)
}

export interface ExpressLike {
  json(options: UnknownRecord): unknown
  urlencoded(options: UnknownRecord): unknown
  static(path: string): unknown
}

export default (express: ExpressLike) => (app: AppLike & { use(...args: unknown[]): void }) => {
  app.use(helmet({ contentSecurityPolicy: false }))
  app.use(cors())
  app.use(compress())
  app.use(express.json({ limit: '20mb', verify: addWebhookRawBody }))
  app.use(express.urlencoded({ extended: true, limit: '5mb' }))

  const publicDir = path.resolve(__dirname, '..', '..', 'public')
  app.use('/', express.static(publicDir))
  app.use(favicon(path.join(publicDir, 'favicon.ico')))
}
