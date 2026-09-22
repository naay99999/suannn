import { t } from 'elysia'

export const staffRoleSchema = t.Union([
  t.Literal('owner'), t.Literal('admin'), t.Literal('catalog_manager'),
  t.Literal('fulfillment'), t.Literal('support'),
])

export type StaffRole = typeof staffRoleSchema.static
