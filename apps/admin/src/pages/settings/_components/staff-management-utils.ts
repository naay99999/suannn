export type StaffRole = 'owner' | 'admin' | 'catalog_manager' | 'fulfillment' | 'support'

export type StaffActions = {
  canChangeRole: boolean
  canSuspend: boolean
  canReactivate: boolean
  canRevokeSessions: boolean
  canResetMfa: boolean
  mayManageTarget: boolean
}

export function getStaffActions(input: {
  actorId: string
  actorRole: StaffRole
  actorPermissions: string[]
  target: { id: string; role: StaffRole; banned: boolean }
}): StaffActions {
  const has = (permission: string) => input.actorPermissions.includes(permission)
  const isSelf = input.actorId === input.target.id
  const mayManageTarget = input.target.role !== 'owner' || input.actorRole === 'owner'

  return {
    canChangeRole: has('staff:change-role') && !isSelf && mayManageTarget,
    canSuspend: has('staff:suspend') && !isSelf && !input.target.banned && mayManageTarget,
    canReactivate: has('staff:suspend') && input.target.banned && mayManageTarget,
    canRevokeSessions: has('staff:revoke-session') && !isSelf && mayManageTarget,
    canResetMfa: has('staff:reset-mfa') && !isSelf && mayManageTarget,
    mayManageTarget,
  }
}

export function getInvitationStatus(
  invitation: { acceptedAt: string | null; revokedAt: string | null; expiresAt: string },
  now = new Date(),
): 'pending' | 'accepted' | 'revoked' | 'expired' {
  if (invitation.acceptedAt) return 'accepted'
  if (invitation.revokedAt) return 'revoked'
  if (new Date(invitation.expiresAt) <= now) return 'expired'
  return 'pending'
}
