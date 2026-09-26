import { expect, test } from 'bun:test'
import { getInvitationStatus, getStaffActions } from '../src/pages/settings/_components/staff-management-utils'

test('limits staff actions to permissions and owner protections', () => {
  expect(getStaffActions({
    actorId: 'admin-1', actorRole: 'admin', actorPermissions: ['staff:read', 'staff:invite', 'staff:change-role', 'staff:suspend', 'staff:revoke-session', 'staff:reset-mfa'],
    target: { id: 'owner-1', role: 'owner', banned: false },
  })).toEqual({ canChangeRole: false, canSuspend: false, canReactivate: false, canRevokeSessions: false, canResetMfa: false, mayManageTarget: false })

  expect(getStaffActions({
    actorId: 'owner-1', actorRole: 'owner', actorPermissions: ['staff:read', 'staff:invite', 'staff:change-role', 'staff:suspend', 'staff:revoke-session', 'staff:reset-mfa'],
    target: { id: 'owner-1', role: 'owner', banned: false },
  })).toEqual({ canChangeRole: false, canSuspend: false, canReactivate: false, canRevokeSessions: false, canResetMfa: false, mayManageTarget: true })

  expect(getStaffActions({
    actorId: 'owner-1', actorRole: 'owner', actorPermissions: ['staff:change-role', 'staff:suspend', 'staff:revoke-session', 'staff:reset-mfa'],
    target: { id: 'staff-2', role: 'support', banned: true },
  })).toEqual({ canChangeRole: true, canSuspend: false, canReactivate: true, canRevokeSessions: true, canResetMfa: true, mayManageTarget: true })
})

test('derives invitation status from accepted, revoked, and expiration fields', () => {
  const now = new Date('2026-09-26T00:00:00Z')
  expect(getInvitationStatus({ acceptedAt: null, revokedAt: null, expiresAt: '2026-09-27T00:00:00Z' }, now)).toBe('pending')
  expect(getInvitationStatus({ acceptedAt: '2026-09-25T00:00:00Z', revokedAt: null, expiresAt: '2026-09-27T00:00:00Z' }, now)).toBe('accepted')
  expect(getInvitationStatus({ acceptedAt: null, revokedAt: '2026-09-25T00:00:00Z', expiresAt: '2026-09-27T00:00:00Z' }, now)).toBe('revoked')
  expect(getInvitationStatus({ acceptedAt: null, revokedAt: null, expiresAt: '2026-09-25T00:00:00Z' }, now)).toBe('expired')
})
