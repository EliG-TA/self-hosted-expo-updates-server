import s from '../hooks/security'

export default {
  name: 'clients',
  noBsonIDs: true,
  hooks: {
    before: {
      all: s.defaultSecurity(),
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: [],
    },

    after: {
      all: [],
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: [],
    },
  },
}
