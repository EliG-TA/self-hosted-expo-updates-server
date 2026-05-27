import authClient, { MemoryStorage } from '@feathersjs/authentication-client'
import { feathers } from '@feathersjs/feathers'
import socketio from '@feathersjs/socketio-client'
import type { Socket } from 'socket.io-client'
import { io } from 'socket.io-client'

import type { QueryKeyValue, UnknownRecord } from '../types'
import { invalidateQuery } from './QueryCache'

/* ============================== Environment Setup ================================================== */
const isDev = !window?._env_?.ENVIRONMENT || window?._env_?.ENVIRONMENT === 'development'
const serverUrl = window?._env_?.API_BASE_URL || 'http://localhost:3000'

/* ============================== Socket Configuration ================================================== */
interface ServiceClient {
  find(params?: UnknownRecord): Promise<unknown>
  get(id?: unknown, params?: UnknownRecord): Promise<unknown>
  create(data?: unknown, params?: UnknownRecord): Promise<unknown>
  update(id: unknown, data?: unknown, params?: UnknownRecord): Promise<unknown>
  patch(id: unknown, data?: unknown, params?: UnknownRecord): Promise<unknown>
  remove(id?: unknown, params?: UnknownRecord): Promise<unknown>
  on(event: string, callback: (message: UnknownRecord) => void): void
}

interface FeathersApplication extends Omit<ReturnType<typeof feathers>, 'service'> {
  service(name: string): ServiceClient
}

interface AuthResult {
  accessToken?: string
}

interface FeathersClientState {
  isDev: boolean
  socket: Socket
  client: FeathersApplication
  online: boolean
  authenticated: boolean
  connectionHandler: (event: string) => () => void
  server: string
  login: (credentials: UnknownRecord) => Promise<unknown>
  logout: () => void
  services: unknown
  service: (name: string) => ServiceClient
  isReady: () => boolean
  updateCache: (keys: QueryKeyValue | QueryKeyValue[]) => Promise<unknown>
}

const FC = {
  isDev,
  socket: io(serverUrl, { transports: ['websocket'], forceNew: true }),
  client: feathers() as unknown as FeathersApplication,
  online: false,
  authenticated: false,
  connectionHandler: (event) => () => {
    FC.isDev && console.log(`Socket ${event} to ${serverUrl}`)
    FC.online = event === 'connect'
  },
  server: serverUrl,
} as FeathersClientState

FC.client.configure(socketio(FC.socket, { timeout: 30000 }))
FC.client.configure(authClient({ storage: new MemoryStorage() }))

FC.socket.on('connect', FC.connectionHandler('connect'))
FC.socket.on('disconnect', FC.connectionHandler('disconnect'))

/* ============================== Socket Methods ================================================== */

FC.login = async (credentials) => {
  try {
    const user = (await FC.client.authenticate(credentials)) as AuthResult
    FC.authenticated = !!user.accessToken
    return user
  } catch (details) {
    FC.authenticated = false
    FC.isDev && console.log(details)
    return { user: { username: 'NotAuthenticated' } }
  }
}

FC.logout = () => {
  try {
    FC.client.logout()
  } catch (e) {}
}

FC.services = FC.client.services
FC.service = FC.client.service.bind(FC.client)

FC.isReady = () => FC.online && FC.authenticated

// Channel Updates
FC.updateCache = (keys) => FC.service('messages').create({ action: 'update', keys })
FC.service('messages').on('created', (message: UnknownRecord) => {
  message &&
    message.action === 'update' &&
    message.keys &&
    invalidateQuery(message.keys as QueryKeyValue | QueryKeyValue[])
})

export { FC }
