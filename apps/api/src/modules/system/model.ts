import { t } from 'elysia'

export const systemModels = {
  'system.rootResponse': t.Object({ message: t.String() }),
  'system.healthResponse': t.Object({ status: t.Literal('ok') }),
}
