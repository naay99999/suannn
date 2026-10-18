import { t } from 'elysia'

export const systemSettingsModels = {
  'systemSettings.securityResponse': t.Object({ staffMfaRequired: t.Boolean() }),
  'systemSettings.securityBody': t.Object({
    staffMfaRequired: t.Boolean(),
  }, { additionalProperties: false }),
  'systemSettings.customerAuthResponse': t.Object({ emailVerificationRequired: t.Boolean() }),
  'systemSettings.customerAuthBody': t.Object({
    emailVerificationRequired: t.Boolean(),
  }, { additionalProperties: false }),
}
