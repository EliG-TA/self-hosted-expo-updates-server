import type { LoggerLike } from '../types'
import feathersconfig from './feathers.config'
import loggerDefault from './logger'

const logger: LoggerLike = loggerDefault
export { feathersconfig, logger }
