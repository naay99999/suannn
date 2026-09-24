import { t } from 'elysia'

export const customerEmailChangeModels = {
  'customerEmailChange.requestBody': t.Object({
    newEmail: t.String({ format: 'email', maxLength: 320 }),
    currentPassword: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),
  'customerEmailChange.accepted': t.Object({ accepted: t.Literal(true) }, { additionalProperties: false }),
}
