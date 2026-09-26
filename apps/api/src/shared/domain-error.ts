export type DomainErrorCode =
  | 'IDENTITY_UNAVAILABLE'
  | 'IDENTITY_LOCK_TIMEOUT'
  | 'CLIENT_IP_UNAVAILABLE'
  | 'PRODUCT_NOT_FOUND'
  | 'VARIANT_NOT_FOUND'
  | 'PRODUCT_SLUG_CONFLICT'
  | 'SKU_CONFLICT'
  | 'PRODUCT_STATE_CONFLICT'
  | 'INVALID_PRODUCT'
  | 'LOT_NOT_FOUND'
  | 'WAREHOUSE_NOT_FOUND'
  | 'LOT_CODE_CONFLICT'
  | 'INVENTORY_OPERATION_CONFLICT'
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'INVALID_INVENTORY_COMMAND'
  | 'INVALID_INVENTORY_QUERY'
  | 'INVALID_LOT_CODE'
  | 'INVALID_RECEIPT'

const publicErrors: Record<DomainErrorCode, { status: number; message: string }> = {
  IDENTITY_UNAVAILABLE: { status: 503, message: 'Service temporarily unavailable' },
  IDENTITY_LOCK_TIMEOUT: { status: 503, message: 'Service temporarily unavailable' },
  CLIENT_IP_UNAVAILABLE: { status: 503, message: 'Service temporarily unavailable' },
  PRODUCT_NOT_FOUND: { status: 404, message: 'Product not found' },
  VARIANT_NOT_FOUND: { status: 404, message: 'Variant not found' },
  PRODUCT_SLUG_CONFLICT: { status: 409, message: 'Product slug is already in use' },
  SKU_CONFLICT: { status: 409, message: 'Variant SKU is already in use' },
  PRODUCT_STATE_CONFLICT: { status: 409, message: 'Product state does not allow this action' },
  INVALID_PRODUCT: { status: 422, message: 'Product data is invalid' },
  LOT_NOT_FOUND: { status: 404, message: 'Inventory lot not found' },
  WAREHOUSE_NOT_FOUND: { status: 404, message: 'Warehouse not found' },
  LOT_CODE_CONFLICT: { status: 409, message: 'Lot code is already in use for this variant' },
  INVENTORY_OPERATION_CONFLICT: { status: 409, message: 'Idempotency key was already used with different input' },
  INVALID_IDEMPOTENCY_KEY: { status: 422, message: 'Idempotency key is invalid' },
  INVALID_INVENTORY_COMMAND: { status: 422, message: 'Inventory command is invalid' },
  INVALID_INVENTORY_QUERY: { status: 422, message: 'Inventory query is invalid' },
  INVALID_LOT_CODE: { status: 422, message: 'Lot code is invalid' },
  INVALID_RECEIPT: { status: 422, message: 'Inventory receipt is invalid' },
}

const legacyDomainErrors: Record<string, { status: number; message: string }> = {
  AUTHENTICATION_REQUIRED: { status: 401, message: 'Authentication required' },
  EMAIL_CHANGE_CODE_INVALID: { status: 422, message: 'Email change code is invalid' },
  EMAIL_CHANGE_CODE_EXPIRED: { status: 410, message: 'Email change code has expired' },
  CUSTOMER_ACCOUNT_REQUIRED: { status: 403, message: 'Customer account required' },
  INVALID_PROFILE_NAME: { status: 422, message: 'Request validation failed' },
  VALIDATION_ERROR: { status: 422, message: 'Request validation failed' },
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
  INVALID_CURRENT_PASSWORD: { status: 422, message: 'Current password is invalid' },
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
