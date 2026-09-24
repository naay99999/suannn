import { t } from 'elysia'
import { staffRoleSchema } from '../../../plugins/auth/model'

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
  'staff.listQuery': t.Object({
    limit: t.Optional(t.Number({ minimum: 1, maximum: 100, default: 50, description: 'Page size. Defaults to 50; maximum 100.' })),
    cursor: t.Optional(t.String({ maxLength: 512, description: 'Opaque nextCursor from the previous page.' })),
  }),
  'staff.memberList': t.Object({
    items: t.Array(staffMember), nextCursor: t.Nullable(t.String({ description: 'Pass this as cursor to load the next page; null at the end.' })),
  }),
  'staff.sessionList': t.Object({
    items: t.Array(staffSession), nextCursor: t.Nullable(t.String({ description: 'Pass this as cursor to load the next page; null at the end.' })),
  }),
}
