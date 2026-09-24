export type DomainErrorCode =
  | 'IDENTITY_UNAVAILABLE'
  | 'IDENTITY_LOCK_TIMEOUT'
  | 'CLIENT_IP_UNAVAILABLE'

const publicErrors: Record<DomainErrorCode, { status: number; message: string }> = {
  IDENTITY_UNAVAILABLE: { status: 503, message: 'Service temporarily unavailable' },
  IDENTITY_LOCK_TIMEOUT: { status: 503, message: 'Service temporarily unavailable' },
  CLIENT_IP_UNAVAILABLE: { status: 503, message: 'Service temporarily unavailable' },
}

const legacyDomainErrors: Record<string, { status: number; message: string }> = {
  CUSTOMER_ACCOUNT_REQUIRED: { status: 403, message: 'Customer account required' },
  INVALID_PROFILE_NAME: { status: 422, message: 'Request validation failed' },
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
  INVALID_CURSOR: { status: 422, message: 'Pagination cursor is invalid' },
  INVALID_ADDRESS: { status: 422, message: 'Request validation failed' },
  ADDRESS_NOT_FOUND: { status: 404, message: 'Address not found' },
  ADDRESS_LIMIT_REACHED: { status: 409, message: 'Address limit reached' },
}

export class DomainError extends Error {
  readonly status: number
  readonly publicMessage: string

  constructor(readonly code: DomainErrorCode) {
    super(code)
    this.name = 'DomainError'
    this.status = publicErrors[code].status
    this.publicMessage = publicErrors[code].message
  }
}

export function mapDomainError(error: unknown) {
  const code = error instanceof DomainError ? error.code
    : error instanceof Error ? error.message : null
  const details = error instanceof DomainError ? publicErrors[error.code]
    : code ? legacyDomainErrors[code] : undefined
  return details && code ? {
    status: details.status,
    body: { code, message: details.message },
  } : null
}
