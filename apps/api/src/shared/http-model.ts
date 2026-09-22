import { t } from 'elysia'

export const httpModels = {
  'http.error': t.Object({ code: t.String(), message: t.String() }),
  'http.idParams': t.Object({ id: t.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false }),
  'http.empty': t.Void(),
}
