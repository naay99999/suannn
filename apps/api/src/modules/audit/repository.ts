import { and, desc, eq, lt, or } from 'drizzle-orm'
import type { Database } from '../../database/types'
import { auditLog } from '../../database/schema'
import type { AuditEvent } from './model'
import { decodeCursor, encodeCursor } from '../../shared/cursor'

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

  insertStandalone(event: AuditEvent) {
    return this.insert(this.db, event)
  }

  async list(query: { limit: number; cursor?: string; actorUserId?: string }) {
    const keys = query.actorUserId ? ['occurredAt', 'id', 'actorUserId'] : ['occurredAt', 'id']
    const cursor = decodeCursor(query.cursor, keys)
    if (query.actorUserId && cursor && cursor.actorUserId !== query.actorUserId) throw new Error('INVALID_CURSOR')
    const rows = await this.db.select().from(auditLog).where(and(
      query.actorUserId ? eq(auditLog.actorUserId, query.actorUserId) : undefined,
      cursor ? or(lt(auditLog.occurredAt, new Date(cursor.occurredAt)), and(
        eq(auditLog.occurredAt, new Date(cursor.occurredAt)), lt(auditLog.id, cursor.id),
      )) : undefined,
    )).orderBy(desc(auditLog.occurredAt), desc(auditLog.id)).limit(query.limit + 1)
    const hasMore = rows.length > query.limit
    const items = rows.slice(0, query.limit)
    const last = items.at(-1)
    return { items, nextCursor: hasMore && last ? encodeCursor({
      occurredAt: last.occurredAt.toISOString(),
      id: last.id,
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    }) : null }
  }
}
