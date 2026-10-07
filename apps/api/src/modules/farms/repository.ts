import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import type { Database } from '../../database/types'
import { farm } from '../../database/schema'
import type { AuditService } from '../audit/service'
import type { AuditEvent } from '../audit/model'
import { DomainError } from '../../shared/domain-error'
import { decodeCursor, encodeCursor } from '../../shared/cursor'
import { assertFarmCanTransition, assertFarmPublishable } from './policy'
import { adminFarmProjection, farmDetailProjection, farmSummaryProjection } from './projections'
import type { AdminFarm, AdminFarmQuery, CreateFarmInput, FarmActor, FarmListQuery, FarmSummary, UpdateFarmInput } from './types'

function pageSize(query: { limit?: number }) {
  const limit = query.limit ?? 12
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('INVALID_FARM_QUERY')
  return limit
}

function cursorDate(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('INVALID_CURSOR')
  return date
}

function queryFingerprint(value: object) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function mapUniqueViolation(error: unknown): unknown {
  let current = error
  while (current && typeof current === 'object') {
    const record = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown; cause?: unknown }
    if (record.code === '23505' && String(record.constraint ?? record.constraint_name ?? '').includes('farm_slug_unique')) {
      return new DomainError('FARM_SLUG_CONFLICT')
    }
    current = record.cause
  }
  return error
}

function event(action: AuditEvent['action'], targetId: string, actor: FarmActor, metadata: Record<string, unknown>): AuditEvent {
  return {
    id: randomUUID(), action, targetType: 'farm', targetId, actorUserId: actor.userId,
    requestId: actor.auditContext.requestId, ipAddress: actor.auditContext.ipAddress,
    userAgent: actor.auditContext.userAgent, metadata,
  }
}

export class FarmRepository {
  constructor(private readonly db: Database, private readonly audit: AuditService) {}

  async listStore(query: FarmListQuery): Promise<{ items: FarmSummary[]; nextCursor: string | null }> {
    const limit = pageSize(query)
    const scope = queryFingerprint({ type: 'store-farms' })
    const cursor = decodeCursor(query.cursor, ['createdAt', 'id', 'fingerprint'])
    if (cursor && (cursor.fingerprint !== scope || !/^[0-9a-f-]{36}$/i.test(cursor.id))) throw new Error('INVALID_CURSOR')
    const rows = await this.db.select({ ...farmSummaryProjection, createdAt: farm.createdAt }).from(farm).where(and(
      eq(farm.status, 'published'),
      cursor ? or(lt(farm.createdAt, cursorDate(cursor.createdAt)), and(
        eq(farm.createdAt, cursorDate(cursor.createdAt)), lt(farm.id, cursor.id),
      )) : undefined,
    )).orderBy(desc(farm.createdAt), desc(farm.id)).limit(limit + 1)
    const pageRows = rows.slice(0, limit)
    const last = pageRows.at(-1)
    const items: FarmSummary[] = pageRows.map(({ createdAt: _createdAt, ...item }) => item)
    return { items, nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id, fingerprint: scope }) : null }
  }

  async getStoreBySlug(slug: string) {
    const [row] = await this.db.select(farmDetailProjection).from(farm).where(and(eq(farm.slug, slug), eq(farm.status, 'published'))).limit(1)
    if (!row) throw new DomainError('FARM_NOT_FOUND')
    return row
  }

  async listAdmin(query: AdminFarmQuery): Promise<{ items: AdminFarm[]; nextCursor: string | null }> {
    const limit = pageSize(query)
    const status = query.status
    if (status && !['draft', 'published', 'archived'].includes(status)) throw new Error('INVALID_FARM_QUERY')
    const scope = queryFingerprint({ type: 'admin-farms', status: status ?? null })
    const cursor = decodeCursor(query.cursor, ['createdAt', 'id', 'fingerprint'])
    if (cursor && (cursor.fingerprint !== scope || !/^[0-9a-f-]{36}$/i.test(cursor.id))) throw new Error('INVALID_CURSOR')
    const rows = await this.db.select(adminFarmProjection).from(farm).where(and(
      status ? eq(farm.status, status) : undefined,
      cursor ? or(lt(farm.createdAt, cursorDate(cursor.createdAt)), and(eq(farm.createdAt, cursorDate(cursor.createdAt)), lt(farm.id, cursor.id))) : undefined,
    )).orderBy(desc(farm.createdAt), desc(farm.id)).limit(limit + 1)
    const items = rows.slice(0, limit)
    const last = items.at(-1)
    return { items, nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id, fingerprint: scope }) : null }
  }

  async getAdminById(id: string): Promise<AdminFarm> {
    const [row] = await this.db.select(adminFarmProjection).from(farm).where(eq(farm.id, id)).limit(1)
    if (!row) throw new DomainError('FARM_NOT_FOUND')
    return row as AdminFarm
  }

  async createFarm(input: CreateFarmInput, actor: FarmActor): Promise<AdminFarm> {
    try {
      return await this.db.transaction(async tx => {
        const [row] = await tx.insert(farm).values(input).returning(adminFarmProjection)
        if (!row) throw new DomainError('FARM_NOT_FOUND')
        await this.audit.record(tx, event('farm.created', row.id, actor, { fields: Object.keys(input).sort() }))
        return row as AdminFarm
      })
    } catch (error) { throw mapUniqueViolation(error) }
  }

  async updateFarm(id: string, input: UpdateFarmInput, actor: FarmActor): Promise<AdminFarm> {
    try {
      return await this.db.transaction(async tx => {
        const [current] = await tx.select(adminFarmProjection).from(farm).where(eq(farm.id, id)).for('update').limit(1)
        if (!current) throw new DomainError('FARM_NOT_FOUND')
        if (current.status === 'archived') throw new DomainError('FARM_STATE_CONFLICT')
        const merged = { ...current, ...input } as AdminFarm
        if (current.status === 'published') assertFarmPublishable(merged)
        const [row] = await tx.update(farm).set({ ...input, updatedAt: new Date() }).where(eq(farm.id, id)).returning(adminFarmProjection)
        if (!row) throw new DomainError('FARM_NOT_FOUND')
        await this.audit.record(tx, event('farm.updated', id, actor, { fields: Object.keys(input).sort() }))
        return row as AdminFarm
      })
    } catch (error) { throw mapUniqueViolation(error) }
  }

  async transition(id: string, to: 'published' | 'draft' | 'archived', actor: FarmActor): Promise<AdminFarm> {
    return this.db.transaction(async tx => {
      const [current] = await tx.select(adminFarmProjection).from(farm).where(eq(farm.id, id)).for('update').limit(1)
      if (!current) throw new DomainError('FARM_NOT_FOUND')
      if (current.status === to) return current as AdminFarm
      assertFarmCanTransition(current.status, to)
      if (to === 'published') assertFarmPublishable(current as AdminFarm)
      const now = new Date()
      const [row] = await tx.update(farm).set({ status: to, updatedAt: now,
        ...(to === 'published' ? { publishedAt: now, archivedAt: null } : {}),
        ...(to === 'draft' ? { publishedAt: null } : {}),
        ...(to === 'archived' ? { archivedAt: now } : {}),
      }).where(eq(farm.id, id)).returning(adminFarmProjection)
      if (!row) throw new DomainError('FARM_NOT_FOUND')
      const action = to === 'published' ? 'farm.published' : to === 'draft' ? 'farm.unpublished' : 'farm.archived'
      await this.audit.record(tx, event(action, id, actor, {}))
      return row as AdminFarm
    })
  }

  publishFarm(id: string, actor: FarmActor) { return this.transition(id, 'published', actor) }
  unpublishFarm(id: string, actor: FarmActor) { return this.transition(id, 'draft', actor) }
  archiveFarm(id: string, actor: FarmActor) { return this.transition(id, 'archived', actor) }
}
