import type { StaffRole } from '../../../plugins/auth/access-control'
import { t } from 'elysia'
import { staffRoleSchema } from '../../../plugins/auth/model'

const invitation = t.Object({ id: t.String(), email: t.String(), role: staffRoleSchema, expiresAt: t.Date() })
const invitationListItem = t.Object({
  id: t.String(), email: t.String(), role: staffRoleSchema, expiresAt: t.Date(),
  acceptedAt: t.Nullable(t.Date()), revokedAt: t.Nullable(t.Date()),
})

export interface CreateStaffInvitationCommand {
  email: string
  role: StaffRole
  inviterUserId: string | null
  inviterRole?: StaffRole
}

export interface AcceptStaffInvitationCommand {
  token: string
  name: string
  password: string
}

export interface PublicStaffInvitation {
  id: string
  email: string
  role: StaffRole
  expiresAt: Date
}

export const staffInvitationModels = {
  'staffInvitation.createBody': t.Object({
    email: t.String({ minLength: 3, maxLength: 322 }),
    role: staffRoleSchema,
  }, { additionalProperties: false }),
  'staffInvitation.acceptBody': t.Object({
    token: t.String({ minLength: 16, maxLength: 512 }),
    name: t.String({ minLength: 1, maxLength: 100 }),
    password: t.String({ minLength: 12, maxLength: 256 }),
  }, { additionalProperties: false }),
  'staffInvitation.createResponse': invitation,
  'staffInvitation.listResponse': t.Array(invitationListItem),
  'staffInvitation.acceptResponse': t.Object({ accepted: t.Literal(true), next: t.Literal('mfa-enrollment') }),
}
