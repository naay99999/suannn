import { api } from '@/lib/api'
import { AuthRequestError } from '@/lib/auth-client'
import type { StaffRole } from './staff-management-utils'

function throwApiError(result: { error: unknown; status: number }) {
  if (!result.error) return
  const errorValue = typeof result.error === 'object' && result.error !== null && 'value' in result.error
    ? result.error.value
    : result.error
  const body = typeof errorValue === 'object' && errorValue !== null ? errorValue : {}
  const code = 'code' in body && typeof body.code === 'string' ? body.code : 'STAFF_REQUEST_FAILED'
  const message = result.status >= 500
    ? 'The server could not complete this request. Try again.'
    : 'message' in body && typeof body.message === 'string'
      ? body.message
      : 'Could not complete this request.'
  throw new AuthRequestError(result.status, code, message)
}

function dataOrError<T>(result: { data: T | null; error: unknown; status: number }): T {
  throwApiError(result)
  if (result.data === null) throw new AuthRequestError(502, 'EMPTY_RESPONSE', 'Could not complete this request.')
  return result.data
}

export async function listStaff(cursor?: string) {
  return dataOrError(await api.staff.get({ query: { limit: 50, cursor } }))
}

export async function listStaffInvitations(cursor?: string, status?: 'pending' | 'accepted' | 'revoked' | 'expired') {
  return dataOrError(await api.staff.invitations.get({ query: { limit: 50, cursor, status } }))
}

export async function inviteStaff(input: { email: string; role: StaffRole }) {
  return dataOrError(await api.staff.invitations.post(input))
}

export async function changeStaffRole(id: string, role: StaffRole) {
  throwApiError(await api.staff({ id }).role.patch({ role }))
}

export async function suspendStaff(id: string, reason: string) {
  throwApiError(await api.staff({ id }).suspend.post({ reason }))
}

export async function reactivateStaff(id: string) {
  throwApiError(await api.staff({ id }).reactivate.post())
}

export async function revokeStaffSessions(id: string) {
  throwApiError(await api.staff({ id }).sessions.revoke.post())
}

export async function resetStaffMfa(id: string) {
  throwApiError(await api.staff({ id }).mfa.reset.post())
}

export async function resendStaffInvitation(id: string) {
  throwApiError(await api.staff.invitations({ id }).resend.post())
}

export async function cancelStaffInvitation(id: string) {
  throwApiError(await api.staff.invitations({ id }).cancel.post())
}
