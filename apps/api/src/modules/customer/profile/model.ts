import { t } from 'elysia'

export const customerProfileModels = {
  'customerProfile.profile': t.Object({
    id: t.String(),
    name: t.String(),
    email: t.String(),
    emailVerified: t.Boolean(),
  }, { additionalProperties: false }),
  'customerProfile.renameBody': t.Object({
    name: t.String({ minLength: 1, maxLength: 100 }),
  }, { additionalProperties: false }),
}
