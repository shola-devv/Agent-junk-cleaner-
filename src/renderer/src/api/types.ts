export type ApiErrorCode =
  | 'BACKEND_UNAVAILABLE'
  | 'REQUEST_TIMEOUT'
  | 'REQUEST_CANCELLED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'HTTP_ERROR'

export interface ApiError {
  code: ApiErrorCode
  message: string
  status: number | null
  retryable: boolean
  /** Error code string returned by the backend, e.g. RATE_LIMITED or AI_RATE_LIMITED. */
  backendCode?: string
  details?: unknown
}

export interface HealthCheckResponse {
  status: string
  message?: string
}

export interface RequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
  allowEmpty?: boolean
}

export interface ApiEnvelope<T> {
  success: true
  data: T
  requestId?: string
}

export interface ApiFailureEnvelope {
  success?: false
  error?: {
    code?: string
    message?: string
    retryable?: boolean
    details?: unknown
  }
}
