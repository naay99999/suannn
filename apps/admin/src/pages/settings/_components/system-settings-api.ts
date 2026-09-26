import { api } from '@/lib/api'
import { AuthRequestError } from '@/lib/auth-client'

function dataOrError<T>(result: { data: T | null; error: unknown; status: number }): T {
  if (result.error) {
    const value = typeof result.error === 'object' && result.error !== null && 'value' in result.error
      ? result.error.value
      : result.error
    const body = typeof value === 'object' && value !== null ? value : {}
    const code = 'code' in body && typeof body.code === 'string' ? body.code : 'SETTINGS_REQUEST_FAILED'
    const message = result.status >= 500
      ? 'The server could not complete this request. Try again.'
      : 'message' in body && typeof body.message === 'string'
        ? body.message
        : 'Could not complete this request.'
    throw new AuthRequestError(result.status, code, message)
  }
  if (result.data === null) throw new AuthRequestError(502, 'EMPTY_RESPONSE', 'Could not complete this request.')
  return result.data
}

export function getSecuritySettings() {
  return api.settings.security.get().then(dataOrError)
}

export function setStaffMfaRequired(staffMfaRequired: boolean) {
  return api.settings.security.patch({ staffMfaRequired }).then(dataOrError)
}
