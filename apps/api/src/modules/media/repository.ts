import { createHash, randomUUID } from 'node:crypto'
import { and, asc, desc, eq, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm'
import { farm, mediaAsset, product, productImage } from '../../database/schema'
import type { Database, DatabaseTransaction } from '../../database/types'
import { DomainError } from '../../shared/domain-error'
import { decodeCursor, encodeCursor } from '../../shared/cursor'
import type { AuditEvent } from '../audit/model'
import type { AuditService } from '../audit/service'
import type { CursorPage } from '../products/types'
import type { MediaUrls } from './urls'
import type {
  MediaActor, MediaListQuery, NewMediaRow, StaffMediaDetail, StaffMediaItem,
} from './types'

const defaultLimit = 40
const maxLimit = 60
const cursorTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
// Cursor timestamps travel as text built by Postgres, so they keep created_at's microseconds.
const cursorCreatedAt = sql<string>`to_char(${mediaAsset.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

export function mediaImageColumns(table: typeof mediaAsset) {
  return { id: table.id, alt: table.alt, width: table.width, height: table.height }
}

export interface MediaReadOptions {
  // `share` holds the rows until commit, so a concurrent alt clear waits for (and then sees) this write.
  lock?: 'share'
}

// Existing media rows among `ids`, keyed by id. Callers compare sizes to detect unknown IDs.
export async function findMediaRows(
  db: Database | DatabaseTransaction,
  ids: string[],
  options: MediaReadOptions = {},
): Promise<Map<string, { id: string; alt: string | null }>> {
  if (ids.length === 0) return new Map()
  const query = db.select({ id: mediaAsset.id, alt: mediaAsset.alt })
    .from(mediaAsset).where(inArray(mediaAsset.id, ids))
  const rows = options.lock ? await query.for(options.lock) : await query
  return new Map(rows.map(row => [row.id, row]))
}

export function mapMediaDeleteError(error: unknown): unknown {
  let current = error
  while (current && typeof current === 'object') {
    const record = current as { code?: unknown; cause?: unknown }
    if (record.code === '23503') return new DomainError('MEDIA_IN_USE')
    current = record.cause
  }
  return error
}

export function isContentHashConflict(error: unknown): boolean {
  let current = error
  while (current && typeof current === 'object') {
    const record = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown; cause?: unknown }
    if (record.code === '23505' && String(record.constraint ?? record.constraint_name ?? '').includes('media_asset_content_hash_unique')) {
      return true
    }
    current = record.cause
  }
  return false
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, match => `\\${match}`)
}

function fingerprint(value: object) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function event(action: AuditEvent['action'], targetId: string, actor: MediaActor, metadata: Record<string, unknown>): AuditEvent {
  return {
    id: randomUUID(), action, targetType: 'media', targetId, actorUserId: actor.userId,
    requestId: actor.auditContext.requestId, ipAddress: actor.auditContext.ipAddress,
    userAgent: actor.auditContext.userAgent, metadata,
  }
}

// Drizzle renders single-table columns unqualified, so the outer id is spelled out to avoid
// resolving to the subquery table's own id column.
const productUsage = sql<number>`(select count(*)::int from ${productImage} where ${productImage.mediaId} = "media_asset"."id")`
const farmUsage = sql<number>`(select count(*)::int from ${farm} where ${farm.coverMediaId} = "media_asset"."id" or ${farm.portraitMediaId} = "media_asset"."id")`

const itemColumns = {
  ...mediaImageColumns(mediaAsset),
  byteSize: mediaAsset.byteSize,
  originalFilename: mediaAsset.originalFilename,
  createdAt: mediaAsset.createdAt,
  productUsage: productUsage.as('product_usage'),
  farmUsage: farmUsage.as('farm_usage'),
}

type ItemRow = {
  id: string; alt: string | null; width: number; height: number; byteSize: number
  originalFilename: string; createdAt: Date; productUsage: number; farmUsage: number
}

export class MediaRepository {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly urls: MediaUrls,
  ) {}

  private toItem(row: ItemRow): StaffMediaItem {
    const image = this.urls.image(row)
    if (!image) throw new DomainError('MEDIA_STORAGE_UNAVAILABLE')
    return {
      ...image,
      byteSize: row.byteSize,
      originalFilename: row.originalFilename,
      createdAt: row.createdAt,
      usage: { products: row.productUsage, farms: row.farmUsage },
    }
  }

  private async selectItem(db: Database | DatabaseTransaction, where: SQL) {
    const [row] = await db.select(itemColumns).from(mediaAsset).where(where).limit(1)
    return row ? this.toItem(row) : null
  }

  async list(query: MediaListQuery): Promise<CursorPage<StaffMediaItem>> {
    const limit = query.limit ?? defaultLimit
    if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) throw new DomainError('INVALID_MEDIA')
    const q = query.q?.trim() || null
    if (q && q.length > 200) throw new DomainError('INVALID_MEDIA')
    const scope = fingerprint({ type: 'admin-media', q })
    const cursor = decodeCursor(query.cursor, ['createdAt', 'id', 'fingerprint'])
    if (cursor && (cursor.fingerprint !== scope || !/^[0-9a-f-]{36}$/i.test(cursor.id)
      || !cursorTimePattern.test(cursor.createdAt))) throw new Error('INVALID_CURSOR')
    const cursorAt = cursor ? sql`${cursor.createdAt}::timestamptz` : null
    const pattern = q ? `%${escapeLike(q)}%` : null
    const rows = await this.db.select({ ...itemColumns, cursorCreatedAt }).from(mediaAsset).where(and(
      pattern ? or(ilike(mediaAsset.originalFilename, pattern), ilike(mediaAsset.alt, pattern)) : undefined,
      cursor && cursorAt ? or(
        lt(mediaAsset.createdAt, cursorAt),
        and(eq(mediaAsset.createdAt, cursorAt), lt(mediaAsset.id, cursor.id)),
      ) : undefined,
    )).orderBy(desc(mediaAsset.createdAt), desc(mediaAsset.id)).limit(limit + 1)
    const pageRows = rows.slice(0, limit)
    const last = pageRows.at(-1)
    return {
      items: pageRows.map(({ cursorCreatedAt: _cursorCreatedAt, ...row }) => this.toItem(row)),
      nextCursor: rows.length > limit && last
        ? encodeCursor({ createdAt: last.cursorCreatedAt, id: last.id, fingerprint: scope })
        : null,
    }
  }

  async getById(id: string): Promise<StaffMediaDetail> {
    const item = await this.selectItem(this.db, eq(mediaAsset.id, id))
    if (!item) throw new DomainError('MEDIA_NOT_FOUND')
    const [products, farms] = await Promise.all([
      this.db.select({ id: product.id, name: product.name, slug: product.slug })
        .from(productImage).innerJoin(product, eq(product.id, productImage.productId))
        .where(eq(productImage.mediaId, id)).orderBy(asc(product.name), asc(product.id)),
      this.db.select({ id: farm.id, name: farm.name, cover: farm.coverMediaId, portrait: farm.portraitMediaId })
        .from(farm).where(or(eq(farm.coverMediaId, id), eq(farm.portraitMediaId, id)))
        .orderBy(asc(farm.name), asc(farm.id)),
    ])
    return {
      ...item,
      usedBy: {
        products,
        farms: farms.flatMap(row => [
          ...(row.cover === id ? [{ id: row.id, name: row.name, slot: 'cover' as const }] : []),
          ...(row.portrait === id ? [{ id: row.id, name: row.name, slot: 'portrait' as const }] : []),
        ]),
      },
    }
  }

  findByHash(hash: string): Promise<StaffMediaItem | null> {
    return this.selectItem(this.db, eq(mediaAsset.contentHash, hash))
  }

  async insert(row: NewMediaRow, actor: MediaActor): Promise<StaffMediaItem> {
    return this.db.transaction(async tx => {
      await tx.insert(mediaAsset).values({ ...row, createdBy: actor.userId })
      await this.audit.record(tx, event('media.created', row.id, actor, { byteSize: row.byteSize }))
      const item = await this.selectItem(tx, eq(mediaAsset.id, row.id))
      if (!item) throw new DomainError('MEDIA_NOT_FOUND')
      return item
    })
  }

  async updateAlt(id: string, alt: string | null, actor: MediaActor): Promise<StaffMediaItem> {
    return this.db.transaction(async tx => {
      const [current] = await tx.select({ id: mediaAsset.id }).from(mediaAsset)
        .where(eq(mediaAsset.id, id)).for('update').limit(1)
      if (!current) throw new DomainError('MEDIA_NOT_FOUND')
      if (alt === null) {
        // Published pages need alt text, so a published product or farm may not lose it.
        const [[products], [farms]] = await Promise.all([
          tx.select({ count: sql<number>`count(*)::int` }).from(productImage)
            .innerJoin(product, eq(product.id, productImage.productId))
            .where(and(eq(productImage.mediaId, id), eq(product.status, 'published'))),
          tx.select({ count: sql<number>`count(*)::int` }).from(farm)
            .where(and(or(eq(farm.coverMediaId, id), eq(farm.portraitMediaId, id)), eq(farm.status, 'published'))),
        ])
        if ((products?.count ?? 0) + (farms?.count ?? 0) > 0) throw new DomainError('MEDIA_STATE_CONFLICT')
      }
      await tx.update(mediaAsset).set({ alt, updatedAt: new Date() }).where(eq(mediaAsset.id, id))
      await this.audit.record(tx, event('media.updated', id, actor, { fields: ['alt'] }))
      const item = await this.selectItem(tx, eq(mediaAsset.id, id))
      if (!item) throw new DomainError('MEDIA_NOT_FOUND')
      return item
    })
  }

  async deleteUnused(id: string, actor: MediaActor): Promise<void> {
    try {
      await this.db.transaction(async tx => {
        const [current] = await tx.select({ id: mediaAsset.id }).from(mediaAsset)
          .where(eq(mediaAsset.id, id)).for('update').limit(1)
        if (!current) throw new DomainError('MEDIA_NOT_FOUND')
        const item = await this.selectItem(tx, eq(mediaAsset.id, id))
        if (item && (item.usage.products > 0 || item.usage.farms > 0)) throw new DomainError('MEDIA_IN_USE')
        await tx.delete(mediaAsset).where(eq(mediaAsset.id, id))
        await this.audit.record(tx, event('media.deleted', id, actor, {}))
      })
    } catch (error) { throw mapMediaDeleteError(error) }
  }
}
