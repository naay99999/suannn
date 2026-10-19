import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../database/types'
import { farm } from '../../database/schema'
import type { AuditService } from '../audit/service'
import type { AuditEvent } from '../audit/model'
import { DomainError } from '../../shared/domain-error'
import { decodeCursor, encodeCursor } from '../../shared/cursor'
import { findMediaRows } from '../media/repository'
import type { MediaUrls } from '../media/urls'
import { assertFarmCanTransition, assertFarmPublishable } from './policy'
import {
  adminFarmProjection, coverMedia, farmDetailProjection, farmSummaryProjection, portraitMedia,
  toAdminFarm, toFarmDetail, toFarmSummary,
} from './projections'
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

// A concurrent media delete can commit between validation and write; report it as invalid input.
export function mapFarmMediaError(error: unknown): unknown {
  let current = error
  while (current && typeof current === 'object') {
    const record = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown; cause?: unknown; message?: unknown }
    const constraint = String(record.constraint ?? record.constraint_name ?? record.message ?? '')
    if (record.code === '23503' && (constraint.includes('farm_cover_media_id_') || constraint.includes('farm_portrait_media_id_'))) {
      return new DomainError('INVALID_FARM')
    }
    current = record.cause
  }
  return error
}

function mapFarmWriteError(error: unknown): unknown {
  return mapFarmMediaError(mapUniqueViolation(error))
}

function event(action: AuditEvent['action'], targetId: string, actor: FarmActor, metadata: Record<string, unknown>): AuditEvent {
  return {
    id: randomUUID(), action, targetType: 'farm', targetId, actorUserId: actor.userId,
    requestId: actor.auditContext.requestId, ipAddress: actor.auditContext.ipAddress,
    userAgent: actor.auditContext.userAgent, metadata,
  }
}

export class FarmRepository {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly urls: MediaUrls,
  ) {}

  private selectAdmin(db: Database | DatabaseTransaction, where: SQL) {
    return db.select(adminFarmProjection).from(farm)
      .leftJoin(coverMedia, eq(coverMedia.id, farm.coverMediaId))
      .leftJoin(portraitMedia, eq(portraitMedia.id, farm.portraitMediaId))
      .where(where)
  }

  private async readAdmin(db: Database | DatabaseTransaction, id: string): Promise<AdminFarm> {
    const [row] = await this.selectAdmin(db, eq(farm.id, id)).limit(1)
    if (!row) throw new DomainError('FARM_NOT_FOUND')
    return toAdminFarm(row, this.urls)
  }

  // Rejects unknown media IDs; returns each requested ID's alt text.
  private async checkMedia(tx: DatabaseTransaction, input: CreateFarmInput | UpdateFarmInput) {
    const ids = [...new Set([input.coverMediaId, input.portraitMediaId].filter((id): id is string => !!id))]
    const found = await findMediaRows(tx, ids)
    if (found.size !== ids.length) throw new DomainError('INVALID_FARM')
    return found
  }

  async listStore(query: FarmListQuery): Promise<{ items: FarmSummary[]; nextCursor: string | null }> {
    const limit = pageSize(query)
    const scope = queryFingerprint({ type: 'store-farms' })
    const cursor = decodeCursor(query.cursor, ['createdAt', 'id', 'fingerprint'])
    if (cursor && (cursor.fingerprint !== scope || !/^[0-9a-f-]{36}$/i.test(cursor.id))) throw new Error('INVALID_CURSOR')
    const rows = await this.db.select({ ...farmSummaryProjection, createdAt: farm.createdAt }).from(farm)
      .leftJoin(coverMedia, eq(coverMedia.id, farm.coverMediaId)).where(and(
      eq(farm.status, 'published'),
      cursor ? or(lt(farm.createdAt, cursorDate(cursor.createdAt)), and(
        eq(farm.createdAt, cursorDate(cursor.createdAt)), lt(farm.id, cursor.id),
      )) : undefined,
    )).orderBy(desc(farm.createdAt), desc(farm.id)).limit(limit + 1)
    const pageRows = rows.slice(0, limit)
    const last = pageRows.at(-1)
    const items: FarmSummary[] = pageRows.map(({ createdAt: _createdAt, ...item }) => toFarmSummary(item, this.urls))
    return { items, nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id, fingerprint: scope }) : null }
  }

  async getStoreBySlug(slug: string) {
    const [row] = await this.db.select(farmDetailProjection).from(farm)
      .leftJoin(coverMedia, eq(coverMedia.id, farm.coverMediaId))
      .leftJoin(portraitMedia, eq(portraitMedia.id, farm.portraitMediaId))
      .where(and(eq(farm.slug, slug), eq(farm.status, 'published'))).limit(1)
    if (!row) throw new DomainError('FARM_NOT_FOUND')
    return toFarmDetail(row, this.urls)
  }

  async listAdmin(query: AdminFarmQuery): Promise<{ items: AdminFarm[]; nextCursor: string | null }> {
    const limit = pageSize(query)
    const status = query.status
    if (status && !['draft', 'published', 'archived'].includes(status)) throw new Error('INVALID_FARM_QUERY')
    const scope = queryFingerprint({ type: 'admin-farms', status: status ?? null })
    const cursor = decodeCursor(query.cursor, ['createdAt', 'id', 'fingerprint'])
    if (cursor && (cursor.fingerprint !== scope || !/^[0-9a-f-]{36}$/i.test(cursor.id))) throw new Error('INVALID_CURSOR')
    const rows = await this.selectAdmin(this.db, and(
      status ? eq(farm.status, status) : undefined,
      cursor ? or(lt(farm.createdAt, cursorDate(cursor.createdAt)), and(eq(farm.createdAt, cursorDate(cursor.createdAt)), lt(farm.id, cursor.id))) : undefined,
    )!).orderBy(desc(farm.createdAt), desc(farm.id)).limit(limit + 1)
    const items = rows.slice(0, limit).map(row => toAdminFarm(row, this.urls))
    const last = items.at(-1)
    return { items, nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id, fingerprint: scope }) : null }
  }

  async getAdminById(id: string): Promise<AdminFarm> {
    return this.readAdmin(this.db, id)
  }

  async createFarm(input: CreateFarmInput, actor: FarmActor): Promise<AdminFarm> {
    try {
      return await this.db.transaction(async tx => {
        await this.checkMedia(tx, input)
        const [created] = await tx.insert(farm).values(input).returning({ id: farm.id })
        if (!created) throw new DomainError('FARM_NOT_FOUND')
        await this.audit.record(tx, event('farm.created', created.id, actor, { fields: Object.keys(input).sort() }))
        return this.readAdmin(tx, created.id)
      })
    } catch (error) { throw mapFarmWriteError(error) }
  }

  async updateFarm(id: string, input: UpdateFarmInput, actor: FarmActor): Promise<AdminFarm> {
    try {
      return await this.db.transaction(async tx => {
        const [current] = await this.selectAdmin(tx, eq(farm.id, id)).for('update', { of: farm }).limit(1)
        if (!current) throw new DomainError('FARM_NOT_FOUND')
        if (current.status === 'archived') throw new DomainError('FARM_STATE_CONFLICT')
        const found = await this.checkMedia(tx, input)
        if (current.status === 'published') {
          const slot = (requested: string | null | undefined, kept: { alt: string | null } | null) =>
            requested === undefined ? kept : requested === null ? null : { alt: found.get(requested)?.alt ?? null }
          assertFarmPublishable({
            ...current, ...input,
            coverImage: slot(input.coverMediaId, current.coverId ? { alt: current.coverAlt } : null),
            portraitImage: slot(input.portraitMediaId, current.portraitId ? { alt: current.portraitAlt } : null),
          } as Parameters<typeof assertFarmPublishable>[0])
        }
        await tx.update(farm).set({ ...input, updatedAt: new Date() }).where(eq(farm.id, id))
        await this.audit.record(tx, event('farm.updated', id, actor, { fields: Object.keys(input).sort() }))
        return this.readAdmin(tx, id)
      })
    } catch (error) { throw mapFarmWriteError(error) }
  }

  async transition(id: string, to: 'published' | 'draft' | 'archived', actor: FarmActor): Promise<AdminFarm> {
    return this.db.transaction(async tx => {
      const [current] = await this.selectAdmin(tx, eq(farm.id, id)).for('update', { of: farm }).limit(1)
      if (!current) throw new DomainError('FARM_NOT_FOUND')
      if (current.status === to) return toAdminFarm(current, this.urls)
      assertFarmCanTransition(current.status, to)
      if (to === 'published') {
        assertFarmPublishable({
          ...current,
          coverImage: current.coverId ? { alt: current.coverAlt } : null,
          portraitImage: current.portraitId ? { alt: current.portraitAlt } : null,
        })
      }
      const now = new Date()
      await tx.update(farm).set({ status: to, updatedAt: now,
        ...(to === 'published' ? { publishedAt: now, archivedAt: null } : {}),
        ...(to === 'draft' ? { publishedAt: null } : {}),
        ...(to === 'archived' ? { archivedAt: now, coverMediaId: null, portraitMediaId: null } : {}),
      }).where(eq(farm.id, id))
      const action = to === 'published' ? 'farm.published' : to === 'draft' ? 'farm.unpublished' : 'farm.archived'
      await this.audit.record(tx, event(action, id, actor, {}))
      return this.readAdmin(tx, id)
    })
  }

  publishFarm(id: string, actor: FarmActor) { return this.transition(id, 'published', actor) }
  unpublishFarm(id: string, actor: FarmActor) { return this.transition(id, 'draft', actor) }
  archiveFarm(id: string, actor: FarmActor) { return this.transition(id, 'archived', actor) }
}
