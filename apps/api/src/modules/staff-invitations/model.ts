import type { StaffRole } from '../../plugins/auth/access-control'
import { t } from 'elysia'

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
    role: t.Union([
      t.Literal('owner'),
      t.Literal('admin'),
      t.Literal('catalog_manager'),
      t.Literal('fulfillment'),
      t.Literal('support'),
    ]),
  }, { additionalProperties: false }),
  'staffInvitation.acceptBody': t.Object({
    token: t.String({ minLength: 16, maxLength: 512 }),
    name: t.String({ minLength: 1, maxLength: 100 }),
    password: t.String({ minLength: 12, maxLength: 256 }),
  }, { additionalProperties: false }),
}
