import { hooks } from '@feathersjs/authentication'
import * as Err from '@feathersjs/errors'

import type { HookContextLike } from '../types'

const { authenticate } = hooks

const security = {
  isLocal: (context: HookContextLike) => !context?.params?.provider,

  defaultSecurity: () => [authenticate('jwt'), security.preventGlobalUpdates],

  // Prevent Method Execution
  methodNotAllowed: (context: HookContextLike) => {
    throw new Err.MethodNotAllowed('Method is not allowed')
  },
  // Same as methodNotAllowed but lets internal (server-side) callers through.
  // Use when external HTTP clients must be blocked but worker/service code
  // still needs to invoke the method.
  externalMethodNotAllowed: (context: HookContextLike) => {
    if (security.isLocal(context)) return context
    throw new Err.MethodNotAllowed('Method is not allowed')
  },
  // Only Admin can do broad patch / update / delete
  preventGlobalUpdates: (context: HookContextLike) => {
    if (security.isLocal(context)) return context
    if (context.method === 'find' || context.method === 'create' || context.method === 'get') return context
    if (!context.id) {
      throw new Err.Forbidden('Global Update Not Authorized: Enitity ID not provided')
    }
    return context
  },
}

export default security
