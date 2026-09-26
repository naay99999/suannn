import { createHash } from 'node:crypto'
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { Database } from '../../database/types'
import { inventoryLot, product, productVariant, stockMovement, warehouse } from '../../database/schema'
import { DomainError } from '../../shared/domain-error'
import { decodeCursor, encodeCursor } from '../../shared/cursor'
import { isLotEligible } from './policy'
import type {
  InventoryCursorPage,
  LotDetail,
  LotQuery,
  MovementDetail,
  MovementQuery,
  VariantStockSummary,
  WarehouseDetail,
} from './types'

const defaultPageSize = 50
const maximumPageSize = 100
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const cursorTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

interface LotReadRow {
  id: string
  warehouseId: string
  variantId: string
  lotCode: string
  receivedAt: Date
  expiryDate: string
  quarantinedAt: Date | null
  quarantineReason: string | null
  onHandQuantity: number
  reservedQuantity: number
  createdAt: Date
  updatedAt: Date
  productStatus: string
  salesEnabled: boolean
  variantArchivedAt: Date | null
  minRemainingShelfLifeDays: number
  warehouseActive: boolean
}

const lotReadProjection = {
  id: inventoryLot.id,
  warehouseId: inventoryLot.warehouseId,
  variantId: inventoryLot.variantId,
  lotCode: inventoryLot.lotCode,
  receivedAt: inventoryLot.receivedAt,
  expiryDate: inventoryLot.expiryDate,
  quarantinedAt: inventoryLot.quarantinedAt,
  quarantineReason: inventoryLot.quarantineReason,
  onHandQuantity: inventoryLot.onHandQuantity,
  reservedQuantity: inventoryLot.reservedQuantity,
  createdAt: inventoryLot.createdAt,
  updatedAt: inventoryLot.updatedAt,
  productStatus: product.status,
  salesEnabled: productVariant.salesEnabled,
  variantArchivedAt: productVariant.archivedAt,
  minRemainingShelfLifeDays: productVariant.minRemainingShelfLifeDays,
  warehouseActive: warehouse.isActive,
}

function nowFromDatabase(value: Date | string) {
  return value instanceof Date ? value : new Date(value)
}

function fingerprint(value: Record<string, string | null>) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function normalizePageSize(value: unknown): number {
  if (value === undefined) return defaultPageSize
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximumPageSize) {
    throw new DomainError('INVALID_INVENTORY_QUERY')
  }
  return value as number
}

function invalidCursor(): never {
  throw new Error('INVALID_CURSOR')
}

function validateCursor(
  value: string | undefined,
  expectedFingerprint: string,
  timestampKey: 'receivedAt' | 'occurredAt',
) {
  const cursor = decodeCursor(value, [timestampKey, 'id', 'fingerprint'])
  if (!cursor) return null
  const timestamp = cursor[timestampKey]
  if (!cursorTimePattern.test(timestamp) || !Number.isFinite(Date.parse(timestamp))
    || !uuidPattern.test(cursor.id) || cursor.fingerprint !== expectedFingerprint) invalidCursor()
  return { timestamp, id: cursor.id }
}

function normalizeLotQuery(query: LotQuery) {
  if (!query || typeof query !== 'object' || Array.isArray(query)
    || Object.keys(query).some((key) => !['warehouseId', 'variantId', 'limit', 'cursor'].includes(key))) {
    throw new DomainError('INVALID_INVENTORY_QUERY')
  }
  if (query.cursor !== undefined && (typeof query.cursor !== 'string' || query.cursor.length === 0)) invalidCursor()
  if (query.warehouseId !== undefined && typeof query.warehouseId !== 'string') {
    throw new DomainError('INVALID_INVENTORY_QUERY')
  }
  if (query.variantId !== undefined && typeof query.variantId !== 'string') {
    throw new DomainError('INVALID_INVENTORY_QUERY')
  }
  const filters = {
    warehouseId: query.warehouseId ?? null,
    variantId: query.variantId ?? null,
  }
  return { ...filters, limit: normalizePageSize(query.limit), cursor: query.cursor, queryFingerprint: fingerprint(filters) }
}

function normalizeMovementQuery(query: MovementQuery) {
  if (!query || typeof query !== 'object' || Array.isArray(query)
    || Object.keys(query).some((key) => !['warehouseId', 'variantId', 'lotId', 'limit', 'cursor'].includes(key))) {
    throw new DomainError('INVALID_INVENTORY_QUERY')
  }
  if (query.cursor !== undefined && (typeof query.cursor !== 'string' || query.cursor.length === 0)) invalidCursor()
  for (const value of [query.warehouseId, query.variantId, query.lotId]) {
    if (value !== undefined && typeof value !== 'string') throw new DomainError('INVALID_INVENTORY_QUERY')
  }
  const filters = {
    warehouseId: query.warehouseId ?? null,
    variantId: query.variantId ?? null,
    lotId: query.lotId ?? null,
  }
  return { ...filters, limit: normalizePageSize(query.limit), cursor: query.cursor, queryFingerprint: fingerprint(filters) }
}

function toLotDetail(row: LotReadRow, now: Date): LotDetail {
  const sellableQuantity = row.warehouseActive && row.productStatus === 'published' && row.salesEnabled
    && !row.variantArchivedAt && !row.quarantinedAt
    && isLotEligible(row.expiryDate, row.minRemainingShelfLifeDays, now)
    ? Math.max(0, row.onHandQuantity - row.reservedQuantity)
    : 0
  return {
    id: row.id,
    warehouseId: row.warehouseId,
    variantId: row.variantId,
    lotCode: row.lotCode,
    receivedAt: row.receivedAt.toISOString(),
    expiryDate: row.expiryDate,
    quarantinedAt: row.quarantinedAt?.toISOString() ?? null,
    quarantineReason: row.quarantineReason,
    onHandQuantity: row.onHandQuantity,
    reservedQuantity: row.reservedQuantity,
    sellableQuantity,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export class InventoryReadRepository {
  constructor(private readonly db: Database) {}

  async getDefaultWarehouse(): Promise<WarehouseDetail> {
    const [row] = await this.db.select().from(warehouse).where(eq(warehouse.code, 'MAIN')).limit(1)
    if (!row) throw new DomainError('WAREHOUSE_NOT_FOUND')
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  async getSellableVariantIds(variantIds: readonly string[]): Promise<Set<string>> {
    const requestedIds = [...new Set(variantIds)]
    if (requestedIds.length === 0) return new Set()

    const lots = await this.db.select({
      variantId: productVariant.id,
      expiryDate: inventoryLot.expiryDate,
      minRemainingShelfLifeDays: productVariant.minRemainingShelfLifeDays,
      now: sql<Date>`transaction_timestamp()`,
    }).from(inventoryLot)
      .innerJoin(productVariant, eq(inventoryLot.variantId, productVariant.id))
      .innerJoin(product, eq(productVariant.productId, product.id))
      .innerJoin(warehouse, eq(inventoryLot.warehouseId, warehouse.id))
      .where(and(
        inArray(productVariant.id, requestedIds),
        eq(warehouse.code, 'MAIN'),
        eq(warehouse.isActive, true),
        eq(product.status, 'published'),
        eq(productVariant.salesEnabled, true),
        isNull(productVariant.archivedAt),
        isNull(inventoryLot.quarantinedAt),
        gt(inventoryLot.onHandQuantity, inventoryLot.reservedQuantity),
      ))

    return new Set(lots
      .filter(({ expiryDate, minRemainingShelfLifeDays, now }) =>
        isLotEligible(expiryDate, minRemainingShelfLifeDays, nowFromDatabase(now)))
      .map(({ variantId }) => variantId))
  }

  async getVariantSummary(variantId: string, warehouseId: string): Promise<VariantStockSummary> {
    const [warehouseRow] = await this.db.select({ id: warehouse.id, isActive: warehouse.isActive })
      .from(warehouse).where(eq(warehouse.id, warehouseId)).limit(1)
    if (!warehouseRow || !warehouseRow.isActive) throw new DomainError('WAREHOUSE_NOT_FOUND')

    const [variant] = await this.db.select({
      id: productVariant.id,
      archivedAt: productVariant.archivedAt,
      salesEnabled: productVariant.salesEnabled,
      minRemainingShelfLifeDays: productVariant.minRemainingShelfLifeDays,
      productStatus: product.status,
    }).from(productVariant).innerJoin(product, eq(productVariant.productId, product.id))
      .where(eq(productVariant.id, variantId)).limit(1)
    if (!variant) throw new DomainError('VARIANT_NOT_FOUND')

    const [{ now: rawNow }] = await this.db.select({ now: sql<Date>`transaction_timestamp()` }).from(warehouse).limit(1)
    const now = nowFromDatabase(rawNow)
    const lots = await this.db.select({
      expiryDate: inventoryLot.expiryDate,
      quarantinedAt: inventoryLot.quarantinedAt,
      onHandQuantity: inventoryLot.onHandQuantity,
      reservedQuantity: inventoryLot.reservedQuantity,
    }).from(inventoryLot).where(and(
      eq(inventoryLot.variantId, variantId),
      eq(inventoryLot.warehouseId, warehouseId),
    ))

    const onHandQuantity = lots.reduce((total, lot) => total + lot.onHandQuantity, 0)
    const reservedQuantity = lots.reduce((total, lot) => total + lot.reservedQuantity, 0)
    const eligibleLots = lots.filter((lot) => !lot.quarantinedAt
      && isLotEligible(lot.expiryDate, variant.minRemainingShelfLifeDays, now))
    const eligibleQuantity = eligibleLots.reduce((total, lot) => total + lot.onHandQuantity, 0)
    const canSell = warehouseRow.isActive && variant.productStatus === 'published'
      && variant.salesEnabled && !variant.archivedAt
    const sellableQuantity = canSell
      ? eligibleLots.reduce((total, lot) => total + Math.max(0, lot.onHandQuantity - lot.reservedQuantity), 0)
      : 0
    return { variantId, warehouseId, onHandQuantity, reservedQuantity, eligibleQuantity, sellableQuantity }
  }

  async getLot(id: string): Promise<LotDetail> {
    const [{ now: rawNow }] = await this.db.select({ now: sql<Date>`transaction_timestamp()` }).from(warehouse).limit(1)
    const [row] = await this.db.select(lotReadProjection).from(inventoryLot)
      .innerJoin(productVariant, eq(inventoryLot.variantId, productVariant.id))
      .innerJoin(product, eq(productVariant.productId, product.id))
      .innerJoin(warehouse, eq(inventoryLot.warehouseId, warehouse.id))
      .where(eq(inventoryLot.id, id)).limit(1)
    if (!row) throw new DomainError('LOT_NOT_FOUND')
    return toLotDetail(row, nowFromDatabase(rawNow))
  }

  async listLots(input: LotQuery): Promise<InventoryCursorPage<LotDetail>> {
    const query = normalizeLotQuery(input)
    const cursor = validateCursor(query.cursor, query.queryFingerprint, 'receivedAt')
    const cursorTime = cursor ? sql`${cursor.timestamp}::timestamptz` : undefined
    const cursorCondition = cursor && cursorTime ? or(
      lt(inventoryLot.receivedAt, cursorTime),
      and(eq(inventoryLot.receivedAt, cursorTime), lt(inventoryLot.id, cursor.id)),
    ) : undefined
    const rows = await this.db.select({
      ...lotReadProjection,
      cursorReceivedAt: sql<string>`to_char(${inventoryLot.receivedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    }).from(inventoryLot)
      .innerJoin(productVariant, eq(inventoryLot.variantId, productVariant.id))
      .innerJoin(product, eq(productVariant.productId, product.id))
      .innerJoin(warehouse, eq(inventoryLot.warehouseId, warehouse.id))
      .where(and(
        query.warehouseId ? eq(inventoryLot.warehouseId, query.warehouseId) : undefined,
        query.variantId ? eq(inventoryLot.variantId, query.variantId) : undefined,
        cursorCondition,
      ))
      .orderBy(desc(inventoryLot.receivedAt), desc(inventoryLot.id))
      .limit(query.limit + 1)
    const hasMore = rows.length > query.limit
    const items = rows.slice(0, query.limit)
    const [{ now: rawNow }] = await this.db.select({ now: sql<Date>`transaction_timestamp()` }).from(warehouse).limit(1)
    const now = nowFromDatabase(rawNow)
    const last = items.at(-1)
    return {
      items: items.map((row) => toLotDetail(row, now)),
      nextCursor: hasMore && last ? encodeCursor({
        receivedAt: last.cursorReceivedAt,
        id: last.id,
        fingerprint: query.queryFingerprint,
      }) : null,
    }
  }

  async listMovements(input: MovementQuery): Promise<InventoryCursorPage<MovementDetail>> {
    const query = normalizeMovementQuery(input)
    const cursor = validateCursor(query.cursor, query.queryFingerprint, 'occurredAt')
    const cursorTime = cursor ? sql`${cursor.timestamp}::timestamptz` : undefined
    const cursorCondition = cursor && cursorTime ? or(
      lt(stockMovement.occurredAt, cursorTime),
      and(eq(stockMovement.occurredAt, cursorTime), lt(stockMovement.id, cursor.id)),
    ) : undefined
    const rows = await this.db.select({
      id: stockMovement.id,
      lotId: stockMovement.lotId,
      operationId: stockMovement.operationId,
      quantityDelta: stockMovement.quantityDelta,
      balanceAfter: stockMovement.balanceAfter,
      type: stockMovement.type,
      reasonCode: stockMovement.reasonCode,
      occurredAt: stockMovement.occurredAt,
      actorId: stockMovement.actorId,
      cursorOccurredAt: sql<string>`to_char(${stockMovement.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    }).from(stockMovement).innerJoin(inventoryLot, eq(stockMovement.lotId, inventoryLot.id))
      .where(and(
        query.warehouseId ? eq(inventoryLot.warehouseId, query.warehouseId) : undefined,
        query.variantId ? eq(inventoryLot.variantId, query.variantId) : undefined,
        query.lotId ? eq(inventoryLot.id, query.lotId) : undefined,
        cursorCondition,
      ))
      .orderBy(desc(stockMovement.occurredAt), desc(stockMovement.id))
      .limit(query.limit + 1)
    const hasMore = rows.length > query.limit
    const items = rows.slice(0, query.limit)
    const last = items.at(-1)
    return {
      items: items.map((row) => ({
        id: row.id,
        lotId: row.lotId,
        operationId: row.operationId,
        quantityDelta: row.quantityDelta,
        balanceAfter: row.balanceAfter,
        type: row.type,
        reasonCode: row.reasonCode,
        occurredAt: row.occurredAt.toISOString(),
        actorId: row.actorId,
      })),
      nextCursor: hasMore && last ? encodeCursor({
        occurredAt: last.cursorOccurredAt,
        id: last.id,
        fingerprint: query.queryFingerprint,
      }) : null,
    }
  }
}
