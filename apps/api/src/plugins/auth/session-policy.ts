import {
  hasPermissions,
  isStaffRole,
  type AccountType,
  type PermissionRequirement,
  type Role,
} from './access-control'

const idleTimeoutMs = 30 * 60 * 1000
const activityWriteIntervalMs = 60 * 1000

export interface StaffSessionContext {
  user: {
    id: string
    accountType: AccountType
    role: Role
    emailVerified: boolean
    staffActivatedAt: Date | null
    banned: boolean
  }
  session: {
    id: string
    lastActivityAt: Date | null
    absoluteExpiresAt: Date | null
  }
}

export type StaffSessionValidation = {
  valid: false
  code: 'SESSION_EXPIRED'
} | {
  valid: true
  role: Exclude<Role, 'customer'>
  hasPermission(requirement: PermissionRequirement): boolean
}

export function validateStaffSession(
  context: StaffSessionContext,
  now = new Date(),
): StaffSessionValidation {
  const { user, session } = context
  const active = user.accountType === 'staff'
    && isStaffRole(user.role)
    && user.emailVerified
    && user.staffActivatedAt !== null
    && !user.banned
    && session.lastActivityAt !== null
    && session.absoluteExpiresAt !== null
    && now.getTime() - session.lastActivityAt.getTime() <= idleTimeoutMs
    && now.getTime() < session.absoluteExpiresAt.getTime()

  if (!active || !isStaffRole(user.role)) {
    return { valid: false, code: 'SESSION_EXPIRED' }
  }

  return {
    valid: true,
    role: user.role,
    hasPermission: (requirement) => hasPermissions(user.role, requirement),
  }
}

export function isRestrictedStaffSession(context: StaffSessionContext, now = new Date()) {
  const { user, session } = context

  return user.accountType === 'staff'
    && isStaffRole(user.role)
    && user.emailVerified
    && user.staffActivatedAt === null
    && !user.banned
    && session.lastActivityAt !== null
    && session.absoluteExpiresAt !== null
    && now.getTime() - session.lastActivityAt.getTime() <= idleTimeoutMs
    && now.getTime() < session.absoluteExpiresAt.getTime()
}

export interface StaffActivityStore {
  touchIfUnchanged(sessionId: string, previous: Date, next: Date): Promise<boolean>
}

export function touchStaffSession(
  store: StaffActivityStore,
  sessionId: string,
  lastActivityAt: Date,
  now = new Date(),
) {
  if (now.getTime() - lastActivityAt.getTime() < activityWriteIntervalMs) {
    return Promise.resolve(false)
  }

  return store.touchIfUnchanged(sessionId, lastActivityAt, now)
}
