import type { AppLike } from '../types'
import { AuthenticationService, JWTStrategy } from '@feathersjs/authentication'
import { LocalStrategy } from '@feathersjs/authentication-local'
import { oauth } from '@feathersjs/authentication-oauth'

export default (app: AppLike & { use(name: string, service: unknown): void; configure(service: unknown): void }) => {
  const authentication = new AuthenticationService(app)

  authentication.register('jwt', new JWTStrategy())
  authentication.register('local', new LocalStrategy())

  app.use('authentication', authentication)
  app.configure(oauth())
}
