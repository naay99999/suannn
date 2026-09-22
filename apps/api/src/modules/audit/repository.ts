import { desc, eq } from 'drizzle-orm'
import type { createDatabase } from '../../database/client'
import { auditLog } from '../../database/schema'
import type { AuditEvent } from './model'

type Database = ReturnType<typeof createDatabase>['db']
type AuditWriter = Pick<Database, 'insert'>

export class AuditRepository {
  constructor(private readonly db: Database) {}

  insert(writer: AuditWriter, event: AuditEvent) {
    return writer.insert(auditLog).values({
      id: event.id,
      occurredAt: event.occurredAt,
      actorUserId: event.actorUserId,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      requestId: event.requestId,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      metadata: event.metadata,
    })
  }

  list(query: { limit: number; actorUserId?: string }) {
    const base = this.db.select().from(auditLog)
    const filtered = query.actorUserId
      ? base.where(eq(auditLog.actorUserId, query.actorUserId))
      : base

    return filtered.orderBy(desc(auditLog.occurredAt)).limit(query.limit)
  }
}
