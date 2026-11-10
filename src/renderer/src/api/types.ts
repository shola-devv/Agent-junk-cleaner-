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
