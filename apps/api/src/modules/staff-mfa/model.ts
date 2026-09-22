import { t } from 'elysia'

export const staffMfaModels = {
  'staffMfa.passwordBody': t.Object({
    password: t.String({ minLength: 12, maxLength: 256 }),
  }, { additionalProperties: false }),
  'staffMfa.verifyBody': t.Object({
    code: t.String({ minLength: 6, maxLength: 8 }),
  }, { additionalProperties: false }),
}
