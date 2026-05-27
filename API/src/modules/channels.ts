import type { AppLike, UnknownRecord } from '../types'

interface Channel {
  join(connection: unknown): void
  leave(connection: unknown): void
  send(data: unknown): unknown
}

interface ChannelApp extends AppLike {
  channel(name: string): Channel
  on(event: string, callback: (...args: unknown[]) => void): void
}

export default function channels (app: ChannelApp) {
  if (typeof app.channel !== 'function') return false

  app.on('connection', (connection: unknown) => app.channel('anonymous').join(connection))

  app.on('login', (authResult: unknown, payload: UnknownRecord) => {
    const connection = payload.connection
    if (connection) {
      app.channel('anonymous').leave(connection)
      app.channel('authenticated').join(connection)
    }
  })

  app.service('messages').publish?.('created', (a: unknown, payload: UnknownRecord) => app.channel('authenticated').send(payload.data))
}
