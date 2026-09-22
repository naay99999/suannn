import { t } from 'elysia'
import { staffRoleSchema } from '../../plugins/auth/model'

const staffMember = t.Object({
  id: t.String(), name: t.String(), email: t.String(), role: staffRoleSchema,
  banned: t.Boolean(), staffActivatedAt: t.Nullable(t.Date()),
})
const staffSession = t.Object({
  id: t.String(), createdAt: t.Date(), updatedAt: t.Date(), expiresAt: t.Date(),
  ipAddress: t.Nullable(t.String()), userAgent: t.Nullable(t.String()),
})

export const staffModels = {
  'staff.roleBody': t.Object({
    role: staffRoleSchema,
  }, { additionalProperties: false }),
  'staff.suspendBody': t.Object({
    reason: t.String({ minLength: 1, maxLength: 500 }),
  }, { additionalProperties: false }),
  'staff.member': staffMember,
  'staff.session': staffSession,
  'staff.memberList': t.Array(staffMember),
  'staff.sessionList': t.Array(staffSession),
}
