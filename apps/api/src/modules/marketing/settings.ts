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

export function assertMarketingSettingsInput(input: unknown): asserts input is { marginPercent: number, version: number } {
  const value = input as { marginPercent?: unknown, version?: unknown } | null
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 2
    || typeof value.marginPercent !== 'number' || !Number.isFinite(value.marginPercent)
    || Math.round(value.marginPercent * 10) !== value.marginPercent * 10
    || value.marginPercent < 1 || value.marginPercent > 100
    || typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1) {
    invalid()
  }
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
    assertMarketingSettingsInput(input)
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
