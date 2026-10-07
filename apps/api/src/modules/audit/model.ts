import { t } from 'elysia'

export const auditMetadataKeys = {
  'staff.invited': ['role'],
  'staff.invitation-resent': [],
  'staff.invitation-cancelled': [],
  'staff.invitation-accepted': ['role'],
  'customer.created': [],
  'customer.email-changed': [],
  'staff.role-changed': ['previousRole', 'nextRole'],
  'staff.suspended': ['reason'],
  'staff.reactivated': [],
  'staff.sessions-revoked': [],
  'staff.mfa-reset': [],
  'staff.mfa-activated': [],
  'staff.backup-codes-regenerated': [],
  'settings.staff-mfa-policy-changed': ['previousRequired', 'required'],
  'settings.commerce-updated': ['fields'],
  'order.placed': ['actorType', 'principalId', 'reservationId', 'paymentId', 'totalSatang', 'lineCount'],
  'order.pending_payment': ['actorType', 'principalId', 'reservationId', 'paymentId', 'totalSatang', 'lineCount'],
  'order.cancelled': ['actorType', 'principalId', 'operationId', 'restoredQuantity', 'totalSatang'],
  'order.fulfillment-advanced': ['actorId', 'fromStatus', 'toStatus', 'operationId'],
  'order.cod-collected': ['actorId', 'paymentId', 'amountSatang', 'operationId'],
  'order.guest-access-reissued': ['actorId', 'reasonCode', 'operationId'],
  'order.guest-access-revoked': ['actorId', 'reasonCode', 'operationId'],
  'order.stripe-refund-requested': ['operationId', 'refundId', 'amountSatang'],
  'product.created': ['fields'],
  'product.updated': ['fields'],
  'product.published': [],
  'product.unpublished': [],
  'product.archived': [],
  'product.variant-created': ['fields', 'productId'],
  'product.variant-updated': ['fields', 'productId'],
  'product.variant-archived': ['productId'],
  'farm.created': ['fields'],
  'farm.updated': ['fields'],
  'farm.published': [],
  'farm.unpublished': [],
  'farm.archived': [],
  'product.farms-replaced': ['farmIds'],
  'inventory.received': ['variantId', 'warehouseId', 'quantity'],
  'inventory.written-off': ['variantId', 'warehouseId', 'quantityDelta', 'reasonCode'],
  'inventory.count-adjusted': ['variantId', 'warehouseId', 'quantityDelta', 'reasonCode'],
  'inventory.reserved': ['warehouseId', 'reservationId', 'operationId', 'allocationCount', 'quantity'],
  'inventory.reservation-expired': ['warehouseId', 'reservationId', 'reasonCode'],
  'inventory.reservation-cancelled': ['warehouseId', 'reservationId', 'lotId', 'reasonCode'],
  'inventory.reservation-cancelled-on-confirm': ['warehouseId', 'reservationId', 'reasonCode'],
  'inventory.reservation-confirmed': ['warehouseId', 'reservationId', 'operationId', 'quantity'],
  'inventory.reservation-released': ['warehouseId', 'reservationId', 'quantity'],
  'inventory.quarantined': ['variantId', 'warehouseId', 'reasonCode'],
  'inventory.quarantine-released': ['variantId', 'warehouseId'],
} as const

const auditRecord = t.Object({
  id: t.String(), occurredAt: t.Date(), actorUserId: t.Nullable(t.String()), action: t.String(),
  targetType: t.String(), targetId: t.String(), requestId: t.String(), ipAddress: t.Nullable(t.String()),
  userAgent: t.Nullable(t.String()), metadata: t.Record(t.String(), t.Unknown()),
})

export const auditModels = {
  'audit.listResponse': t.Object({
    items: t.Array(auditRecord),
    nextCursor: t.Nullable(t.String({ description: 'Pass this as cursor to load the next page; null at the end.' })),
  }),
}

export type AuditAction = keyof typeof auditMetadataKeys

export interface AuditEvent {
  id: string
  occurredAt?: Date
  actorUserId?: string | null
  action: AuditAction
  targetType: string
  targetId: string
  requestId: string
  ipAddress?: string | null
  userAgent?: string | null
  metadata: Record<string, unknown>
}

export interface AuditContext {
  requestId: string
  ipAddress: string | null
  userAgent: string | null
}

const forbiddenKeys = new Set([
  'password',
  'cookie',
  'sessiontoken',
  'invitetoken',
  'resettoken',
  'verificationtoken',
  'totpsecret',
  'backupcodes',
  'url',
])

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenKey)
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, child]) =>
      forbiddenKeys.has(key.toLowerCase()) || containsForbiddenKey(child))
  }

  return false
}

export function assertAuditMetadata(event: AuditEvent) {
  const allowedKeys = auditMetadataKeys[event.action] as readonly string[]
  const actualKeys = Object.keys(event.metadata)

  if (containsForbiddenKey(event.metadata) || actualKeys.some((key) => !allowedKeys.includes(key))) {
    throw new Error('INVALID_AUDIT_METADATA')
  }
}
