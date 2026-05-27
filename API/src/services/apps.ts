import type { HookContextLike, UnknownRecord } from '../types'
import s from '../hooks/security'

const setBsdiffDefault = (context: HookContextLike) => {
  const data = context.data as UnknownRecord | undefined
  if (data && data.bsdiffEnabled === undefined) {
    data.bsdiffEnabled = false
  }
  return context
}

// When the toggle flips, tell every connected dashboard to invalidate its
// app/apps queries so the BsdiffManager UI reflects the new state without
// a manual refresh.
const broadcastBsdiffToggle = (context: HookContextLike) => {
  const data = context.data as UnknownRecord | undefined
  if (!data) return context
  if (!Object.prototype.hasOwnProperty.call(data, 'bsdiffEnabled')) return context
  context.app.service('messages').create({ action: 'update', keys: ['app', 'apps'] })
  return context
}

export default {
  name: 'apps',
  noBsonIDs: true,
  hooks: {
    before: {
      all: s.defaultSecurity(),
      find: [],
      get: [],
      create: [setBsdiffDefault],
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
      patch: [broadcastBsdiffToggle],
      remove: []
    }
  }
}
