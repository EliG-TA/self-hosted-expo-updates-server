import _ from 'lodash'

import { isObject, localStorage, useCapsule } from './Functions'

const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development'

type Subscription = () => void

class Capsule<T = unknown> {
  name: string
  _subscriptions: Set<Subscription>
  _initialValue: T
  _value: T

  constructor(name: string, initialValue: T) {
    this.name = name
    this._subscriptions = new Set()
    this._initialValue = initialValue
    this._value = initialValue

    this.setState = this.setState.bind(this)
    this.resetState = this.resetState.bind(this)
    this.subscribe = this.subscribe.bind(this)
    this.unsubscribe = this.unsubscribe.bind(this)
    this.useState = this.useState.bind(this)
  }

  get state() {
    return this._value
  }

  setState(newValue: T) {
    this._value = newValue
    for (const subscription of this._subscriptions) {
      subscription()
    }
    isDev && console.log('SetStore', this.name, isObject(newValue) ? _.omit(newValue, 'jwt') : newValue)
  }

  patchState(newState: Partial<T>) {
    if (!isObject(newState) || !isObject(this._value)) return false
    this.setState({ ...this._value, ...newState })
    return true
  }

  resetState() {
    this._value = this._initialValue
  }

  subscribe(callback: Subscription) {
    this._subscriptions.add(callback)
    return () => {
      this.unsubscribe(callback)
    }
  }

  unsubscribe(callback: Subscription) {
    this._subscriptions.delete(callback)
  }

  useState() {
    // eslint-disable-next-line
    return useCapsule(this)
  }
}

class StoredCapsule<T = unknown> extends Capsule<T> {
  constructor(name: string, initialValue: T) {
    super(name, initialValue)
    const storedState = localStorage.get(name)
    storedState !== null && super.setState(storedState as T)
  }

  patchState(newValue: Partial<T>) {
    const patched = super.patchState(newValue)
    window.localStorage.setItem(this.name, JSON.stringify(newValue))
    return patched
  }

  setState(newState: T) {
    super.setState(newState)
    window.localStorage.setItem(this.name, JSON.stringify(newState))
  }

  resetState() {
    super.resetState()
    window.localStorage.removeItem(this.name)
  }
}

export { Capsule, StoredCapsule }
