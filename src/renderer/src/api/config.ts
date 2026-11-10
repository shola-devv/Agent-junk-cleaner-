const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()

export const API_BASE_URL =
  configuredBaseUrl || (import.meta.env.DEV ? 'http://localhost:3000' : '')

export const API_TIMEOUT_MS = 15_000
export const isApiConfigured = API_BASE_URL.length > 0
