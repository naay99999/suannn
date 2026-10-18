import { eq, sql } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../database/types'
import { storeAnnouncement } from '../../database/schema'
import { DomainError } from '../../shared/domain-error'
import type { AuditContext } from '../audit/model'
import type { AuditService } from '../audit/service'

export interface StoreAnnouncementActor {
  userId: string
  auditContext: AuditContext
}

export interface StoreAnnouncementValues {
  enabled: boolean
  message: string | null
  linkLabel: string | null
  linkUrl: string | null
  details: string | null
  startsAt: Date | null
  endsAt: Date | null
}

const fieldNames = ['enabled', 'message', 'linkLabel', 'linkUrl', 'details', 'startsAt', 'endsAt'] as const

function sameValue(left: unknown, right: unknown) {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime()
  return left === right
}

export class StoreAnnouncementRepository {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async get() {
    const [announcement] = await this.db.select().from(storeAnnouncement)
      .where(eq(storeAnnouncement.id, 1)).limit(1)
    if (!announcement) throw new DomainError('STORE_ANNOUNCEMENT_UNAVAILABLE')
    return announcement
  }

  async update(values: StoreAnnouncementValues, actor: StoreAnnouncementActor) {
    return this.db.transaction(async (tx) => {
      const current = await this.lockAnnouncement(tx)
      const fields = fieldNames.filter((field) => !sameValue(current[field], values[field]))
      if (fields.length === 0) return current

      const [updated] = await tx.update(storeAnnouncement).set({
        ...values,
        version: sql`${storeAnnouncement.version} + 1`,
        updatedAt: sql`transaction_timestamp()`,
      }).where(eq(storeAnnouncement.id, 1)).returning()
      if (!updated) throw new DomainError('STORE_ANNOUNCEMENT_UNAVAILABLE')

      await this.audit.record(tx, {
        id: crypto.randomUUID(),
        actorUserId: actor.userId,
        action: 'settings.store-announcement-updated',
        targetType: 'store_announcement',
        targetId: '1',
        ...actor.auditContext,
        metadata: { fields },
      })
      return updated
    })
  }

  private async lockAnnouncement(tx: DatabaseTransaction) {
    const [announcement] = await tx.select().from(storeAnnouncement)
      .where(eq(storeAnnouncement.id, 1)).for('update').limit(1)
    if (!announcement) throw new DomainError('STORE_ANNOUNCEMENT_UNAVAILABLE')
    return announcement
  }
}
