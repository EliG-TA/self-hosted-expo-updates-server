import type { AppLike } from '../types'
import { pingMongo } from './mongodb'

interface ResponseLike {
  status(code: number): ResponseLike
  json(body: unknown): void
}

/**
 * Unauthenticated, dependency-light probes for container orchestrators.
 *
 * The split matters: /healthz must NOT touch mongod. If liveness depended on the
 * database, a mongod outage would crash-loop every API pod at once and turn a
 * recoverable blip into a full outage. Liveness only answers "is this process still
 * serving?"; readiness answers "can this process do useful work right now?", so a
 * pod that cannot reach mongod is pulled out of the Service endpoints instead of
 * quietly serving 500s.
 */
export default (app: AppLike & { use(...args: unknown[]): void }) => {
  app.use('/healthz', (req: unknown, res: ResponseLike) => {
    res.status(200).json({ ok: true })
  })

  app.use('/readyz', async (req: unknown, res: ResponseLike) => {
    const mongo = await pingMongo()
    res.status(mongo ? 200 : 503).json({ ok: mongo, mongo })
  })
}
