import { Elysia } from 'elysia'
import { mapAuthApiError } from './auth/api-error'
import { logError } from '../shared/logger'
import { mapDomainError } from '../shared/domain-error'

export function createErrorHandlingPlugin() {
  return new Elysia({ name: 'error-handling' })
    .onError({ as: 'global' }, ({ code, error, set }) => {
      if (code === 'NOT_FOUND') {
        set.status = 404
        return { code: 'NOT_FOUND', message: 'Not found' }
      }

      if (code === 'VALIDATION') {
        set.status = 422
        return { code: 'VALIDATION_ERROR', message: 'Request validation failed' }
      }

      const authError = mapAuthApiError(error)

      if (authError) {
        set.status = authError.status

        if (authError.headers) {
          Object.assign(set.headers, authError.headers)
        }

        return authError.body
      }

      const domainError = mapDomainError(error)
      if (domainError) {
        set.status = domainError.status
        if (!(error instanceof Error && error.name === 'DomainError')) {
          return domainError.body
        }
        logError({
          level: 'error',
          code: String(domainError.body.code),
          message: String(domainError.body.code),
          requestId: set.headers['x-request-id']?.toString(),
        })
        return domainError.body
      }

      logError({
        level: 'error',
        code: String(code),
        message: 'Unhandled request error',
        errorCategory: error instanceof Error ? error.name : 'UnknownError',
        requestId: set.headers['x-request-id']?.toString(),
      })

      set.status = 500
      return { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    })
}
