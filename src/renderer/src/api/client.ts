import { API_BASE_URL, API_TIMEOUT_MS, isApiConfigured } from './config'
import { ApiClientError, createApiError, errorForStatus } from './errors'
import type { HealthCheckResponse, RequestOptions } from './types'

async function requestJson<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  options: RequestOptions = {}
): Promise<T> {
  if (!isApiConfigured) throw createApiError('BACKEND_UNAVAILABLE')
  if (options.signal?.aborted) throw createApiError('REQUEST_CANCELLED')

  const controller = new AbortController()
  let timedOut = false
  const timeoutMs = options.timeoutMs ?? API_TIMEOUT_MS
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const abortRequest = (): void => controller.abort()
  options.signal?.addEventListener('abort', abortRequest, { once: true })

  try {
    const baseUrl = API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`
    const endpoint = new URL(path.replace(/^\/+/, ''), baseUrl)
    const response = await fetch(endpoint, {
      method,
      headers: {
        Accept: 'application/json',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {})
      },
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
      signal: controller.signal
    })
    const text = await response.text()
    let payload: unknown
    if (text.trim()) {
      try {
        payload = JSON.parse(text)
      } catch {
        if (response.ok) throw createApiError('INVALID_RESPONSE', { status: response.status })
      }
    }

    if (!response.ok) {
      const errorPayload =
        typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
      const serverMessage =
        typeof errorPayload.message === 'string'
          ? errorPayload.message.slice(0, 400)
          : typeof errorPayload.error === 'string'
            ? errorPayload.error.slice(0, 400)
            : undefined
      throw errorForStatus(response.status, serverMessage, errorPayload.details)
    }

    if (!text.trim()) {
      if (options.allowEmpty || response.status === 204) return undefined as T
      throw createApiError('INVALID_RESPONSE', {
        status: response.status,
        message: 'The backend returned an empty response.'
      })
    }

    return payload as T
  } catch (error) {
    if (error instanceof ApiClientError) throw error
    if (timedOut) throw createApiError('REQUEST_TIMEOUT', { retryable: true })
    if (options.signal?.aborted) throw createApiError('REQUEST_CANCELLED')
    throw createApiError('BACKEND_UNAVAILABLE', { retryable: true })
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abortRequest)
  }
}

export const apiClient = {
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return requestJson<T>('GET', path, undefined, options)
  },
  post<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
    return requestJson<T>('POST', path, body, options)
  },
  async healthCheck(signal?: AbortSignal): Promise<HealthCheckResponse> {
    const response = await requestJson<unknown>('GET', '/health', undefined, { signal })
    if (
      typeof response !== 'object' ||
      response === null ||
      typeof (response as Record<string, unknown>).status !== 'string'
    ) {
      throw createApiError('INVALID_RESPONSE', {
        message: 'The backend health check returned an unexpected response.'
      })
    }
    return response as HealthCheckResponse
  }
}
