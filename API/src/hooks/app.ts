import type { HookContextLike, UnknownRecord } from '../types'

// Application hooks that run for every service
import * as util from 'util'

import { logger } from '../modules'

const ignoredCodes = [410, 503, 400, 405, 403, 429, 404]
const ignoredNames = ['NotAuthenticated', 'Conflict']

// Get context Details for Error Log
const getContextDetails = (context: HookContextLike) => {
  const { params = {} } = context
  const errorLog: UnknownRecord = {}

  context.method && (errorLog.method = context.method)
  context.path && (errorLog.path = context.path)
  context.id && (errorLog.id = context.id)
  context.data && (errorLog.data = context.data)
  params.provider && (errorLog.provider = params.provider)
  params.headers && params.headers['x-forwarded-for'] && (errorLog.ip = params.headers['x-forwarded-for'])
  params.query && Object.keys(params.query).length && (errorLog.query = params.query)
  params.user && Object.keys(params.user).length && (errorLog.user = params.user._id)
  return errorLog
}

export { getContextDetails }

const logErrorByCode = ({ code, name }: { code?: number; name?: string }) =>
  ignoredCodes.indexOf(code) > -1 || ignoredNames.indexOf(name) > -1 ? logger.info : logger.error

// Application hooks that run for every service
const log = (context: HookContextLike) => {
  logger.debug(`${context.type} app.service('${context.path}').${context.method}()`)

  // Avoid word ERROR in logs for non critical errors
  context.error && logErrorByCode(context.error)(context.error.stack, getContextDetails(context))
  if (typeof context.toJSON === 'function') {
    logger.debug('Hook Context', util.inspect(context, { colors: false }))
  }
}

export default {
  before: {
    all: [],
    find: [],
    get: [],
    create: [],
    update: [],
    patch: [],
    remove: []
  },

  after: {
    all: [],
    find: [],
    get: [],
    create: [],
    update: [],
    patch: [],
    remove: []
  },

  error: {
    all: [log],
    find: [],
    get: [],
    create: [],
    update: [],
    patch: [],
    remove: []
  }
}
