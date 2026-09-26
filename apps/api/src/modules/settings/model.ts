import { t } from 'elysia'

export const systemSettingsModels = {
  'systemSettings.securityResponse': t.Object({ staffMfaRequired: t.Boolean() }),
  'systemSettings.securityBody': t.Object({
    staffMfaRequired: t.Boolean(),
  }, { additionalProperties: false }),
}
