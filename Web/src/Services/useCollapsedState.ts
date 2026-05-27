import { useState, useCallback } from 'react'

/**
 * Persist a boolean collapsed/expanded UI state in localStorage so a user's
 * preference survives page reloads and component remounts.
 *
 * Usage:
 *   const [collapsed, setCollapsed] = useCollapsedState('published:app:53.1', false)
 */
export const useCollapsedState = (key: string, defaultCollapsed = false): [boolean, (next: boolean) => void] => {
  const [collapsed, setCollapsed] = useState(() => {
    if (!key) return defaultCollapsed
    try {
      const raw = window.localStorage.getItem(key)
      if (raw === null) return defaultCollapsed
      return raw === '1'
    } catch (e) {
      return defaultCollapsed
    }
  })

  const setAndPersist = useCallback((next: boolean) => {
    setCollapsed(next)
    if (!key) return
    try {
      window.localStorage.setItem(key, next ? '1' : '0')
    } catch (e) { /* storage unavailable / quota; ignore */ }
  }, [key])

  return [collapsed, setAndPersist]
}
