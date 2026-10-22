import { eq, sql } from 'drizzle-orm'
import type { Database } from '../../database/types'
import { marketingSettings } from '../../database/schema'
import { DomainError } from '../../shared/domain-error'
import type { AuditContext } from '../audit/model'
import type { AuditService } from '../audit/service'

export interface MarketingSettings {
  marginPercent: number
  version: number
  updatedAt: string
}

export interface MarketingSettingsActor {
  userId: string
  auditContext: AuditContext
}

function invalid(): never {
  throw new DomainError('INVALID_MARKETING_SETTINGS')
}

function toSettings(row: typeof marketingSettings.$inferSelect): MarketingSettings {
  return { marginPercent: Number(row.marginPercent), version: row.version, updatedAt: row.updatedAt.toISOString() }
}

export class MarketingSettingsService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<MarketingSettings> {
    const [row] = await this.db.select().from(marketingSettings).where(eq(marketingSettings.id, 1)).limit(1)
    if (!row) invalid()
    return toSettings(row)
  }

  async update(input: { marginPercent: number, version: number }, actor: MarketingSettingsActor): Promise<MarketingSettings> {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length !== 2
      || typeof input.marginPercent !== 'number' || !Number.isFinite(input.marginPercent)
      || Math.round(input.marginPercent * 10) !== input.marginPercent * 10
      || input.marginPercent < 1 || input.marginPercent > 100
      || !Number.isInteger(input.version) || input.version < 1) {
      invalid()
    }
    const marginPercent = input.marginPercent.toFixed(1)

    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(marketingSettings)
        .where(eq(marketingSettings.id, 1)).for('update').limit(1)
      if (!current) invalid()
      if (current.version !== input.version) throw new DomainError('MARKETING_SETTINGS_CONFLICT')
      if (current.marginPercent === marginPercent) return toSettings(current)

      const [updated] = await tx.update(marketingSettings).set({
        marginPercent,
        version: sql`${marketingSettings.version} + 1`,
        updatedAt: sql`transaction_timestamp()`,
        updatedBy: actor.userId,
      }).where(eq(marketingSettings.id, 1)).returning()
      if (!updated) invalid()

      await this.audit.record(tx, {
        id: crypto.randomUUID(),
        actorUserId: actor.userId,
        action: 'marketing.settings.updated',
        targetType: 'marketing_settings',
        targetId: '1',
        ...actor.auditContext,
        metadata: { from: Number(current.marginPercent), to: Number(updated.marginPercent) },
      })
      return toSettings(updated)
    })
  }
}
