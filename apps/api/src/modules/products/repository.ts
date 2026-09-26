import { createHash } from 'node:crypto'
import { and, asc, count, desc, eq, gt, ilike, isNull, lt, or, sql } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../database/types'
import { product, productVariant } from '../../database/schema'
import type { AuditService } from '../audit/service'
import { DomainError } from '../../shared/domain-error'
import { decodeCursor, encodeCursor } from '../../shared/cursor'
import { assertPublishable, assertVariantArchivable } from './policy'
import type {
  AdminProductQuery,
  AdminProductSummary,
  AdminProduct,
  AdminVariant,
  CreateProductInput,
  CreateVariantInput,
  CursorPage,
  ProductActor,
  ProductStatus,
  StoreProductDetail,
  StoreProductQuery,
  StoreProductSummary,
  StoreProductVariant,
  UpdateProductInput,
  UpdateVariantInput,
} from './types'

const productProjection = {
  id: product.id,
  slug: product.slug,
  name: product.name,
  englishName: product.englishName,
  description: product.description,
  category: product.category,
  originStory: product.originStory,
  storageInstructions: product.storageInstructions,
  imageUrl: product.imageUrl,
  imageAlt: product.imageAlt,
  status: product.status,
  createdAt: product.createdAt,
  updatedAt: product.updatedAt,
  publishedAt: product.publishedAt,
  archivedAt: product.archivedAt,
}

const variantProjection = {
  id: productVariant.id,
  productId: productVariant.productId,
  sku: productVariant.sku,
  name: productVariant.name,
  unit: productVariant.unit,
  priceSatang: productVariant.priceSatang,
  salesEnabled: productVariant.salesEnabled,
  displayOrder: productVariant.displayOrder,
  createdAt: productVariant.createdAt,
  updatedAt: productVariant.updatedAt,
  archivedAt: productVariant.archivedAt,
}

const storeProductProjection = {
  id: product.id,
  slug: product.slug,
  name: product.name,
  englishName: product.englishName,
  category: product.category,
  imageUrl: product.imageUrl,
  imageAlt: product.imageAlt,
}

const storeVariantProjection = {
  id: productVariant.id,
  name: productVariant.name,
  unit: productVariant.unit,
  priceSatang: productVariant.priceSatang,
  displayOrder: productVariant.displayOrder,
  canPurchase: productVariant.salesEnabled,
}

const adminProductSummaryProjection = {
  id: product.id,
  slug: product.slug,
  name: product.name,
  englishName: product.englishName,
  category: product.category,
  imageUrl: product.imageUrl,
  imageAlt: product.imageAlt,
  status: product.status,
  createdAt: product.createdAt,
  updatedAt: product.updatedAt,
  publishedAt: product.publishedAt,
  archivedAt: product.archivedAt,
}

const pageSizeDefault = 50
const pageSizeMaximum = 100
const searchLimit = 200
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function invalidCursor(): never {
  throw new Error('INVALID_CURSOR')
}

function invalidQuery(): never {
  throw new DomainError('INVALID_PRODUCT')
}

function normalizeSearch(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return invalidQuery()
  const normalized = value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
  if (normalized.length > searchLimit) return invalidQuery()
  return normalized || undefined
}

function normalizePageSize(value: unknown): number {
  if (value === undefined) return pageSizeDefault
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > pageSizeMaximum) {
    return invalidQuery()
  }
  return value as number
}

function assertQueryFields(query: object, allowed: readonly string[]) {
  if (Object.keys(query).some((field) => !allowed.includes(field))) invalidQuery()
}

function normalizedStoreQuery(query: StoreProductQuery) {
  assertQueryFields(query, ['q', 'category', 'sort', 'limit', 'cursor'])
  const q = normalizeSearch(query.q)
  const category = query.category
  const sort = query.sort ?? 'newest'
  if (category !== undefined && category !== 'fresh' && category !== 'processed') invalidQuery()
  if (sort !== 'newest' && sort !== 'price-asc' && sort !== 'price-desc') invalidQuery()
  if (query.cursor === '') invalidCursor()
  if (query.cursor !== undefined && typeof query.cursor !== 'string') return invalidQuery()
  return { q, category, sort, limit: normalizePageSize(query.limit), cursor: query.cursor }
}

function normalizedAdminQuery(query: AdminProductQuery) {
  assertQueryFields(query, ['q', 'status', 'limit', 'cursor'])
  const q = normalizeSearch(query.q)
  const status = query.status
  if (status !== undefined && status !== 'draft' && status !== 'published' && status !== 'archived') invalidQuery()
  if (query.cursor === '') invalidCursor()
  if (query.cursor !== undefined && typeof query.cursor !== 'string') return invalidQuery()
  return { q, status, limit: normalizePageSize(query.limit), cursor: query.cursor }
}

function fingerprint(value: Record<string, string | null>) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function searchProducts(q: string | undefined) {
  if (!q) return undefined
  const term = `%${q.replace(/[\\%_]/g, '\\$&')}%`
  return or(ilike(product.name, term), ilike(product.englishName, term), ilike(product.slug, term))
}

function validateCursorIdentity(cursor: Record<string, string>, expectedFingerprint: string) {
  if (cursor.fingerprint !== expectedFingerprint || !uuidPattern.test(cursor.id)) invalidCursor()
}

function validateCreatedAt(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(value)
  if (!match) return invalidCursor()
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) invalidCursor()
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (day < 1 || day > daysInMonth[month - 1]!) invalidCursor()
  return value
}

function validatePrice(value: string): number {
  if (!/^[1-9]\d{0,9}$/.test(value)) return invalidCursor()
  const parsed = Number(value)
  if (parsed > 1_000_000_000) return invalidCursor()
  return parsed
}

function mapUniqueViolation(error: unknown): unknown {
  let current = error
  while (current && typeof current === 'object') {
    const record = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown; cause?: unknown; message?: unknown }
    const constraint = String(record.constraint ?? record.constraint_name ?? record.message ?? '')
    if (record.code === '23505') {
      if (constraint.includes('product_slug_unique')) return new DomainError('PRODUCT_SLUG_CONFLICT')
      if (constraint.includes('product_variant_sku_unique')) return new DomainError('SKU_CONFLICT')
    }
    current = record.cause
  }
  return error
}

export class ProductRepository {
  constructor(private readonly db: Database, private readonly audit: AuditService) {}

  async listStore(input: StoreProductQuery): Promise<CursorPage<StoreProductSummary>> {
    const query = normalizedStoreQuery(input)
    const activeMinimums = this.db.select({
      productId: productVariant.productId,
      minPriceSatang: sql<number>`min(${productVariant.priceSatang})`.mapWith(Number).as('min_price_satang'),
    }).from(productVariant)
      .where(isNull(productVariant.archivedAt))
      .groupBy(productVariant.productId)
      .as('active_variant_minimums')
    const queryFingerprint = fingerprint({
      q: query.q ?? null,
      category: query.category ?? null,
      sort: query.sort,
    })
    const cursor = decodeCursor(query.cursor, ['sortKey', 'id', 'fingerprint'])
    let cursorCondition
    if (cursor) {
      validateCursorIdentity(cursor, queryFingerprint)
      if (query.sort === 'newest') {
        const createdAt = sql`${validateCreatedAt(cursor.sortKey)}::timestamptz`
        cursorCondition = or(lt(product.createdAt, createdAt), and(
          eq(product.createdAt, createdAt), lt(product.id, cursor.id),
        ))
      } else {
        const price = validatePrice(cursor.sortKey)
        cursorCondition = query.sort === 'price-asc'
          ? or(gt(activeMinimums.minPriceSatang, price), and(
            eq(activeMinimums.minPriceSatang, price), gt(product.id, cursor.id),
          ))
          : or(lt(activeMinimums.minPriceSatang, price), and(
            eq(activeMinimums.minPriceSatang, price), gt(product.id, cursor.id),
          ))
      }
    }

    const orderBy = query.sort === 'newest'
      ? [desc(product.createdAt), desc(product.id)]
      : query.sort === 'price-asc'
        ? [asc(activeMinimums.minPriceSatang), asc(product.id)]
        : [desc(activeMinimums.minPriceSatang), asc(product.id)]
    const rows = await this.db.select({
      ...storeProductProjection,
      minPriceSatang: activeMinimums.minPriceSatang,
      cursorSortKey: sql<string>`to_char(${product.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as('cursor_sort_key'),
    }).from(product)
      .innerJoin(activeMinimums, eq(activeMinimums.productId, product.id))
      .where(and(
        eq(product.status, 'published'),
        query.category ? eq(product.category, query.category) : undefined,
        searchProducts(query.q),
        cursorCondition,
      ))
      .orderBy(...orderBy)
      .limit(query.limit + 1)

    const hasMore = rows.length > query.limit
    const pageRows = rows.slice(0, query.limit)
    const last = pageRows.at(-1)
    const items = pageRows.map(({ cursorSortKey: _cursorSortKey, ...summary }) => summary)
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor({
        sortKey: query.sort === 'newest' ? last.cursorSortKey : String(last.minPriceSatang),
        id: last.id,
        fingerprint: queryFingerprint,
      }) : null,
    }
  }

  async getStoreBySlug(slug: string): Promise<StoreProductDetail> {
    const [row] = await this.db.select({
      ...storeProductProjection,
      description: product.description,
      originStory: product.originStory,
      storageInstructions: product.storageInstructions,
    }).from(product)
      .where(and(eq(product.slug, slug), eq(product.status, 'published')))
      .limit(1)
    if (!row) throw new DomainError('PRODUCT_NOT_FOUND')

    const variants: StoreProductVariant[] = await this.db.select(storeVariantProjection)
      .from(productVariant)
      .where(and(eq(productVariant.productId, row.id), isNull(productVariant.archivedAt)))
      .orderBy(asc(productVariant.displayOrder), asc(productVariant.id))
    if (!variants.length) throw new DomainError('PRODUCT_NOT_FOUND')
    return {
      ...row,
      minPriceSatang: Math.min(...variants.map(({ priceSatang }) => priceSatang)),
      variants,
    }
  }

  async listAdmin(input: AdminProductQuery): Promise<CursorPage<AdminProductSummary>> {
    const query = normalizedAdminQuery(input)
    const queryFingerprint = fingerprint({
      q: query.q ?? null,
      status: query.status ?? null,
    })
    const cursor = decodeCursor(query.cursor, ['sortKey', 'id', 'fingerprint'])
    let cursorCondition
    if (cursor) {
      validateCursorIdentity(cursor, queryFingerprint)
      const createdAt = sql`${validateCreatedAt(cursor.sortKey)}::timestamptz`
      cursorCondition = or(lt(product.createdAt, createdAt), and(
        eq(product.createdAt, createdAt), lt(product.id, cursor.id),
      ))
    }
    const rows = await this.db.select({
      ...adminProductSummaryProjection,
      cursorSortKey: sql<string>`to_char(${product.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as('cursor_sort_key'),
    }).from(product)
      .where(and(
        query.status ? eq(product.status, query.status) : undefined,
        searchProducts(query.q),
        cursorCondition,
      ))
      .orderBy(desc(product.createdAt), desc(product.id))
      .limit(query.limit + 1)
    const hasMore = rows.length > query.limit
    const pageRows = rows.slice(0, query.limit)
    const items = pageRows.map(({ cursorSortKey: _cursorSortKey, ...summary }) => summary)
    const last = pageRows.at(-1)
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor({
        sortKey: last.cursorSortKey,
        id: last.id,
        fingerprint: queryFingerprint,
      }) : null,
    }
  }

  async getAdminById(id: string): Promise<AdminProduct> {
    const [row] = await this.db.select(productProjection).from(product)
      .where(eq(product.id, id)).limit(1)
    if (!row) throw new DomainError('PRODUCT_NOT_FOUND')
    const variants = await this.db.select(variantProjection).from(productVariant)
      .where(eq(productVariant.productId, id))
      .orderBy(asc(productVariant.displayOrder), asc(productVariant.id))
    return { ...row, variants }
  }

  private async transaction<T>(callback: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(callback)
    } catch (error) {
      throw mapUniqueViolation(error)
    }
  }

  private async lockProduct(tx: DatabaseTransaction, id: string): Promise<AdminProduct> {
    const [locked] = await tx.select(productProjection).from(product)
      .where(eq(product.id, id)).for('update').limit(1)
    if (!locked) throw new DomainError('PRODUCT_NOT_FOUND')
    return locked
  }

  private async activeVariants(tx: DatabaseTransaction, productId: string): Promise<AdminVariant[]> {
    return tx.select(variantProjection).from(productVariant)
      .where(and(eq(productVariant.productId, productId), isNull(productVariant.archivedAt)))
  }

  private async record(
    tx: DatabaseTransaction,
    actor: ProductActor,
    action: Parameters<AuditService['record']>[1]['action'],
    targetType: string,
    targetId: string,
    fields?: string[],
    identifiers: Record<string, string> = {},
  ) {
    await this.audit.record(tx, {
      id: crypto.randomUUID(),
      actorUserId: actor.userId,
      action,
      targetType,
      targetId,
      ...actor.auditContext,
      metadata: { ...identifiers, ...(fields ? { fields } : {}) },
    })
  }

  createProduct(input: CreateProductInput, actor: ProductActor): Promise<AdminProduct> {
    return this.transaction(async (tx) => {
      const [created] = await tx.insert(product).values({
        id: crypto.randomUUID(),
        ...input,
        status: 'draft',
      }).returning(productProjection)
      await this.record(tx, actor, 'product.created', 'product', created.id, Object.keys(input))
      return created
    })
  }

  updateProduct(id: string, input: UpdateProductInput, actor: ProductActor): Promise<AdminProduct> {
    return this.transaction(async (tx) => {
      const current = await this.lockProduct(tx, id)
      if (current.status === 'archived') throw new DomainError('PRODUCT_STATE_CONFLICT')
      const next = { ...current, ...input }
      if (current.status === 'published') assertPublishable(next, await this.activeVariants(tx, id))
      const [updated] = await tx.update(product).set({ ...input, updatedAt: new Date() })
        .where(eq(product.id, id)).returning(productProjection)
      await this.record(tx, actor, 'product.updated', 'product', id, Object.keys(input))
      return updated
    })
  }

  publishProduct(id: string, actor: ProductActor): Promise<void> {
    return this.transaction(async (tx) => {
      const current = await this.lockProduct(tx, id)
      if (current.status !== 'draft') throw new DomainError('PRODUCT_STATE_CONFLICT')
      assertPublishable(current, await this.activeVariants(tx, id))
      await tx.update(product).set({ status: 'published', publishedAt: new Date(), updatedAt: new Date() })
        .where(eq(product.id, id))
      await this.record(tx, actor, 'product.published', 'product', id)
    })
  }

  unpublishProduct(id: string, actor: ProductActor): Promise<void> {
    return this.transaction(async (tx) => {
      const current = await this.lockProduct(tx, id)
      if (current.status !== 'published') throw new DomainError('PRODUCT_STATE_CONFLICT')
      await tx.update(product).set({ status: 'draft', publishedAt: null, updatedAt: new Date() })
        .where(eq(product.id, id))
      await this.record(tx, actor, 'product.unpublished', 'product', id)
    })
  }

  archiveProduct(id: string, actor: ProductActor): Promise<void> {
    return this.transaction(async (tx) => {
      const current = await this.lockProduct(tx, id)
      if (current.status === 'archived') throw new DomainError('PRODUCT_STATE_CONFLICT')
      await tx.update(product).set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(product.id, id))
      await this.record(tx, actor, 'product.archived', 'product', id)
    })
  }

  createVariant(productId: string, input: CreateVariantInput, actor: ProductActor): Promise<AdminVariant> {
    return this.transaction(async (tx) => {
      const parent = await this.lockProduct(tx, productId)
      if (parent.status === 'archived') throw new DomainError('PRODUCT_STATE_CONFLICT')
      const [created] = await tx.insert(productVariant).values({
        id: crypto.randomUUID(),
        productId,
        ...input,
      }).returning(variantProjection)
      await this.record(tx, actor, 'product.variant-created', 'product_variant', created.id, Object.keys(input), { productId })
      return created
    })
  }

  updateVariant(
    productId: string,
    variantId: string,
    input: UpdateVariantInput,
    actor: ProductActor,
  ): Promise<AdminVariant> {
    return this.transaction(async (tx) => {
      const parent = await this.lockProduct(tx, productId)
      if (parent.status === 'archived') throw new DomainError('PRODUCT_STATE_CONFLICT')
      const [current] = await tx.select(variantProjection).from(productVariant)
        .where(and(eq(productVariant.id, variantId), eq(productVariant.productId, productId)))
        .for('update').limit(1)
      if (!current) throw new DomainError('VARIANT_NOT_FOUND')
      if (current.archivedAt) throw new DomainError('PRODUCT_STATE_CONFLICT')
      const [updated] = await tx.update(productVariant).set({ ...input, updatedAt: new Date() })
        .where(eq(productVariant.id, variantId)).returning(variantProjection)
      await this.record(tx, actor, 'product.variant-updated', 'product_variant', variantId, Object.keys(input), { productId })
      return updated
    })
  }

  archiveVariant(productId: string, variantId: string, actor: ProductActor): Promise<void> {
    return this.transaction(async (tx) => {
      const parent = await this.lockProduct(tx, productId)
      if (parent.status === 'archived') throw new DomainError('PRODUCT_STATE_CONFLICT')
      const [current] = await tx.select({ id: productVariant.id, archivedAt: productVariant.archivedAt })
        .from(productVariant)
        .where(and(eq(productVariant.id, variantId), eq(productVariant.productId, productId)))
        .for('update').limit(1)
      if (!current) throw new DomainError('VARIANT_NOT_FOUND')
      if (current.archivedAt) throw new DomainError('PRODUCT_STATE_CONFLICT')
      const [{ activeCount }] = await tx.select({ activeCount: count() }).from(productVariant)
        .where(and(eq(productVariant.productId, productId), isNull(productVariant.archivedAt)))
      assertVariantArchivable(parent.status as ProductStatus, activeCount)
      await tx.update(productVariant).set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(productVariant.id, variantId))
      await this.record(tx, actor, 'product.variant-archived', 'product_variant', variantId, undefined, { productId })
    })
  }
}
