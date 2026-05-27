import type { ToastRef } from './types'

declare global {
  interface Window {
    _env_?: {
      ENVIRONMENT?: string
      API_BASE_URL?: string
    }
    toast?: ToastRef | null
  }
}

export {}
