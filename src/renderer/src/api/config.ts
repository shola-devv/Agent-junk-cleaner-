const DEPLOYED_API_BASE_URL = 'https://ajent-junk-cleaner-backend.onrender.com'

const STORAGE_KEY = 'ajc.backend-endpoint.v1'
const OBFUSCATION_KEY = 'AgentJunkCleaner::backend-endpoint'

const buildDefaultBaseUrl = (): string =>
  import.meta.env.VITE_API_BASE_URL?.trim() || DEPLOYED_API_BASE_URL

export const DEFAULT_API_BASE_URL = buildDefaultBaseUrl()
export const API_TIMEOUT_MS = 15_000

/** Lightly obscures a string so a stored backend URL is not plainly readable on disk. */
function obfuscate(value: string): string {
  const bytes = new TextEncoder().encode(value)
  const keyBytes = new TextEncoder().encode(OBFUSCATION_KEY)
  const masked = bytes.map((byte, index) => byte ^ keyBytes[index % keyBytes.length])
  let binary = ''
  masked.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

function deobfuscate(value: string): string | null {
  try {
    const binary = atob(value)
    const keyBytes = new TextEncoder().encode(OBFUSCATION_KEY)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const decoded = bytes.map((byte, index) => byte ^ keyBytes[index % keyBytes.length])
    return new TextDecoder().decode(decoded)
  } catch {
    return null
  }
}

function isValidBaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function readStoredOverride(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const decoded = deobfuscate(raw)
    return decoded && isValidBaseUrl(decoded) ? decoded.replace(/\/+$/, '') : null
  } catch {
    return null
  }
}

let currentBaseUrl = readStoredOverride() ?? DEFAULT_API_BASE_URL

const listeners = new Set<() => void>()

export function getApiBaseUrl(): string {
  return currentBaseUrl
}

export function isUsingDefaultApiBaseUrl(): boolean {
  return readStoredOverride() === null
}

export function isApiConfigured(): boolean {
  return currentBaseUrl.length > 0
}

/** Persists an obfuscated custom backend URL; pass null to reset to the default. */
export function setApiBaseUrl(value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(STORAGE_KEY)
      currentBaseUrl = DEFAULT_API_BASE_URL
    } else {
      const trimmed = value.trim().replace(/\/+$/, '')
      if (!isValidBaseUrl(trimmed)) throw new Error('Enter a valid http(s) backend URL.')
      localStorage.setItem(STORAGE_KEY, obfuscate(trimmed))
      currentBaseUrl = trimmed
    }
    listeners.forEach((listener) => listener())
  } catch (error) {
    throw error instanceof Error ? error : new Error('Could not save the backend URL.')
  }
}

export function onApiBaseUrlChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
