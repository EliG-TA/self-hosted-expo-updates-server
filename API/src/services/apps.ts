const s = require('../hooks/security')

const setBsdiffDefault = (context) => {
  if (context.data && context.data.bsdiffEnabled === undefined) {
    context.data.bsdiffEnabled = false
  }
  return context
}

// When the toggle flips, tell every connected dashboard to invalidate its
// app/apps queries so the BsdiffManager UI reflects the new state without
// a manual refresh.
const broadcastBsdiffToggle = (context) => {
  if (!context.data) return context
  if (!Object.prototype.hasOwnProperty.call(context.data, 'bsdiffEnabled')) return context
  context.app.service('messages').create({ action: 'update', keys: ['app', 'apps'] })
  return context
}

module.exports = {
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
