interface Window {
  _env_?: {
    ENVIRONMENT?: string
    API_BASE_URL?: string
  }
  toast?: {
    show: (message: any) => void
  } | null
}
