import { Elysia } from 'elysia'
import { logError } from '../shared/logger'

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

      const errorDetails = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: 'Unknown error' }

      logError({
        level: 'error',
        code: String(code),
        ...errorDetails,
      })

      set.status = 500
      return { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    })
}
