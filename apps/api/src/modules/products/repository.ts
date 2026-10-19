import { createHash } from 'node:crypto'
import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../database/types'
import { farm, mediaAsset, product, productFarm, productImage, productSlugRedirect, productVariant } from '../../database/schema'
import type { InventoryReadRepository } from '../inventory/read-repository'
import type { AuditService } from '../audit/service'
import { readProductFarms, replaceProductFarms } from './farm-associations'
import { mapProductImageError, readProductImages, replaceProductImages } from './product-images'
import { mediaImageColumns } from '../media/repository'
import type { MediaUrls } from '../media/urls'
import { normalizeFarmIds } from '../farms/policy'
import { DomainError } from '../../shared/domain-error'
import { decodeCursor, encodeCursor } from '../../shared/cursor'
import { assertPublishable, assertVariantArchivable } from './policy'
import type {
  AdminProductQuery,
  AdminProductSortField,
  AdminProductSummary,
  AdminProduct,
  AdminVariant,
  NormalizedProductCreate,
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
  vatTreatment: product.vatTreatment,
  originStory: product.originStory,
  storageInstructions: product.storageInstructions,
  status: product.status,
  createdAt: product.createdAt,
  updatedAt: product.updatedAt,
  publishedAt: product.publishedAt,
  archivedAt: product.archivedAt,
}

// Cover columns come from a left join on the first gallery slot, so they are all null without one.
const cover = mediaImageColumns(mediaAsset)
const coverProjection = {
  coverId: cover.id, coverAlt: cover.alt, coverWidth: cover.width, coverHeight: cover.height,
}

type ProductRow = Omit<AdminProduct, 'images' | 'farms' | 'variants'>
type CoverRow = { coverId: string | null; coverAlt: string | null; coverWidth: number | null; coverHeight: number | null }

const variantProjection = {
  id: productVariant.id,
  productId: productVariant.productId,
  sku: productVariant.sku,
  name: productVariant.name,
  unit: productVariant.unit,
  priceSatang: productVariant.priceSatang,
  salesEnabled: productVariant.salesEnabled,
  displayOrder: productVariant.displayOrder,
  minRemainingShelfLifeDays: productVariant.minRemainingShelfLifeDays,
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
}

const storeVariantProjection = {
  id: productVariant.id,
  name: productVariant.name,
  unit: productVariant.unit,
  priceSatang: productVariant.priceSatang,
  displayOrder: productVariant.displayOrder,
}

const adminProductSummaryProjection = {
  id: product.id,
  slug: product.slug,
  name: product.name,
  englishName: product.englishName,
  category: product.category,
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

const adminSortColumns = {
  createdAt: product.createdAt,
  updatedAt: product.updatedAt,
  name: product.name,
  category: product.category,
  status: product.status,
} as const

function normalizedAdminQuery(query: AdminProductQuery) {
  assertQueryFields(query, ['q', 'status', 'category', 'sort', 'order', 'limit', 'cursor'])
  const q = normalizeSearch(query.q)
  const { status, category } = query
  if (status !== undefined && status !== 'draft' && status !== 'published' && status !== 'archived') invalidQuery()
  if (category !== undefined && category !== 'fresh' && category !== 'processed') invalidQuery()
  const field = query.sort ?? 'createdAt'
  if (!Object.hasOwn(adminSortColumns, field)) invalidQuery()
  const direction = query.order ?? (field === 'createdAt' || field === 'updatedAt' ? 'desc' : 'asc')
  if (direction !== 'asc' && direction !== 'desc') invalidQuery()
  if (query.cursor === '') invalidCursor()
  if (query.cursor !== undefined && typeof query.cursor !== 'string') return invalidQuery()
  return { q, status, category, sort: { field, direction }, limit: normalizePageSize(query.limit), cursor: query.cursor }
}

// Cursor values travel as text built by Postgres, so timestamps keep their microseconds.
function adminSortCursorText(field: AdminProductSortField) {
  const column = adminSortColumns[field]
  return field === 'createdAt' || field === 'updatedAt'
    ? sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
    : sql<string>`${column}::text`
}

function adminSortCursorParam(field: AdminProductSortField, value: string) {
  if (field === 'createdAt' || field === 'updatedAt') return sql`${validateCreatedAt(value)}::timestamptz`
  if (field === 'category' && value !== 'fresh' && value !== 'processed') invalidCursor()
  if (field === 'status' && value !== 'draft' && value !== 'published' && value !== 'archived') invalidCursor()
  if (field === 'name' && value.length > 160) invalidCursor()
  return sql`${value}`
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
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly inventory: Pick<InventoryReadRepository, 'getSellableVariantIds'>,
    private readonly urls: MediaUrls,
  ) {}

  private toCoverImage(row: CoverRow) {
    return this.urls.image({ id: row.coverId, alt: row.coverAlt, width: row.coverWidth, height: row.coverHeight })
  }

  async listStore(input: StoreProductQuery): Promise<CursorPage<StoreProductSummary>> {
    return this.listStoreScoped(input)
  }

  async listStoreForFarm(farmId: string, input: Pick<StoreProductQuery, 'limit' | 'cursor'>): Promise<CursorPage<StoreProductSummary>> {
    return this.listStoreScoped({ ...input, sort: 'newest' }, farmId)
  }

  private async listStoreScoped(input: StoreProductQuery, farmId?: string): Promise<CursorPage<StoreProductSummary>> {
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
      farmId: farmId ?? null,
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
      ...coverProjection,
      minPriceSatang: activeMinimums.minPriceSatang,
      cursorSortKey: sql<string>`to_char(${product.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as('cursor_sort_key'),
    }).from(product)
      .innerJoin(activeMinimums, eq(activeMinimums.productId, product.id))
      .leftJoin(productImage, and(eq(productImage.productId, product.id), eq(productImage.displayOrder, 0)))
      .leftJoin(mediaAsset, eq(mediaAsset.id, productImage.mediaId))
      .where(and(
        eq(product.status, 'published'),
        farmId ? inArray(product.id, this.db.select({ productId: productFarm.productId }).from(productFarm)
          .innerJoin(farm, eq(productFarm.farmId, farm.id))
          .where(and(eq(productFarm.farmId, farmId), eq(farm.status, 'published')))) : undefined,
        query.category ? eq(product.category, query.category) : undefined,
        searchProducts(query.q),
        cursorCondition,
      ))
      .orderBy(...orderBy)
      .limit(query.limit + 1)

    const hasMore = rows.length > query.limit
    const pageRows = rows.slice(0, query.limit)
    const last = pageRows.at(-1)
    const pageProductIds = pageRows.map(({ id }) => id)
    const activeVariants = pageProductIds.length > 0
      ? await this.db.select({ id: productVariant.id, productId: productVariant.productId })
        .from(productVariant)
        .where(and(inArray(productVariant.productId, pageProductIds), isNull(productVariant.archivedAt)))
      : []
    const sellableVariantIds = activeVariants.length > 0
      ? await this.inventory.getSellableVariantIds(activeVariants.map(({ id }) => id))
      : new Set<string>()
    const purchasableProductIds = new Set(activeVariants
      .filter(({ id }) => sellableVariantIds.has(id))
      .map(({ productId }) => productId))
    const items = pageRows.map(({
      cursorSortKey: _cursorSortKey, coverId, coverAlt, coverWidth, coverHeight, ...summary
    }) => ({
      ...summary,
      coverImage: this.toCoverImage({ coverId, coverAlt, coverWidth, coverHeight }),
      canPurchase: purchasableProductIds.has(summary.id),
    }))
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
    const detailProjection = {
      ...storeProductProjection,
      description: product.description,
      originStory: product.originStory,
      storageInstructions: product.storageInstructions,
    }
    const [current] = await this.db.select(detailProjection).from(product)
      .where(and(eq(product.slug, slug), eq(product.status, 'published')))
      .limit(1)
    // Fall back to a former slug so old links keep working; the response carries the current slug.
    const [row] = current ? [current] : await this.db.select(detailProjection).from(productSlugRedirect)
      .innerJoin(product, eq(product.id, productSlugRedirect.productId))
      .where(and(eq(productSlugRedirect.slug, slug), eq(product.status, 'published')))
      .limit(1)
    if (!row) throw new DomainError('PRODUCT_NOT_FOUND')

    const activeVariants = await this.db.select(storeVariantProjection)
      .from(productVariant)
      .where(and(eq(productVariant.productId, row.id), isNull(productVariant.archivedAt)))
      .orderBy(asc(productVariant.displayOrder), asc(productVariant.id))
    if (!activeVariants.length) throw new DomainError('PRODUCT_NOT_FOUND')
    const sellableVariantIds = await this.inventory.getSellableVariantIds(
      activeVariants.map(({ id }) => id),
    )
    const variants: StoreProductVariant[] = activeVariants.map(({ id, ...variant }) => ({
      id,
      ...variant,
      canPurchase: sellableVariantIds.has(id),
    }))
    const linkedFarms = await readProductFarms(this.db, row.id, this.urls, true)
    const images = (await readProductImages(this.db, [row.id], this.urls)).get(row.id) ?? []
    return {
      ...row,
      images,
      coverImage: images[0] ?? null,
      minPriceSatang: Math.min(...variants.map(({ priceSatang }) => priceSatang)),
      canPurchase: variants.some(({ canPurchase }) => canPurchase),
      variants,
      farms: linkedFarms.map(({ status: _status, displayOrder, ...summary }) => ({ ...summary, displayOrder })),
    }
  }

  async listAdmin(input: AdminProductQuery): Promise<CursorPage<AdminProductSummary>> {
    const query = normalizedAdminQuery(input)
    const { field, direction } = query.sort
    const isDefaultSort = field === 'createdAt' && direction === 'desc'
    // Unset filters and the default sort stay out of the fingerprint so existing cursors remain valid.
    const queryFingerprint = fingerprint({
      q: query.q ?? null,
      status: query.status ?? null,
      ...(query.category ? { category: query.category } : {}),
      ...(isDefaultSort ? {} : { sort: `${field}.${direction}` }),
    })
    const column = adminSortColumns[field]
    const [operator, orderBy] = direction === 'desc' ? [sql.raw('<'), desc] : [sql.raw('>'), asc]
    const cursor = decodeCursor(query.cursor, ['sortKey', 'id', 'fingerprint'])
    let cursorCondition
    if (cursor) {
      validateCursorIdentity(cursor, queryFingerprint)
      // A row comparison lets Postgres start the (column, id) index scan at the cursor.
      cursorCondition = sql`(${column}, ${product.id}) ${operator} (${adminSortCursorParam(field, cursor.sortKey)}, ${cursor.id}::uuid)`
    }
    const rows = await this.db.select({
      ...adminProductSummaryProjection,
      ...coverProjection,
      cursorSortKey: adminSortCursorText(field).as('cursor_sort_key'),
    }).from(product)
      .leftJoin(productImage, and(eq(productImage.productId, product.id), eq(productImage.displayOrder, 0)))
      .leftJoin(mediaAsset, eq(mediaAsset.id, productImage.mediaId))
      .where(and(
        query.status ? eq(product.status, query.status) : undefined,
        query.category ? eq(product.category, query.category) : undefined,
        searchProducts(query.q),
        cursorCondition,
      ))
      .orderBy(orderBy(column), orderBy(product.id))
      .limit(query.limit + 1)
    const hasMore = rows.length > query.limit
    const pageRows = rows.slice(0, query.limit)
    const items = pageRows.map(({
      cursorSortKey: _cursorSortKey, coverId, coverAlt, coverWidth, coverHeight, ...summary
    }) => ({ ...summary, coverImage: this.toCoverImage({ coverId, coverAlt, coverWidth, coverHeight }) }))
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

  async getAdminById(id: string): Promise<AdminProduct & { farms: import('../farms/types').AdminProductFarm[]; variants: AdminVariant[] }> {
    const [row] = await this.db.select(productProjection).from(product)
      .where(eq(product.id, id)).limit(1)
    if (!row) throw new DomainError('PRODUCT_NOT_FOUND')
    const variants = await this.db.select(variantProjection).from(productVariant)
      .where(eq(productVariant.productId, id))
      .orderBy(asc(productVariant.displayOrder), asc(productVariant.id))
    const farms = await readProductFarms(this.db, id, this.urls)
    const images = (await readProductImages(this.db, [id], this.urls)).get(id) ?? []
    return { ...row, images, variants, farms }
  }

  replaceFarms(id: string, farmIds: string[], actor: ProductActor) {
    const normalizedIds = normalizeFarmIds(farmIds)
    return this.transaction(tx => replaceProductFarms(tx, id, normalizedIds, actor, this.audit, this.urls))
  }

  private async transaction<T>(callback: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(callback)
    } catch (error) {
      throw mapProductImageError(mapUniqueViolation(error))
    }
  }

  private async lockProduct(tx: DatabaseTransaction, id: string): Promise<ProductRow> {
    const [locked] = await tx.select(productProjection).from(product)
      .where(eq(product.id, id)).for('update').limit(1)
    if (!locked) throw new DomainError('PRODUCT_NOT_FOUND')
    return locked
  }

  // Serialises writers claiming the same slug, so a product slug and a redirect can never collide.
  private async claimSlug(tx: DatabaseTransaction, slug: string, productId?: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`product-slug:${slug}`}, 0))`)
    const [reserved] = await tx.select({ productId: productSlugRedirect.productId }).from(productSlugRedirect)
      .where(eq(productSlugRedirect.slug, slug)).limit(1)
    if (reserved && reserved.productId !== productId) throw new DomainError('PRODUCT_SLUG_CONFLICT')
  }

  private async withImages(tx: DatabaseTransaction, row: ProductRow): Promise<AdminProduct> {
    return { ...row, images: (await readProductImages(tx, [row.id], this.urls)).get(row.id) ?? [] }
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

  createProduct(input: NormalizedProductCreate, actor: ProductActor): Promise<AdminProduct> {
    return this.transaction(async (tx) => {
      await this.claimSlug(tx, input.slug)
      const { imageIds, ...fields } = input
      const [created] = await tx.insert(product).values({
        id: crypto.randomUUID(),
        ...fields,
        status: 'draft',
      }).returning(productProjection)
      await this.record(tx, actor, 'product.created', 'product', created.id, Object.keys(input))
      if (imageIds !== undefined) await replaceProductImages(tx, created.id, imageIds, actor, this.audit)
      return this.withImages(tx, created)
    })
  }

  updateProduct(id: string, input: UpdateProductInput, actor: ProductActor): Promise<AdminProduct> {
    return this.transaction(async (tx) => {
      const current = await this.lockProduct(tx, id)
      if (current.status === 'archived') throw new DomainError('PRODUCT_STATE_CONFLICT')
      const { slug, imageIds, ...details } = input
      const slugChanged = slug !== undefined && slug !== current.slug
      const changes = slugChanged ? { ...details, slug } : details
      const imagesChanged = imageIds !== undefined
        && await replaceProductImages(tx, id, imageIds, actor, this.audit)
      if (!Object.keys(changes).length && !imagesChanged) return this.withImages(tx, current)
      const next = await this.withImages(tx, { ...current, ...changes })
      if (current.status === 'published') assertPublishable(next, await this.activeVariants(tx, id))
      if (slugChanged) {
        await this.claimSlug(tx, slug, id)
        // Reclaiming one of this product's own former slugs turns it back into the live slug.
        await tx.delete(productSlugRedirect).where(and(eq(productSlugRedirect.slug, slug), eq(productSlugRedirect.productId, id)))
        await tx.insert(productSlugRedirect).values({ slug: current.slug, productId: id })
      }
      const [updated] = await tx.update(product).set({ ...changes, updatedAt: new Date() })
        .where(eq(product.id, id)).returning(productProjection)
      if (Object.keys(changes).length) {
        await this.record(tx, actor, 'product.updated', 'product', id, Object.keys(changes),
          slugChanged ? { previousSlug: current.slug, slug } : {})
      }
      return { ...updated, images: next.images }
    })
  }

  publishProduct(id: string, actor: ProductActor): Promise<void> {
    return this.transaction(async (tx) => {
      const current = await this.lockProduct(tx, id)
      if (current.status !== 'draft') throw new DomainError('PRODUCT_STATE_CONFLICT')
      assertPublishable(await this.withImages(tx, current), await this.activeVariants(tx, id))
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
      await tx.delete(productImage).where(eq(productImage.productId, id))
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
