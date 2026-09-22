export const auditMetadataKeys = {
  'staff.invited': ['role'],
  'staff.invitation-resent': [],
  'staff.invitation-cancelled': [],
  'staff.invitation-accepted': ['role'],
  'customer.created': [],
  'auth.sign-in-failed': ['reason'],
  'staff.role-changed': ['previousRole', 'nextRole'],
  'staff.suspended': ['reason'],
  'staff.mfa-reset': [],
} as const

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
