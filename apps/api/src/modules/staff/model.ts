import { t } from 'elysia'

export const staffModels = {
  'staff.roleBody': t.Object({
    role: t.String({ minLength: 1, maxLength: 32 }),
  }, { additionalProperties: false }),
  'staff.suspendBody': t.Object({
    reason: t.String({ minLength: 1, maxLength: 500 }),
  }, { additionalProperties: false }),
}
