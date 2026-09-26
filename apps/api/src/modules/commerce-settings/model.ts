import { t } from 'elysia'

export const commerceSettingsModels = {
  'commerceSettings.response': t.Object({
    id: t.Integer({ minimum: 1, maximum: 1 }),
    shippingFeeSatang: t.Union([t.Integer({ minimum: 0, maximum: 2_147_483_647 }), t.Null()]),
    checkoutEnabled: t.Boolean(),
    version: t.Integer({ minimum: 1 }),
    updatedAt: t.Date(),
  }, { additionalProperties: false }),
  'commerceSettings.updateBody': t.Object({
    shippingFeeSatang: t.Union([t.Integer({ minimum: 0, maximum: 2_147_483_647 }), t.Null()]),
    checkoutEnabled: t.Boolean(),
  }, { additionalProperties: false }),
}
