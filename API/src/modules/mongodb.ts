import type { Db } from 'mongodb'
import { MongoClient } from 'mongodb'

import type { AppLike } from '../types'
import logger from './logger'

// Per-attempt server selection budget. Deliberately shorter than the driver's
// 30s default so a failed attempt cycles back into the retry loop quickly.
const SERVER_SELECTION_TIMEOUT_MS = 5000
const RETRY_BASE_DELAY_MS = 1000
const RETRY_MAX_DELAY_MS = 10000
// How long mongod may stay unreachable at boot before we give up on it.
const STARTUP_WINDOW_MS = 5 * 60 * 1000
// Readiness pings are on the k8s probe path, so bound them well under the probe
// timeout rather than letting them sit for the full server selection window.
const PING_TIMEOUT_MS = 2000

let db: Db | null = null

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    promise.then(resolve, reject).finally(() => clearTimeout(timer))
  })

/**
 * Connect to mongod, retrying with backoff until the startup window closes.
 *
 * This promise is handed to every MongoDBService as its `Model` (services/index.ts)
 * and Feathers resolves it exactly once, reusing it for the life of the service.
 * A rejection here is therefore memoised: every later request replays the same
 * connection error even after mongod comes back. That is precisely how a slow
 * WiredTiger recovery once left this API serving cached ECONNREFUSED errors on a
 * Running pod until it was deleted by hand.
 *
 * So this promise must only ever stay pending or resolve — never reject. While it
 * is pending, callers simply wait; once mongod answers, they all proceed. If mongod
 * stays unreachable for the whole window we exit non-zero instead of rejecting, so
 * the orchestrator restarts us and the failure is loud (CrashLoopBackOff) rather
 * than a healthy-looking pod that 500s forever.
 *
 * Keep this loop even if the deployment grows an init container that waits for the
 * database: an open port is not the same as a mongod that will answer a query — it
 * accepts TCP while it is still replaying its journal, which is the case that caused
 * the outage above.
 */
const connectWithRetry = async (connection: string, database: string): Promise<Db> => {
  const deadline = Date.now() + STARTUP_WINDOW_MS
  let delay = RETRY_BASE_DELAY_MS

  for (let attempt = 1; ; attempt++) {
    try {
      const client = await MongoClient.connect(connection, { serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS })
      // Past this point the driver's own topology monitor handles reconnects, so
      // only the initial connection ever needs retrying here.
      db = client.db(database)
      logger.info(`API - mongodb connected${attempt > 1 ? ` after ${attempt} attempts` : ''}`)
      return db
    } catch (e) {
      if (Date.now() >= deadline) {
        logger.error(
          `API - mongodb unreachable after ${attempt} attempts over ${Math.round(STARTUP_WINDOW_MS / 1000)}s, exiting so the orchestrator can restart us`,
          { error: e.message },
        )
        process.exit(1)
      }
      logger.warn(`API - mongodb connection attempt ${attempt} failed, retrying in ${delay}ms`, { error: e.message })
      await wait(delay)
      delay = Math.min(delay * 2, RETRY_MAX_DELAY_MS)
    }
  }
}

/**
 * Real round trip to mongod, used by the /readyz probe. Returns false rather than
 * throwing: "not ready" is an expected answer, not an error.
 */
export const pingMongo = async (): Promise<boolean> => {
  if (!db) return false
  try {
    await withTimeout(db.command({ ping: 1 }), PING_TIMEOUT_MS)
    return true
  } catch (e) {
    logger.warn('API - mongodb ping failed', { error: e.message })
    return false
  }
}

export default function mongodb(app: AppLike) {
  const connection = String(app.get('mongodb'))
  const dbNameEndIndex = connection.includes('?') ? connection.indexOf('?') : connection.length
  const database = connection.substring(connection.lastIndexOf('/') + 1, dbNameEndIndex)

  app.set('mongoClient', connectWithRetry(connection, database))
}
