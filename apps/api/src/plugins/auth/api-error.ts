import { isAPIError } from 'better-auth/api'

const mappedErrors = {
  400: { code: 'AUTH_REQUEST_INVALID', message: 'Authentication request is invalid' },
  401: { code: 'AUTHENTICATION_FAILED', message: 'Authentication failed' },
  403: { code: 'AUTHORIZATION_FAILED', message: 'Authentication request is not allowed' },
  404: { code: 'AUTH_RESOURCE_NOT_FOUND', message: 'Authentication resource not found' },
  409: { code: 'AUTH_CONFLICT', message: 'Authentication request conflicts with current state' },
  422: { code: 'AUTH_REQUEST_INVALID', message: 'Authentication request is invalid' },
  429: { code: 'RATE_LIMITED', message: 'Too many requests' },
} as const

export function mapAuthApiError(error: unknown) {
  if (!isAPIError(error)) {
    return null
  }

  const status = error.statusCode as keyof typeof mappedErrors
  const body = mappedErrors[status]

  if (!body) {
    return null
  }

  const headers = error.headers as Headers | Record<string, string> | undefined
  const retryAfter = headers instanceof Headers
    ? headers.get('retry-after')
    : headers?.['Retry-After'] ?? headers?.['retry-after']

  return {
    status,
    body,
    ...(retryAfter ? { headers: { 'Retry-After': retryAfter } } : {}),
  }
}
