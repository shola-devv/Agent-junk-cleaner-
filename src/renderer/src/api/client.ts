import { getApiBaseUrl, API_TIMEOUT_MS, isApiConfigured } from './config'
import { ApiClientError, createApiError, errorForStatus } from './errors'
import type { ApiEnvelope, ApiFailureEnvelope, HealthCheckResponse, RequestOptions } from './types'

async function requestJson<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  options: RequestOptions = {}
): Promise<T> {
  if (!isApiConfigured()) throw createApiError('BACKEND_UNAVAILABLE')
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
    const baseUrl = getApiBaseUrl().endsWith('/') ? getApiBaseUrl() : `${getApiBaseUrl()}/`
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
      const envelope: ApiFailureEnvelope =
        typeof payload === 'object' && payload !== null ? (payload as ApiFailureEnvelope) : {}
      const backendError = envelope.error
      const serverMessage =
        typeof backendError?.message === 'string' ? backendError.message.slice(0, 400) : undefined
      const backendCode = typeof backendError?.code === 'string' ? backendError.code : undefined
      const apiError = errorForStatus(response.status, serverMessage, backendError?.details, backendCode)
      if (backendError?.retryable && !apiError.retryable) {
        throw createApiError(apiError.code, {
          status: response.status,
          retryable: true,
          details: backendError.details,
          message: serverMessage,
          backendCode
        })
      }
      throw apiError
    }

    if (!text.trim()) {
      if (options.allowEmpty || response.status === 204) return undefined as T
      throw createApiError('INVALID_RESPONSE', {
        status: response.status,
        message: 'The backend returned an empty response.'
      })
    }

    if (typeof payload === 'object' && payload !== null && 'success' in payload) {
      const envelope = payload as ApiEnvelope<T> | ApiFailureEnvelope
      if (envelope.success === false) {
        const backendError = envelope.error
      throw createApiError('HTTP_ERROR', {
        status: response.status,
        retryable: backendError?.retryable,
        details: backendError?.details,
        message: backendError?.message ?? 'The backend could not complete the request.',
        backendCode: typeof backendError?.code === 'string' ? backendError.code : undefined
      })
      }
      if (envelope.success === true && 'data' in envelope) return envelope.data
      throw createApiError('INVALID_RESPONSE', { status: response.status })
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
