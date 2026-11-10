import type { ApiError, ApiErrorCode } from './types'

export class ApiClientError extends Error implements ApiError {
  readonly code: ApiErrorCode
  readonly status: number | null
  readonly retryable: boolean
  readonly details?: unknown

  constructor(error: ApiError) {
    super(error.message)
    this.name = 'ApiClientError'
    this.code = error.code
    this.status = error.status
    this.retryable = error.retryable
    this.details = error.details
  }
}

const STATUS_MESSAGES: Record<ApiErrorCode, string> = {
  BACKEND_UNAVAILABLE: 'The backend could not be reached. Check the service and try again.',
  REQUEST_TIMEOUT: 'The request took too long. Please try again.',
  REQUEST_CANCELLED: 'The request was cancelled.',
  UNAUTHORIZED: 'Your session is not authorized. Sign in and try again.',
  FORBIDDEN: 'You do not have permission to make this request.',
  RATE_LIMITED: 'Too many requests. Wait a moment and try again.',
  SERVER_ERROR: 'The server encountered an error. Please try again later.',
  SERVICE_UNAVAILABLE: 'The backend service is temporarily unavailable.',
  INVALID_RESPONSE: 'The backend returned an invalid response.',
  HTTP_ERROR: 'The request could not be completed.'
}

export function createApiError(
  code: ApiErrorCode,
  options: { status?: number | null; retryable?: boolean; details?: unknown; message?: string } = {}
): ApiClientError {
  return new ApiClientError({
    code,
    status: options.status ?? null,
    retryable: options.retryable ?? false,
    message: options.message ?? STATUS_MESSAGES[code],
    ...(options.details === undefined ? {} : { details: options.details })
  })
}

export function errorForStatus(
  status: number,
  message?: string,
  details?: unknown
): ApiClientError {
  let code: ApiErrorCode = 'HTTP_ERROR'
  if (status === 401) code = 'UNAUTHORIZED'
  else if (status === 403) code = 'FORBIDDEN'
  else if (status === 429) code = 'RATE_LIMITED'
  else if (status === 503) code = 'SERVICE_UNAVAILABLE'
  else if (status >= 500) code = 'SERVER_ERROR'
  else if (status === 408) code = 'REQUEST_TIMEOUT'

  return createApiError(code, {
    status,
    retryable: status === 408 || status === 429 || status >= 500,
    details,
    message
  })
}
