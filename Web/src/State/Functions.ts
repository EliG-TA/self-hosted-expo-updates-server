import React from 'react'
import { omit } from 'lodash'
import useForceUpdate from 'use-force-update'

interface CapsuleLike<T = unknown> {
  state: T
  setState(value: T): void
  subscribe(callback: () => void): () => void
  resetState(): void
}

type StateMap = Record<string, CapsuleLike<Record<string, unknown>>>

export const objectMap = <T, R>(obj: Record<string, T>, fn: (key: string, value: T) => R) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(k, v)]))

export const dumpStates = (state: StateMap) => Object.values(state).map(({ state }) => omit(state, 'accessToken'))

export const resetStates = (state: Record<string, { resetState: () => void }>) => Object.values(state).map(a => a.resetState())

export const isObject = (obj: unknown): obj is Record<string, unknown> => obj !== null && typeof obj === 'object'

export const useCapsule = <T>(capsule: CapsuleLike<T>) => {
  const forceUpdate = useForceUpdate()

  const setState = React.useCallback((newValue: T | ((current: T) => T)) => {
    const newState = typeof newValue !== 'function' ? newValue : (newValue as (current: T) => T)(capsule.state)
    capsule.setState(newState)
  }, [capsule])

  React.useLayoutEffect(() => capsule.subscribe(forceUpdate), [capsule, forceUpdate])

  return [capsule.state, setState]
}

export const localStorage = {
  get: (key: string) => { try { return JSON.parse(window.localStorage.getItem(key) || 'null') as unknown } catch (e) { } return null },
  set: (key: string, value: unknown) => { try { window.localStorage.setItem(key, JSON.stringify(value)) } catch (e) { } },
  remove: (key: string) => { try { window.localStorage.removeItem(key) } catch (e) { } }
}
