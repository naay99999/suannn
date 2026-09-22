import { Elysia } from 'elysia'
import { mapAuthApiError } from './auth/api-error'
import { logError } from '../shared/logger'

const domainErrors: Record<string, { status: 401 | 403 | 404 | 409 | 410 | 422; message: string }> = {
  ONBOARDING_SESSION_REQUIRED: { status: 401, message: 'Staff onboarding session required' },
  ACTIVE_STAFF_SESSION_REQUIRED: { status: 401, message: 'Active staff session required' },
  OWNER_REQUIRED: { status: 403, message: 'Owner access required' },
  SELF_ROLE_CHANGE: { status: 403, message: 'Cannot change your own role' },
  SELF_SUSPEND: { status: 403, message: 'Cannot suspend yourself' },
  SELF_MFA_RESET: { status: 403, message: 'Cannot reset your own MFA' },
  STAFF_NOT_FOUND: { status: 404, message: 'Staff member not found' },
  SESSION_NOT_FOUND: { status: 404, message: 'Session not found' },
  OWNER_INVARIANT: { status: 409, message: 'At least one active owner is required' },
  EMAIL_UNAVAILABLE: { status: 409, message: 'Email is unavailable' },
  INVALID_INVITATION: { status: 410, message: 'Invitation is invalid or expired' },
  INVALID_ROLE: { status: 422, message: 'Role is invalid' },
}

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

      if (error instanceof Error && domainErrors[error.message]) {
        const mapped = domainErrors[error.message]!
        set.status = mapped.status
        return { code: error.message, message: mapped.message }
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
