export type DomainErrorCode =
  | 'IDENTITY_UNAVAILABLE'
  | 'IDENTITY_LOCK_TIMEOUT'
  | 'CLIENT_IP_UNAVAILABLE'
  | 'AUTHENTICATION_REQUIRED'
  | 'EMAIL_VERIFICATION_REQUIRED'
  | 'PRODUCT_NOT_FOUND'
  | 'VARIANT_NOT_FOUND'
  | 'PRODUCT_SLUG_CONFLICT'
  | 'SKU_CONFLICT'
  | 'PRODUCT_STATE_CONFLICT'
  | 'INVALID_PRODUCT'
  | 'FARM_NOT_FOUND'
  | 'FARM_SLUG_CONFLICT'
  | 'FARM_STATE_CONFLICT'
  | 'INVALID_FARM'
  | 'INVALID_FARM_ASSOCIATION'
  | 'LOT_NOT_FOUND'
  | 'RESERVATION_NOT_FOUND'
  | 'WAREHOUSE_NOT_FOUND'
  | 'LOT_CODE_CONFLICT'
  | 'INVENTORY_OPERATION_CONFLICT'
  | 'RESERVATION_NOT_CONFIRMABLE'
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'INVALID_INVENTORY_COMMAND'
  | 'INVALID_INVENTORY_QUERY'
  | 'INVALID_LOT_CODE'
  | 'INVALID_RECEIPT'
  | 'INVENTORY_STOCK_CONFLICT'
  | 'INVALID_CART'
  | 'CART_VARIANT_UNAVAILABLE'
  | 'CART_LINE_LIMIT_REACHED'
  | 'CART_QUANTITY_LIMIT_REACHED'
  | 'INVALID_COMMERCE_SETTINGS'
  | 'COMMERCE_SETTINGS_UNAVAILABLE'
  | 'INVALID_RECEIPT_SETTINGS'
  | 'RECEIPT_SETTINGS_UNAVAILABLE'
  | 'RECEIPT_NOT_ELIGIBLE'
  | 'RECEIPT_SETTINGS_INCOMPLETE'
  | 'RECEIPT_NOT_FOUND'
  | 'INVALID_STORE_ANNOUNCEMENT'
  | 'STORE_ANNOUNCEMENT_UNAVAILABLE'
  | 'INVALID_MARKETING_RANGE'
  | 'INVALID_MARKETING_SETTINGS'
  | 'MARKETING_SETTINGS_CONFLICT'
  | 'INVALID_MARKETING_FILTER'
  | 'POSTHOG_READ_NOT_CONFIGURED'
  | 'POSTHOG_READ_AUTH'
  | 'POSTHOG_READ_UNAVAILABLE'
  | 'POSTHOG_READ_REJECTED'
  | 'INVALID_CONSENT'
  | 'CONSENT_POLICY_OUTDATED'
  | 'CHECKOUT_DISABLED'
  | 'SHIPPING_FEE_UNSET'
  | 'CART_NOT_PURCHASABLE'
  | 'QUOTE_STALE'
  | 'CHECKOUT_TOTAL_OUT_OF_RANGE'
  | 'INVALID_PAYMENT_AMOUNT'
  | 'STRIPE_NOT_CONFIGURED'
  | 'STRIPE_CHECKOUT_UNAVAILABLE'
  | 'STRIPE_REFUND_UNAVAILABLE'
  | 'INVALID_ORDER_COMMAND'
  | 'INVALID_ORDER_INPUT'
  | 'ORDER_OPERATION_CONFLICT'
  | 'ORDER_ADDRESS_NOT_FOUND'
  | 'CUSTOMER_NOT_FOUND'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_ACCESS_DENIED'
  | 'INVALID_ORDER_TRANSITION'
  | 'ORDER_PAYMENT_CONFLICT'
  | 'ORDER_REFUND_CONFLICT'
  | 'COD_AMOUNT_MISMATCH'
  | 'INVALID_ORDER_QUERY'
  | 'SHIPMENT_REQUIRED'
  | 'INVALID_SHIPMENT'
  | 'INVALID_MEDIA'
  | 'MEDIA_NOT_FOUND'
  | 'MEDIA_IN_USE'
  | 'MEDIA_STATE_CONFLICT'
  | 'MEDIA_STORAGE_UNAVAILABLE'

const publicErrors: Record<DomainErrorCode, { status: number; message: string }> = {
  IDENTITY_UNAVAILABLE: { status: 503, message: 'Service temporarily unavailable' },
  IDENTITY_LOCK_TIMEOUT: { status: 503, message: 'Service temporarily unavailable' },
  CLIENT_IP_UNAVAILABLE: { status: 503, message: 'Service temporarily unavailable' },
  AUTHENTICATION_REQUIRED: { status: 401, message: 'Authentication required' },
  EMAIL_VERIFICATION_REQUIRED: { status: 403, message: 'Email verification required' },
  PRODUCT_NOT_FOUND: { status: 404, message: 'Product not found' },
  VARIANT_NOT_FOUND: { status: 404, message: 'Variant not found' },
  PRODUCT_SLUG_CONFLICT: { status: 409, message: 'Product slug is already in use' },
  SKU_CONFLICT: { status: 409, message: 'Variant SKU is already in use' },
  PRODUCT_STATE_CONFLICT: { status: 409, message: 'Product state does not allow this action' },
  INVALID_PRODUCT: { status: 422, message: 'Product data is invalid' },
  FARM_NOT_FOUND: { status: 404, message: 'Farm not found' },
  FARM_SLUG_CONFLICT: { status: 409, message: 'Farm slug is already in use' },
  FARM_STATE_CONFLICT: { status: 409, message: 'Farm state does not allow this action' },
  INVALID_FARM: { status: 422, message: 'Farm data is invalid' },
  INVALID_FARM_ASSOCIATION: { status: 422, message: 'Product farm associations are invalid' },
  LOT_NOT_FOUND: { status: 404, message: 'Inventory lot not found' },
  RESERVATION_NOT_FOUND: { status: 404, message: 'Inventory reservation not found' },
  WAREHOUSE_NOT_FOUND: { status: 404, message: 'Warehouse not found' },
  LOT_CODE_CONFLICT: { status: 409, message: 'Lot code is already in use for this variant' },
  INVENTORY_OPERATION_CONFLICT: { status: 409, message: 'Idempotency key was already used with different input' },
  RESERVATION_NOT_CONFIRMABLE: { status: 409, message: 'Inventory reservation is no longer eligible for confirmation' },
  INVALID_IDEMPOTENCY_KEY: { status: 422, message: 'Idempotency key is invalid' },
  INVALID_INVENTORY_COMMAND: { status: 422, message: 'Inventory command is invalid' },
  INVALID_INVENTORY_QUERY: { status: 422, message: 'Inventory query is invalid' },
  INVALID_LOT_CODE: { status: 422, message: 'Lot code is invalid' },
  INVALID_RECEIPT: { status: 422, message: 'Inventory receipt is invalid' },
  INVENTORY_STOCK_CONFLICT: { status: 409, message: 'Inventory stock does not allow this action' },
  INVALID_CART: { status: 422, message: 'Cart request is invalid' },
  CART_VARIANT_UNAVAILABLE: { status: 409, message: 'Cart item is unavailable' },
  CART_LINE_LIMIT_REACHED: { status: 409, message: 'Cart line limit has been reached' },
  CART_QUANTITY_LIMIT_REACHED: { status: 422, message: 'Cart item quantity is above the allowed limit' },
  INVALID_COMMERCE_SETTINGS: { status: 422, message: 'Commerce settings are invalid' },
  COMMERCE_SETTINGS_UNAVAILABLE: { status: 503, message: 'Commerce settings are unavailable' },
  INVALID_RECEIPT_SETTINGS: { status: 422, message: 'Receipt settings are invalid' },
  RECEIPT_SETTINGS_UNAVAILABLE: { status: 503, message: 'Receipt settings are unavailable' },
  RECEIPT_NOT_ELIGIBLE: { status: 409, message: 'Order is not eligible for a receipt' },
  RECEIPT_SETTINGS_INCOMPLETE: { status: 409, message: 'Receipt seller settings are incomplete' },
  RECEIPT_NOT_FOUND: { status: 404, message: 'Receipt was not found' },
  INVALID_STORE_ANNOUNCEMENT: { status: 422, message: 'Store announcement is invalid' },
  STORE_ANNOUNCEMENT_UNAVAILABLE: { status: 503, message: 'Store announcement is unavailable' },
  INVALID_MARKETING_RANGE: { status: 422, message: 'Marketing date range is invalid' },
  INVALID_MARKETING_SETTINGS: { status: 422, message: 'Marketing settings are invalid' },
  MARKETING_SETTINGS_CONFLICT: { status: 409, message: 'Marketing settings changed; reload and try again' },
  INVALID_MARKETING_FILTER: { status: 422, message: 'Marketing filter is invalid' },
  POSTHOG_READ_NOT_CONFIGURED: { status: 503, message: 'PostHog reporting is not configured' },
  POSTHOG_READ_AUTH: { status: 503, message: 'PostHog reporting is unavailable' },
  POSTHOG_READ_UNAVAILABLE: { status: 503, message: 'PostHog reporting is unavailable' },
  POSTHOG_READ_REJECTED: { status: 503, message: 'PostHog reporting is unavailable' },
  INVALID_CONSENT: { status: 422, message: 'Consent request is invalid' },
  CONSENT_POLICY_OUTDATED: { status: 422, message: 'Consent policy version is outdated' },
  CHECKOUT_DISABLED: { status: 409, message: 'Checkout is disabled' },
  SHIPPING_FEE_UNSET: { status: 409, message: 'Shipping fee is not configured' },
  CART_NOT_PURCHASABLE: { status: 409, message: 'One or more cart items cannot be purchased' },
  QUOTE_STALE: { status: 409, message: 'Checkout quote is expired or no longer current' },
  CHECKOUT_TOTAL_OUT_OF_RANGE: { status: 422, message: 'Checkout total is outside the supported range' },
  INVALID_PAYMENT_AMOUNT: { status: 422, message: 'Payment amount is invalid' },
  STRIPE_NOT_CONFIGURED: { status: 503, message: 'Online payment is unavailable' },
  STRIPE_CHECKOUT_UNAVAILABLE: { status: 503, message: 'Online payment is temporarily unavailable' },
  STRIPE_REFUND_UNAVAILABLE: { status: 503, message: 'Online refund is temporarily unavailable' },
  INVALID_ORDER_COMMAND: { status: 422, message: 'Order command is invalid' },
  INVALID_ORDER_INPUT: { status: 422, message: 'Order request is invalid' },
  ORDER_OPERATION_CONFLICT: { status: 409, message: 'Idempotency key was already used with different input' },
  ORDER_ADDRESS_NOT_FOUND: { status: 404, message: 'Saved address not found' },
  CUSTOMER_NOT_FOUND: { status: 404, message: 'Customer not found' },
  ORDER_NOT_FOUND: { status: 404, message: 'Order not found' },
  ORDER_ACCESS_DENIED: { status: 403, message: 'Order access denied' },
  INVALID_ORDER_TRANSITION: { status: 409, message: 'Order state does not allow this action' },
  ORDER_PAYMENT_CONFLICT: { status: 409, message: 'Order payment state does not allow this action' },
  ORDER_REFUND_CONFLICT: { status: 409, message: 'Order refund state does not allow this action' },
  COD_AMOUNT_MISMATCH: { status: 422, message: 'Collected amount must match the order total' },
  INVALID_ORDER_QUERY: { status: 422, message: 'Order query is invalid' },
  SHIPMENT_REQUIRED: { status: 422, message: 'Carrier and tracking number are required to ship an order' },
  INVALID_SHIPMENT: { status: 422, message: 'Shipment details are invalid' },
  INVALID_MEDIA: { status: 422, message: 'Media file is invalid' },
  MEDIA_NOT_FOUND: { status: 404, message: 'Media not found' },
  MEDIA_IN_USE: { status: 409, message: 'Media is in use' },
  MEDIA_STATE_CONFLICT: { status: 409, message: 'Media state does not allow this action' },
  MEDIA_STORAGE_UNAVAILABLE: { status: 503, message: 'Media storage is unavailable' },
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
  ACCOUNT_HAS_OPEN_ORDERS: { status: 409, message: 'Finish or cancel open orders before deleting the account' },
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
