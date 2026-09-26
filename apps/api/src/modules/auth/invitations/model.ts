import type { StaffRole } from '../../../plugins/auth/access-control'
import { t } from 'elysia'
import { staffRoleSchema } from '../../../plugins/auth/model'
import type { AuditContext } from '../../audit/model'

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
  auditContext?: AuditContext
}

export interface AcceptStaffInvitationCommand {
  token: string
  name: string
  password: string
  auditContext?: AuditContext
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
  'staffInvitation.listQuery': t.Object({
    limit: t.Optional(t.Number({ minimum: 1, maximum: 100, default: 50, description: 'Page size. Defaults to 50; maximum 100.' })),
    cursor: t.Optional(t.String({ maxLength: 512, description: 'Opaque nextCursor from the previous page. Keep the same status filter.' })),
    status: t.Optional(t.Union([t.Literal('pending'), t.Literal('accepted'), t.Literal('revoked'), t.Literal('expired')], { description: 'Filter invitations by current status.' })),
  }),
  'staffInvitation.listResponse': t.Object({
    items: t.Array(invitationListItem),
    nextCursor: t.Nullable(t.String({ description: 'Pass this as cursor to load the next page; null at the end.' })),
  }),
  'staffInvitation.acceptResponse': t.Object({
    accepted: t.Literal(true),
    next: t.Union([t.Literal('mfa-enrollment'), t.Literal('dashboard')]),
  }),
}
