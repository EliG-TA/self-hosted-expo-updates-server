const pino = require('pino')

const prettyPino = {
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname',
      translateTime: true
    }
  }
}

const logger = process.env.NODE_ENV === 'production' ? pino() : pino(prettyPino)
// pino's signature is (mergingObject, message); our call sites use
// (message, mergingObject) — flip the args so structured data is preserved
// as fields on the log record instead of being coerced into the message.
const pinoLogger = {
  ...logger,
  info: (source, info) => info ? logger.info(info, source) : logger.info(source),
  warn: (source, info) => info ? logger.warn(info, source) : logger.warn(source),
  error: (source, info) => info ? logger.error(info, source) : logger.error(source),
  debug: (source, info) => info ? logger.debug(info, source) : logger.debug(source)
}

process.on('unhandledRejection', (reason, p) =>
  pinoLogger.error('API - Unhandled Rejection at: Promise ', { promise: p, reason }))

module.exports = pinoLogger
