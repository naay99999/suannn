import { t } from 'elysia'

export const systemModels = {
  'system.rootResponse': t.Object({ message: t.String() }),
  'system.healthResponse': t.Object({ status: t.Literal('ok') }),
  'system.readyResponse': t.Object({ status: t.Literal('ready') }),
  'system.notReadyResponse': t.Object({ code: t.Literal('NOT_READY'), message: t.String() }),
}
