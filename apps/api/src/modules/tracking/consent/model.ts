import { t } from 'elysia'

export const consentModels = {
  'consent.policy': t.Object({ version: t.String() }, { additionalProperties: false }),
  'consent.recordBody': t.Object({
    visitorId: t.String({ format: 'uuid' }),
    analytics: t.Boolean(),
    marketing: t.Boolean(),
    policyVersion: t.String({ minLength: 1, maxLength: 32 }),
  }),
  'consent.recorded': t.Object({ consentId: t.String({ format: 'uuid' }) }, { additionalProperties: false }),
}
