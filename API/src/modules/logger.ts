import pino from 'pino'

const prettyPino = {
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname',
      translateTime: true,
    },
  },
}

const logger = process.env.NODE_ENV === 'production' ? pino() : pino(prettyPino)
// pino's signature is (mergingObject, message); our call sites use
// (message, mergingObject) — flip the args so structured data is preserved
// as fields on the log record instead of being coerced into the message.
const pinoLogger = {
  ...logger,
  info: (source: unknown, info?: unknown) => (info ? logger.info(info, String(source)) : logger.info(source)),
  warn: (source: unknown, info?: unknown) => (info ? logger.warn(info, String(source)) : logger.warn(source)),
  error: (source: unknown, info?: unknown) => (info ? logger.error(info, String(source)) : logger.error(source)),
  debug: (source: unknown, info?: unknown) => (info ? logger.debug(info, String(source)) : logger.debug(source)),
}

process.on('unhandledRejection', (reason, p) =>
  pinoLogger.error('API - Unhandled Rejection at: Promise ', { promise: p, reason }),
)

export default pinoLogger
