import expressModule from '@feathersjs/express'
import { feathers } from '@feathersjs/feathers'
import { feathersconfig, logger } from './modules'
import type { FeathersExpressLike } from './modules/feathers.config'
import './modules/docker/init'

const express = expressModule as unknown as FeathersExpressLike

const app = express(feathers())
app.configure(feathersconfig(express))

const createAdminIfMissing = async () => {
  try {
    if (!process.env.MONGO_CONN) throw new Error('MONGO_CONN not defined, please run this server under docker compose or set MONGO_CONN env variable')
    const result = await app.service('users').find({ query: { username: 'admin' } })
    const [admin] = Array.isArray(result) ? result : (result as { data?: unknown[] })?.data || []
    if (!admin) {
      await app.service('users').create({ username: 'admin', password: app.get('adminPass'), role: 'admin' })
    }
  } catch (e) {
    logger.error(e.message)
    logger.error('Error creating admin user, please try to restart API server or verify Mongodb connection.', e)
  }
}

app.listen(app.get('port')).then(() => {
  logger.info(`Feathers application started on http://${app.get('host')}:${app.get('port')}`)
  logger.info(`Env: ${process.env.NODE_ENV} DB: ${app.get('mongodb')}`)
  setTimeout(createAdminIfMissing, 3000)
})
