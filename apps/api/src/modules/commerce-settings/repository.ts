import { eq, sql } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../database/types'
import { commerceSettings } from '../../database/schema'
import { DomainError } from '../../shared/domain-error'
import type { AuditContext } from '../audit/model'
import type { AuditService } from '../audit/service'

export interface CommerceSettingsActor {
  userId: string
  auditContext: AuditContext
}

export interface UpdateCommerceSettingsInput {
  shippingFeeSatang: number | null
  checkoutEnabled: boolean
}

export class CommerceSettingsRepository {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async get() {
    const [settings] = await this.db.select().from(commerceSettings)
      .where(eq(commerceSettings.id, 1)).limit(1)
    if (!settings) throw new DomainError('COMMERCE_SETTINGS_UNAVAILABLE')
    return settings
  }

  async update(input: UpdateCommerceSettingsInput, actor: CommerceSettingsActor) {
    return this.db.transaction(async (tx) => {
      const current = await this.lockSettings(tx)
      const fields = (['shippingFeeSatang', 'checkoutEnabled'] as const)
        .filter((field) => current[field] !== input[field])
      if (fields.length === 0) return current

      const [updated] = await tx.update(commerceSettings).set({
        shippingFeeSatang: input.shippingFeeSatang,
        checkoutEnabled: input.checkoutEnabled,
        version: sql`${commerceSettings.version} + 1`,
        updatedAt: sql`transaction_timestamp()`,
      }).where(eq(commerceSettings.id, 1)).returning()
      if (!updated) throw new DomainError('COMMERCE_SETTINGS_UNAVAILABLE')

      await this.audit.record(tx, {
        id: crypto.randomUUID(),
        actorUserId: actor.userId,
        action: 'settings.commerce-updated',
        targetType: 'commerce_settings',
        targetId: '1',
        ...actor.auditContext,
        metadata: { fields },
      })
      return updated
    })
  }

  private async lockSettings(tx: DatabaseTransaction) {
    const [settings] = await tx.select().from(commerceSettings)
      .where(eq(commerceSettings.id, 1)).for('update').limit(1)
    if (!settings) throw new DomainError('COMMERCE_SETTINGS_UNAVAILABLE')
    return settings
  }
}
