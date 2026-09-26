import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../database/types'
import {
  auditLog,
  inventoryLot,
  inventoryReservation,
  inventoryReservationAllocation,
  product,
  productVariant,
  warehouse,
} from '../../database/schema'
import { assertAuditMetadata, type AuditEvent } from '../audit/model'
import { DomainError } from '../../shared/domain-error'
import { runInventoryCommand } from './operation'
import { isLotEligible, normalizeReserveInput } from './policy'
import type {
  CommandContext,
  InventoryActor,
  LotDetail,
  ReservationAllocation,
  ReservationDetail,
  ReserveInput,
} from './types'

const lotProjection = {
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
}

type ReservationLot = typeof inventoryLot.$inferSelect

interface LockedCatalog {
  products: Map<string, { id: string; status: string }>
  variants: Map<string, {
    id: string
    productId: string
    archivedAt: Date | null
    salesEnabled: boolean
    minRemainingShelfLifeDays: number
  }>
}

interface LotContext {
  lot: {
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
  }
  now: Date
  productStatus: string
  salesEnabled: boolean
  archivedAt: Date | null
  minRemainingShelfLifeDays: number
  warehouseActive: boolean
}

class ChangedReservationLockSet extends Error {}

function dateFromDatabase(value: Date | string) {
  return value instanceof Date ? value : new Date(value)
}

function totalQuantity(allocations: ReservationAllocation[]) {
  return allocations.reduce((total, allocation) => total + allocation.quantity, 0)
}

function asLotDetail(context: LotContext, lot = context.lot): LotDetail {
  const sellableQuantity = context.warehouseActive && context.productStatus === 'published'
    && context.salesEnabled && !context.archivedAt && !lot.quarantinedAt
    && isLotEligible(lot.expiryDate, context.minRemainingShelfLifeDays, context.now)
    ? Math.max(0, lot.onHandQuantity - lot.reservedQuantity)
    : 0
  return {
    id: lot.id,
    warehouseId: lot.warehouseId,
    variantId: lot.variantId,
    lotCode: lot.lotCode,
    receivedAt: lot.receivedAt.toISOString(),
    expiryDate: lot.expiryDate,
    quarantinedAt: lot.quarantinedAt?.toISOString() ?? null,
    quarantineReason: lot.quarantineReason,
    onHandQuantity: lot.onHandQuantity,
    reservedQuantity: lot.reservedQuantity,
    sellableQuantity,
    createdAt: lot.createdAt.toISOString(),
    updatedAt: lot.updatedAt.toISOString(),
  }
}

async function transactionNow(tx: DatabaseTransaction) {
  const [{ now }] = await tx.select({ now: sql<Date>`transaction_timestamp()` }).from(warehouse).limit(1)
  return dateFromDatabase(now)
}

async function recordAudit(tx: DatabaseTransaction, event: AuditEvent) {
  assertAuditMetadata(event)
  await tx.insert(auditLog).values({
    id: event.id,
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

function auditEvent(
  actor: InventoryActor,
  action: AuditEvent['action'],
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown>,
): AuditEvent {
  return {
    id: crypto.randomUUID(),
    actorUserId: actor.userId,
    action,
    targetType,
    targetId,
    ...actor.auditContext,
    metadata,
  }
}

async function lockCatalogRows(tx: DatabaseTransaction, variantIds: string[]): Promise<LockedCatalog> {
  const uniqueVariantIds = [...new Set(variantIds)].sort()
  const identities = await tx.select({ id: productVariant.id, productId: productVariant.productId })
    .from(productVariant).where(inArray(productVariant.id, uniqueVariantIds))
  if (identities.length !== uniqueVariantIds.length) throw new DomainError('VARIANT_NOT_FOUND')

  const productIds = [...new Set(identities.map(({ productId }) => productId))].sort()
  const products = await tx.select({ id: product.id, status: product.status }).from(product)
    .where(inArray(product.id, productIds)).orderBy(asc(product.id)).for('update')
  if (products.length !== productIds.length) throw new DomainError('PRODUCT_NOT_FOUND')

  const variants = await tx.select({
    id: productVariant.id,
    productId: productVariant.productId,
    archivedAt: productVariant.archivedAt,
    salesEnabled: productVariant.salesEnabled,
    minRemainingShelfLifeDays: productVariant.minRemainingShelfLifeDays,
  }).from(productVariant).where(inArray(productVariant.id, uniqueVariantIds))
    .orderBy(asc(productVariant.id)).for('update')
  if (variants.length !== uniqueVariantIds.length) throw new DomainError('VARIANT_NOT_FOUND')
  if (variants.some((variant) => !productIds.includes(variant.productId))) throw new ChangedReservationLockSet()

  return {
    products: new Map(products.map((row) => [row.id, row])),
    variants: new Map(variants.map((row) => [row.id, row])),
  }
}

async function activeReservationsForVariants(
  tx: DatabaseTransaction,
  variantIds: string[],
  now: Date,
) {
  if (variantIds.length === 0) return []
  const rows = await tx.selectDistinct({ id: inventoryReservation.id })
    .from(inventoryReservationAllocation)
    .innerJoin(inventoryReservation, eq(inventoryReservationAllocation.reservationId, inventoryReservation.id))
    .where(and(
      inArray(inventoryReservationAllocation.variantId, variantIds),
      eq(inventoryReservation.status, 'active'),
      lte(inventoryReservation.expiresAt, now),
    )).orderBy(asc(inventoryReservation.id))
  return rows.map(({ id }) => id)
}

async function expireReservations(
  tx: DatabaseTransaction,
  reservationIds: string[],
  allocationRows: Array<{ reservationId: string; variantId: string; lotId: string; quantity: number }>,
  lots: Map<string, ReservationLot>,
  actor: InventoryActor,
  now: Date,
) {
  if (reservationIds.length === 0) return
  const activeIds = new Set(reservationIds)
  for (const allocation of allocationRows) {
    if (!activeIds.has(allocation.reservationId)) continue
    const lot = lots.get(allocation.lotId)
    if (!lot || lot.reservedQuantity < allocation.quantity) throw new DomainError('INVENTORY_STOCK_CONFLICT')
    lot.reservedQuantity -= allocation.quantity
    await tx.update(inventoryLot).set({ reservedQuantity: lot.reservedQuantity }).where(eq(inventoryLot.id, lot.id))
  }

  await tx.update(inventoryReservation).set({ status: 'expired', completedAt: now })
    .where(and(inArray(inventoryReservation.id, reservationIds), eq(inventoryReservation.status, 'active')))
  for (const reservationId of reservationIds) {
    const [reservation] = await tx.select({ warehouseId: inventoryReservation.warehouseId })
      .from(inventoryReservation).where(eq(inventoryReservation.id, reservationId)).limit(1)
    if (!reservation) continue
    await recordAudit(tx, auditEvent(actor, 'inventory.reservation-expired', 'inventory_reservation', reservationId, {
      warehouseId: reservation.warehouseId,
      reservationId,
      reasonCode: 'ttl',
    }))
  }
}

type ReservationConflict = {
  code: 'INVENTORY_STOCK_CONFLICT'
  message: string
}

async function reserveInTransactionResult(
  tx: DatabaseTransaction,
  input: ReserveInput,
  actor: InventoryActor,
  operationId: string,
): Promise<ReservationDetail | null> {
  const normalized = normalizeReserveInput(input)
  const now = await transactionNow(tx)
  const [warehouseRow] = await tx.select({
    id: warehouse.id,
    code: warehouse.code,
    isActive: warehouse.isActive,
  }).from(warehouse).where(eq(warehouse.id, normalized.warehouseId)).limit(1)
  if (!warehouseRow || !warehouseRow.isActive || warehouseRow.code !== 'MAIN') {
    throw new DomainError('WAREHOUSE_NOT_FOUND')
  }

  const requestedVariantIds = normalized.lines.map(({ variantId }) => variantId)
  const expiredIds = await activeReservationsForVariants(tx, requestedVariantIds, now)
  const expiredAllocations = expiredIds.length > 0
    ? await tx.select({
      reservationId: inventoryReservationAllocation.reservationId,
      variantId: inventoryReservationAllocation.variantId,
      lotId: inventoryReservationAllocation.lotId,
      quantity: inventoryReservationAllocation.quantity,
    }).from(inventoryReservationAllocation)
      .where(inArray(inventoryReservationAllocation.reservationId, expiredIds))
    : []
  const lockVariantIds = [...new Set([
    ...requestedVariantIds,
    ...expiredAllocations.map(({ variantId }) => variantId),
  ])].sort()
  const lockedCatalog = await lockCatalogRows(tx, lockVariantIds)
  const expiredParentRows = expiredIds.length > 0
    ? await tx.select({ id: inventoryReservation.id }).from(inventoryReservation)
      .where(and(inArray(inventoryReservation.id, expiredIds), eq(inventoryReservation.status, 'active'), lte(inventoryReservation.expiresAt, now)))
      .orderBy(asc(inventoryReservation.id)).for('update')
    : []
  const activeExpiredIds = expiredParentRows.map(({ id }) => id)
  const currentExpiredAllocations = activeExpiredIds.length > 0
    ? await tx.select({
      reservationId: inventoryReservationAllocation.reservationId,
      variantId: inventoryReservationAllocation.variantId,
      lotId: inventoryReservationAllocation.lotId,
      quantity: inventoryReservationAllocation.quantity,
    }).from(inventoryReservationAllocation)
      .where(inArray(inventoryReservationAllocation.reservationId, activeExpiredIds))
    : []
  if (currentExpiredAllocations.some(({ variantId }) => !lockVariantIds.includes(variantId))) {
    throw new ChangedReservationLockSet()
  }

  const expiredLotIds = [...new Set(currentExpiredAllocations.map(({ lotId }) => lotId))]
  const lotFilter = expiredLotIds.length > 0
    ? or(
      and(eq(inventoryLot.warehouseId, normalized.warehouseId), inArray(inventoryLot.variantId, requestedVariantIds)),
      inArray(inventoryLot.id, expiredLotIds),
    )
    : and(eq(inventoryLot.warehouseId, normalized.warehouseId), inArray(inventoryLot.variantId, requestedVariantIds))
  const lockedLots = await tx.select(lotProjection).from(inventoryLot)
    .where(lotFilter).orderBy(asc(inventoryLot.id)).for('update')
  const lots = new Map(lockedLots.map((lot) => [lot.id, lot]))
  await expireReservations(tx, activeExpiredIds, currentExpiredAllocations, lots, actor, now)

  const planned: ReservationAllocation[] = []
  for (const line of normalized.lines) {
    const variant = lockedCatalog.variants.get(line.variantId)
    const catalogProduct = variant ? lockedCatalog.products.get(variant.productId) : undefined
    if (!variant || !catalogProduct) throw new DomainError('VARIANT_NOT_FOUND')
    if (catalogProduct.status !== 'published' || variant.archivedAt || !variant.salesEnabled) {
      throw new DomainError('PRODUCT_STATE_CONFLICT')
    }

    const candidates = lockedLots.filter((lot) => lot.warehouseId === normalized.warehouseId
      && lot.variantId === line.variantId && !lot.quarantinedAt
      && isLotEligible(lot.expiryDate, variant.minRemainingShelfLifeDays, now))
      .sort((left, right) => left.receivedAt.getTime() - right.receivedAt.getTime()
        || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    let remaining = line.quantity
    for (const lot of candidates) {
      const available = lot.onHandQuantity - lot.reservedQuantity
      if (available <= 0) continue
      const quantity = Math.min(available, remaining)
      planned.push({ variantId: line.variantId, lotId: lot.id, quantity })
      remaining -= quantity
      if (remaining === 0) break
    }
    if (remaining > 0) return null
  }

  const reservationId = crypto.randomUUID()
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000)
  const [reservation] = await tx.insert(inventoryReservation).values({
    id: reservationId,
    warehouseId: warehouseRow.id,
    externalReference: normalized.externalReference ?? null,
    status: 'active',
    createdAt: now,
    expiresAt,
    actorId: actor.userId ?? 'system',
  }).returning()
  if (!reservation) throw new DomainError('INVENTORY_STOCK_CONFLICT')

  if (planned.length > 0) {
    await tx.insert(inventoryReservationAllocation).values(planned.map((allocation) => ({
      id: crypto.randomUUID(),
      reservationId,
      ...allocation,
    })))
  }
  for (const allocation of planned) {
    const lot = lots.get(allocation.lotId)
    if (!lot) throw new DomainError('INVENTORY_STOCK_CONFLICT')
    lot.reservedQuantity += allocation.quantity
    const [held] = await tx.update(inventoryLot).set({ reservedQuantity: lot.reservedQuantity })
      .where(and(eq(inventoryLot.id, lot.id), lte(inventoryLot.reservedQuantity, lot.onHandQuantity - allocation.quantity)))
      .returning({ id: inventoryLot.id })
    if (!held) throw new DomainError('INVENTORY_STOCK_CONFLICT')
  }

  const allocations = planned.map(({ variantId, lotId, quantity }) => ({ variantId, lotId, quantity }))
  await recordAudit(tx, auditEvent(actor, 'inventory.reserved', 'inventory_reservation', reservationId, {
    warehouseId: warehouseRow.id,
    reservationId,
    operationId,
    allocationCount: allocations.length,
    quantity: totalQuantity(allocations),
  }))

  return {
    id: reservation.id,
    warehouseId: reservation.warehouseId,
    externalReference: reservation.externalReference,
    status: reservation.status,
    createdAt: reservation.createdAt.toISOString(),
    expiresAt: reservation.expiresAt.toISOString(),
    completedAt: reservation.completedAt?.toISOString() ?? null,
    actorId: reservation.actorId,
    allocations,
  }
}

export async function reserveInTransaction(
  tx: DatabaseTransaction,
  input: ReserveInput,
  actor: InventoryActor,
  operationId: string,
): Promise<ReservationDetail> {
  const reservation = await reserveInTransactionResult(tx, input, actor, operationId)
  if (!reservation) throw new DomainError('INVENTORY_STOCK_CONFLICT')
  return reservation
}

export class InventoryReservationRepository {
  constructor(private readonly db: Database) {}

  async reserve(input: ReserveInput, context: CommandContext): Promise<ReservationDetail> {
    const normalized = normalizeReserveInput(input)
    const result = await runInventoryCommand<ReservationDetail | ReservationConflict>(
      this.db,
      'inventory.reserve',
      context.idempotencyKey,
      normalized,
      context.actor,
      async (tx, operationId) => {
        const reservation = await reserveInTransactionResult(tx, normalized, context.actor, operationId)
        return reservation
          ? { status: 201, body: reservation }
          : {
            status: 409,
            body: { code: 'INVENTORY_STOCK_CONFLICT', message: 'Inventory stock does not allow this action' },
          }
      },
    )
    if (result.status === 409) throw new DomainError('INVENTORY_STOCK_CONFLICT')
    return result.body as ReservationDetail
  }

  async quarantineLot(lotId: string, reason: string, context: CommandContext): Promise<LotDetail> {
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 200) {
      throw new DomainError('INVALID_INVENTORY_COMMAND')
    }
    const normalizedReason = reason.trim()

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const result = await runInventoryCommand(
          this.db,
          'inventory.quarantine-lot',
          context.idempotencyKey,
          { lotId, reason: normalizedReason },
          context.actor,
          async (tx) => {
            const now = await transactionNow(tx)
            await this.cancelReservationsForLot(tx, lotId, context.actor, now)
            const locked = await this.readLotContext(tx, lotId, now)
            if (locked.lot.quarantinedAt) throw new DomainError('INVENTORY_STOCK_CONFLICT')
            const [updated] = await tx.update(inventoryLot).set({
              quarantinedAt: now,
              quarantineReason: normalizedReason,
            }).where(eq(inventoryLot.id, lotId)).returning(lotProjection)
            if (!updated) throw new DomainError('LOT_NOT_FOUND')
            await recordAudit(tx, auditEvent(context.actor, 'inventory.quarantined', 'inventory_lot', lotId, {
              variantId: updated.variantId,
              warehouseId: updated.warehouseId,
              reasonCode: 'staff_review',
            }))
            return { status: 200, body: asLotDetail(locked, updated) }
          },
        )
        return result.body
      } catch (error) {
        if (error instanceof ChangedReservationLockSet) continue
        throw error
      }
    }
    throw new DomainError('INVENTORY_STOCK_CONFLICT')
  }

  async releaseQuarantine(lotId: string, context: CommandContext): Promise<LotDetail> {
    const result = await runInventoryCommand(
      this.db,
      'inventory.release-quarantine',
      context.idempotencyKey,
      { lotId },
      context.actor,
      async (tx) => {
        const now = await transactionNow(tx)
        const locked = await this.lockLotContext(tx, lotId, now)
        if (!locked.lot.quarantinedAt) throw new DomainError('INVENTORY_STOCK_CONFLICT')
        if (!isLotEligible(locked.lot.expiryDate, 0, now)) throw new DomainError('INVENTORY_STOCK_CONFLICT')
        if (locked.lot.reservedQuantity !== 0) throw new DomainError('INVENTORY_STOCK_CONFLICT')
        const [updated] = await tx.update(inventoryLot).set({
          quarantinedAt: null,
          quarantineReason: null,
        }).where(eq(inventoryLot.id, lotId)).returning(lotProjection)
        if (!updated) throw new DomainError('LOT_NOT_FOUND')
        await recordAudit(tx, auditEvent(context.actor, 'inventory.quarantine-released', 'inventory_lot', lotId, {
          variantId: updated.variantId,
          warehouseId: updated.warehouseId,
        }))
        return { status: 200, body: asLotDetail(locked, updated) }
      },
    )
    return result.body
  }

  async cancelReservationsForLot(
    tx: DatabaseTransaction,
    lotId: string,
    actor: InventoryActor,
    now?: Date,
  ): Promise<void> {
    const commandTime = now ?? await transactionNow(tx)
    const [identity] = await tx.select({
      variantId: inventoryLot.variantId,
      productId: productVariant.productId,
    }).from(inventoryLot).innerJoin(productVariant, eq(inventoryLot.variantId, productVariant.id))
      .where(eq(inventoryLot.id, lotId)).limit(1)
    if (!identity) throw new DomainError('LOT_NOT_FOUND')

    const initialReservationIds = await this.findActiveReservationIdsForLot(tx, lotId)
    const initialAllocations = initialReservationIds.length > 0
      ? await tx.select({ variantId: inventoryReservationAllocation.variantId })
        .from(inventoryReservationAllocation)
        .where(inArray(inventoryReservationAllocation.reservationId, initialReservationIds))
      : []
    const lockVariantIds = [...new Set([
      identity.variantId,
      ...initialAllocations.map(({ variantId }) => variantId),
    ])].sort()
    const lockedCatalog = await lockCatalogRows(tx, lockVariantIds)
    if (!lockedCatalog.products.has(identity.productId)) throw new ChangedReservationLockSet()

    const activeReservationIds = await this.findActiveReservationIdsForLot(tx, lotId)
    const currentAllocations = activeReservationIds.length > 0
      ? await tx.select({
        reservationId: inventoryReservationAllocation.reservationId,
        variantId: inventoryReservationAllocation.variantId,
        lotId: inventoryReservationAllocation.lotId,
        quantity: inventoryReservationAllocation.quantity,
      }).from(inventoryReservationAllocation)
        .where(inArray(inventoryReservationAllocation.reservationId, activeReservationIds))
      : []
    if (currentAllocations.some(({ variantId }) => !lockVariantIds.includes(variantId))) {
      throw new ChangedReservationLockSet()
    }

    const reservationRows = activeReservationIds.length > 0
      ? await tx.select({
        id: inventoryReservation.id,
        warehouseId: inventoryReservation.warehouseId,
        status: inventoryReservation.status,
      }).from(inventoryReservation).where(inArray(inventoryReservation.id, activeReservationIds))
        .orderBy(asc(inventoryReservation.id)).for('update')
      : []
    const activeIds = reservationRows.filter(({ status }) => status === 'active').map(({ id }) => id)
    if (activeIds.length === 0) {
      const target = await tx.select({ id: inventoryLot.id }).from(inventoryLot)
        .where(eq(inventoryLot.id, lotId)).for('update').limit(1)
      if (!target[0]) throw new DomainError('LOT_NOT_FOUND')
      return
    }

    const allocations = await tx.select({
      reservationId: inventoryReservationAllocation.reservationId,
      variantId: inventoryReservationAllocation.variantId,
      lotId: inventoryReservationAllocation.lotId,
      quantity: inventoryReservationAllocation.quantity,
    }).from(inventoryReservationAllocation)
      .where(inArray(inventoryReservationAllocation.reservationId, activeIds))
    if (allocations.some(({ variantId }) => !lockVariantIds.includes(variantId))) {
      throw new ChangedReservationLockSet()
    }
    const lotIds = [...new Set([lotId, ...allocations.map(({ lotId: allocationLotId }) => allocationLotId)])].sort()
    const lockedLots = await tx.select(lotProjection).from(inventoryLot)
      .where(inArray(inventoryLot.id, lotIds)).orderBy(asc(inventoryLot.id)).for('update')
    const lots = new Map(lockedLots.map((lot) => [lot.id, lot]))
    if (!lots.has(lotId)) throw new DomainError('LOT_NOT_FOUND')

    const reservationWarehouses = new Map(reservationRows.map(({ id, warehouseId }) => [id, warehouseId]))
    for (const allocation of allocations) {
      const lot = lots.get(allocation.lotId)
      if (!lot || lot.reservedQuantity < allocation.quantity) throw new DomainError('INVENTORY_STOCK_CONFLICT')
      lot.reservedQuantity -= allocation.quantity
      await tx.update(inventoryLot).set({ reservedQuantity: lot.reservedQuantity })
        .where(eq(inventoryLot.id, lot.id))
    }
    await tx.update(inventoryReservation).set({ status: 'cancelled', completedAt: commandTime })
      .where(and(inArray(inventoryReservation.id, activeIds), eq(inventoryReservation.status, 'active')))
    for (const reservationId of activeIds) {
      await recordAudit(tx, auditEvent(actor, 'inventory.reservation-cancelled', 'inventory_reservation', reservationId, {
        warehouseId: reservationWarehouses.get(reservationId),
        reservationId,
        lotId,
        reasonCode: 'quarantine',
      }))
    }
  }

  private async findActiveReservationIdsForLot(tx: DatabaseTransaction, lotId: string) {
    const rows = await tx.selectDistinct({ id: inventoryReservation.id })
      .from(inventoryReservationAllocation)
      .innerJoin(inventoryReservation, eq(inventoryReservationAllocation.reservationId, inventoryReservation.id))
      .where(and(
        eq(inventoryReservationAllocation.lotId, lotId),
        eq(inventoryReservation.status, 'active'),
      )).orderBy(asc(inventoryReservation.id))
    return rows.map(({ id }) => id)
  }

  private async readLotContext(tx: DatabaseTransaction, lotId: string, now: Date): Promise<LotContext> {
    const [row] = await tx.select({
      lot: lotProjection,
      productStatus: product.status,
      salesEnabled: productVariant.salesEnabled,
      archivedAt: productVariant.archivedAt,
      minRemainingShelfLifeDays: productVariant.minRemainingShelfLifeDays,
      warehouseActive: warehouse.isActive,
    }).from(inventoryLot)
      .innerJoin(productVariant, eq(inventoryLot.variantId, productVariant.id))
      .innerJoin(product, eq(productVariant.productId, product.id))
      .innerJoin(warehouse, eq(inventoryLot.warehouseId, warehouse.id))
      .where(eq(inventoryLot.id, lotId)).limit(1)
    if (!row) throw new DomainError('LOT_NOT_FOUND')
    return {
      lot: row.lot as unknown as LotContext['lot'],
      now,
      productStatus: row.productStatus,
      salesEnabled: row.salesEnabled,
      archivedAt: row.archivedAt,
      minRemainingShelfLifeDays: row.minRemainingShelfLifeDays,
      warehouseActive: row.warehouseActive,
    }
  }

  private async lockLotContext(tx: DatabaseTransaction, lotId: string, now: Date): Promise<LotContext> {
    const [identity] = await tx.select({
      variantId: inventoryLot.variantId,
      productId: productVariant.productId,
    }).from(inventoryLot).innerJoin(productVariant, eq(inventoryLot.variantId, productVariant.id))
      .where(eq(inventoryLot.id, lotId)).limit(1)
    if (!identity) throw new DomainError('LOT_NOT_FOUND')
    const [catalogProduct] = await tx.select({ id: product.id })
      .from(product).where(eq(product.id, identity.productId)).for('update').limit(1)
    if (!catalogProduct) throw new DomainError('LOT_NOT_FOUND')
    const [variant] = await tx.select({ id: productVariant.id, productId: productVariant.productId })
      .from(productVariant).where(eq(productVariant.id, identity.variantId)).for('update').limit(1)
    if (!variant || variant.productId !== catalogProduct.id) throw new DomainError('LOT_NOT_FOUND')
    const [lot] = await tx.select({ id: inventoryLot.id }).from(inventoryLot)
      .where(and(eq(inventoryLot.id, lotId), eq(inventoryLot.variantId, variant.id))).for('update').limit(1)
    if (!lot) throw new DomainError('LOT_NOT_FOUND')
    return this.readLotContext(tx, lotId, now)
  }
}
