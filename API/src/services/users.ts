import s from '../hooks/security'
import { hooks } from '@feathersjs/authentication-local'

const { hashPassword, protect } = hooks

export default {
  name: 'users',
  hooks: {
    before: {
      all: s.defaultSecurity(),
      find: [],
      get: [],
      create: [hashPassword('password')],
      update: [hashPassword('password')],
      patch: [hashPassword('password')],
      remove: []
    },

    after: {
      all: [protect('password')],
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: []
    }
  }
}
