import './modules/docker/init'

import expressModule from '@feathersjs/express'
import { feathers } from '@feathersjs/feathers'

import { feathersconfig, logger } from './modules'
import type { FeathersExpressLike } from './modules/feathers.config'

const express = expressModule as unknown as FeathersExpressLike

const app = express(feathers())
app.configure(feathersconfig(express))

const SEED_RETRY_DELAY_MS = 10000
const SEED_MAX_ATTEMPTS = 30 // ~5 minutes

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// This used to run once, 3s after boot, and give up permanently if mongod was not
// ready yet — leaving a server nobody could log into until someone restarted it.
// Keep retrying instead, and be loud if we ever exhaust the window.
const createAdminIfMissing = async () => {
  if (!process.env.MONGO_CONN) {
    logger.error('MONGO_CONN not defined, please run this server under docker compose or set MONGO_CONN env variable')
    return
  }

  for (let attempt = 1; attempt <= SEED_MAX_ATTEMPTS; attempt++) {
    try {
      const result = await app.service('users').find({ query: { username: 'admin' } })
      const [admin] = Array.isArray(result) ? result : (result as { data?: unknown[] })?.data || []
      if (!admin) {
        await app.service('users').create({ username: 'admin', password: app.get('adminPass'), role: 'admin' })
        logger.info('API - admin user created')
      }
      return
    } catch (e) {
      logger.warn(`API - admin user check failed (attempt ${attempt}/${SEED_MAX_ATTEMPTS})`, { error: e.message })
      if (attempt < SEED_MAX_ATTEMPTS) await wait(SEED_RETRY_DELAY_MS)
    }
  }

  logger.error(
    'API - gave up creating the admin user: nobody can sign in to the dashboard. Verify the Mongodb connection and restart the API server.',
  )
}

app.listen(app.get('port')).then(() => {
  logger.info(`Feathers application started on http://${app.get('host')}:${app.get('port')}`)
  logger.info(`Env: ${process.env.NODE_ENV} DB: ${app.get('mongodb')}`)
  createAdminIfMissing()
})
