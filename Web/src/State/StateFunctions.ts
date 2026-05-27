import state from './index'
import { FC } from '../Services'
import { resetStates } from './Functions'
import { prefetchQueries } from '../Services/QueryCache'

interface AuthCredentials extends Record<string, unknown> {
  strategy?: string
  accessToken?: string
  username?: string
  password?: string
}

interface AuthResponse {
  accessToken?: string
}

export const jwtLogin = async () => {
  const { accessToken } = state.user.state
  if (!accessToken) return doLogout()

  const res = await doLogin({ strategy: 'jwt', accessToken })
  return res ? true : doLogout()
}

export const doLogin = async (auth: AuthCredentials) => {
  const { accessToken } = await FC.login(auth) as AuthResponse
  if (!accessToken) return false

  state.user.patchState({ accessToken })
  prefetchQueries()
  return true
}

export const doLogout = () => {
  resetStates(state)
  window.location.href = '/'
}
