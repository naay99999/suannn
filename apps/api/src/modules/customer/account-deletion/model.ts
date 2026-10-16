import { t } from 'elysia'

export const customerAccountDeletionModels = {
  'customerAccountDeletion.body': t.Object({
    currentPassword: t.String({ minLength: 1, maxLength: 256 }),
  }, { additionalProperties: false }),
  'customerAccountDeletion.deleted': t.Object({ deleted: t.Literal(true) }, { additionalProperties: false }),
}
