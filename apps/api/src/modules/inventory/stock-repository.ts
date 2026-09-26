import { and, eq, sql } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../database/types'
import { inventoryLot, product, productVariant, stockMovement, warehouse } from '../../database/schema'
import { AuditRepository } from '../audit/repository'
import { AuditService } from '../audit/service'
import type { AuditEvent } from '../audit/model'
import { DomainError } from '../../shared/domain-error'
import { isLotEligible, normalizeReceiveLot, type NormalizedReceiveLotInput } from './policy'
import { runInventoryCommand } from './operation'
import type {
  CommandContext,
  CountAdjustmentInput,
  InventoryActor,
  LotDetail,
  ReceiveLotInput,
  WriteOffInput,
} from './types'
import { inventoryActorId } from './types'

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
  reversibleQuantity: inventoryLot.reversibleQuantity,
  createdAt: inventoryLot.createdAt,
  updatedAt: inventoryLot.updatedAt,
}

interface ReceiptLotRow {
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
  reversibleQuantity: number
  createdAt: Date
  updatedAt: Date
}

interface LockedLot {
  lot: ReceiptLotRow
  now: Date
  productStatus: string
  salesEnabled: boolean
  archivedAt: Date | null
  minRemainingShelfLifeDays: number
  warehouseActive: boolean
}

function toISOString(value: Date | null): string | null {
  return value?.toISOString() ?? null
}

function databaseDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value)
}

function asLotDetail(
  row: ReceiptLotRow,
  now: Date,
  productStatus: string,
  salesEnabled: boolean,
  archivedAt: Date | null,
  minDays: number,
  warehouseActive: boolean,
): LotDetail {
  const sellableQuantity = warehouseActive && productStatus === 'published' && salesEnabled && !archivedAt
    && !row.quarantinedAt && isLotEligible(row.expiryDate, minDays, now)
    ? Math.max(0, row.onHandQuantity - row.reservedQuantity)
    : 0
  return {
    id: row.id,
    warehouseId: row.warehouseId,
    variantId: row.variantId,
    lotCode: row.lotCode,
    receivedAt: row.receivedAt.toISOString(),
    expiryDate: row.expiryDate,
    quarantinedAt: toISOString(row.quarantinedAt),
    quarantineReason: row.quarantineReason,
    onHandQuantity: row.onHandQuantity,
    reservedQuantity: row.reservedQuantity,
    sellableQuantity,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function mapUniqueViolation(error: unknown): unknown {
  let current = error
  while (current && typeof current === 'object') {
    const record = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown; message?: unknown; cause?: unknown }
    const constraint = String(record.constraint ?? record.constraint_name ?? record.message ?? '')
    if (record.code === '23505' && constraint.includes('inventory_lot_normalized_code_unique')) {
      return new DomainError('LOT_CODE_CONFLICT')
    }
    current = record.cause
  }
  return error
}

async function recordReceiptAudit(
  audit: AuditService,
  tx: DatabaseTransaction,
  actor: InventoryActor,
  lotId: string,
  variantId: string,
  warehouseId: string,
  quantity: number,
) {
  const event: AuditEvent = {
    id: crypto.randomUUID(),
    actorUserId: actor.userId,
    action: 'inventory.received',
    targetType: 'inventory_lot',
    targetId: lotId,
    ...actor.auditContext,
    metadata: { variantId, warehouseId, quantity },
  }
  await audit.record(tx, event)
}

function normalizeWriteOff(input: WriteOffInput) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DomainError('INVALID_INVENTORY_COMMAND')
  }
  const allowedKeys = ['quantity', 'reason', 'note']
  if (Object.keys(input).some((key) => !allowedKeys.includes(key))
    || !Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 1_000_000_000
    || !['spoiled', 'expired', 'damaged'].includes(input.reason)) {
    throw new DomainError('INVALID_INVENTORY_COMMAND')
  }

  let note: string | undefined
  if (input.note !== undefined) {
    if (typeof input.note !== 'string') throw new DomainError('INVALID_INVENTORY_COMMAND')
    note = input.note.trim()
    if (!note || note.length > 200) throw new DomainError('INVALID_INVENTORY_COMMAND')
  }

  return {
    quantity: input.quantity,
    reason: input.reason,
    ...(note ? { note } : {}),
  }
}

function normalizeCountAdjustment(input: CountAdjustmentInput) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DomainError('INVALID_INVENTORY_COMMAND')
  }
  const allowedKeys = ['countedQuantity', 'reason']
  if (Object.keys(input).some((key) => !allowedKeys.includes(key))
    || !Number.isInteger(input.countedQuantity) || input.countedQuantity < 0 || input.countedQuantity > 1_000_000_000
    || typeof input.reason !== 'string' || !/^[a-z][a-z0-9._-]{0,99}$/.test(input.reason)) {
    throw new DomainError('INVALID_INVENTORY_COMMAND')
  }

  return { countedQuantity: input.countedQuantity, reason: input.reason }
}

export class InventoryStockRepository {
  private readonly audit: AuditService

  constructor(private readonly db: Database, audit?: AuditService) {
    this.audit = audit ?? new AuditService(new AuditRepository(db))
  }

  async receiveLot(input: ReceiveLotInput, context: CommandContext): Promise<LotDetail> {
    const normalized = normalizeReceiveLot(input)
    try {
      const result = await runInventoryCommand(this.db, 'inventory.receive-lot', context.idempotencyKey, normalized, context.actor,
        async (tx, operationId) => this.createReceipt(tx, operationId, normalized, context.actor))
      return result.body
    } catch (error) {
      throw mapUniqueViolation(error)
    }
  }

  async writeOff(lotId: string, input: WriteOffInput, context: CommandContext): Promise<LotDetail> {
    const normalized = normalizeWriteOff(input)
    const result = await runInventoryCommand(
      this.db,
      'inventory.write-off',
      context.idempotencyKey,
      { lotId, ...normalized },
      context.actor,
      async (tx, operationId) => {
        const locked = await this.lockLotForAdjustment(tx, lotId)
        if (normalized.reason === 'expired' && isLotEligible(locked.lot.expiryDate, 0, locked.now)) {
          throw new DomainError('INVALID_INVENTORY_COMMAND')
        }
        if (normalized.quantity > locked.lot.onHandQuantity - locked.lot.reservedQuantity) {
          throw new DomainError('INVENTORY_STOCK_CONFLICT')
        }

        const quantityDelta = -normalized.quantity
        const [updated] = await tx.update(inventoryLot).set({
          onHandQuantity: locked.lot.onHandQuantity + quantityDelta,
        }).where(and(
          eq(inventoryLot.id, locked.lot.id),
          sql`${inventoryLot.onHandQuantity} - ${inventoryLot.reservedQuantity} >= ${normalized.quantity}`,
        )).returning(lotProjection)
        if (!updated) throw new DomainError('INVENTORY_STOCK_CONFLICT')

        await tx.insert(stockMovement).values({
          id: crypto.randomUUID(),
          lotId: locked.lot.id,
          operationId,
          quantityDelta,
          balanceAfter: updated.onHandQuantity,
          type: 'write_off',
          reasonCode: normalized.reason,
          actorId: inventoryActorId(context.actor),
        })
        await this.recordAdjustmentAudit(
          this.audit,
          tx,
          context.actor,
          'inventory.written-off',
          locked,
          quantityDelta,
          normalized.reason,
        )

        return {
          status: 200,
          body: asLotDetail(
            updated,
            locked.now,
            locked.productStatus,
            locked.salesEnabled,
            locked.archivedAt,
            locked.minRemainingShelfLifeDays,
            locked.warehouseActive,
          ),
        }
      },
    )
    return result.body
  }

  async adjustCount(lotId: string, input: CountAdjustmentInput, context: CommandContext): Promise<LotDetail> {
    const normalized = normalizeCountAdjustment(input)
    const result = await runInventoryCommand(
      this.db,
      'inventory.adjust-count',
      context.idempotencyKey,
      { lotId, ...normalized },
      context.actor,
      async (tx, operationId) => {
        const locked = await this.lockLotForAdjustment(tx, lotId)
        if (normalized.countedQuantity < locked.lot.reservedQuantity) {
          throw new DomainError('INVENTORY_STOCK_CONFLICT')
        }
        if (normalized.countedQuantity + locked.lot.reversibleQuantity > 1_000_000_000) {
          throw new DomainError('INVENTORY_STOCK_CONFLICT')
        }

        const quantityDelta = normalized.countedQuantity - locked.lot.onHandQuantity
        const [updated] = await tx.update(inventoryLot).set({
          onHandQuantity: normalized.countedQuantity,
        }).where(and(
          eq(inventoryLot.id, locked.lot.id),
          sql`${inventoryLot.reservedQuantity} <= ${normalized.countedQuantity}`,
          sql`${inventoryLot.reversibleQuantity} + ${normalized.countedQuantity} <= 1000000000`,
        )).returning(lotProjection)
        if (!updated) throw new DomainError('INVENTORY_STOCK_CONFLICT')

        if (quantityDelta !== 0) {
          await tx.insert(stockMovement).values({
            id: crypto.randomUUID(),
            lotId: locked.lot.id,
            operationId,
            quantityDelta,
            balanceAfter: updated.onHandQuantity,
            type: 'count_adjustment',
            reasonCode: normalized.reason,
            actorId: inventoryActorId(context.actor),
          })
        }
        await this.recordAdjustmentAudit(
          this.audit,
          tx,
          context.actor,
          'inventory.count-adjusted',
          locked,
          quantityDelta,
          normalized.reason,
        )

        return {
          status: 200,
          body: asLotDetail(
            updated,
            locked.now,
            locked.productStatus,
            locked.salesEnabled,
            locked.archivedAt,
            locked.minRemainingShelfLifeDays,
            locked.warehouseActive,
          ),
        }
      },
    )
    return result.body
  }

  private async lockLotForAdjustment(tx: DatabaseTransaction, lotId: string): Promise<LockedLot> {
    const [{ now: rawNow }] = await tx.select({ now: sql<Date>`transaction_timestamp()` }).from(warehouse).limit(1)
    const now = databaseDate(rawNow)
    const [identity] = await tx.select({
      variantId: inventoryLot.variantId,
      productId: productVariant.productId,
    }).from(inventoryLot).innerJoin(productVariant, eq(productVariant.id, inventoryLot.variantId))
      .where(eq(inventoryLot.id, lotId)).limit(1)
    if (!identity) throw new DomainError('LOT_NOT_FOUND')

    const [catalogProduct] = await tx.select({ id: product.id, status: product.status })
      .from(product).where(eq(product.id, identity.productId)).for('update').limit(1)
    if (!catalogProduct) throw new DomainError('LOT_NOT_FOUND')
    const [variant] = await tx.select({
      id: productVariant.id,
      productId: productVariant.productId,
      archivedAt: productVariant.archivedAt,
      salesEnabled: productVariant.salesEnabled,
      minRemainingShelfLifeDays: productVariant.minRemainingShelfLifeDays,
    }).from(productVariant).where(eq(productVariant.id, identity.variantId)).for('update').limit(1)
    if (!variant || variant.productId !== catalogProduct.id) throw new DomainError('LOT_NOT_FOUND')
    const [lot] = await tx.select(lotProjection).from(inventoryLot)
      .where(and(eq(inventoryLot.id, lotId), eq(inventoryLot.variantId, variant.id)))
      .for('update').limit(1)
    if (!lot) throw new DomainError('LOT_NOT_FOUND')
    const [lotWarehouse] = await tx.select({ isActive: warehouse.isActive })
      .from(warehouse).where(eq(warehouse.id, lot.warehouseId)).limit(1)
    if (!lotWarehouse) throw new DomainError('LOT_NOT_FOUND')

    return {
      lot,
      now,
      productStatus: catalogProduct.status,
      salesEnabled: variant.salesEnabled,
      archivedAt: variant.archivedAt,
      minRemainingShelfLifeDays: variant.minRemainingShelfLifeDays,
      warehouseActive: lotWarehouse.isActive,
    }
  }

  private recordAdjustmentAudit(
    audit: AuditService,
    tx: DatabaseTransaction,
    actor: InventoryActor,
    action: 'inventory.written-off' | 'inventory.count-adjusted',
    locked: LockedLot,
    quantityDelta: number,
    reasonCode: string,
  ) {
    const event: AuditEvent = {
      id: crypto.randomUUID(),
      actorUserId: actor.userId,
      action,
      targetType: 'inventory_lot',
      targetId: locked.lot.id,
      ...actor.auditContext,
      metadata: {
        variantId: locked.lot.variantId,
        warehouseId: locked.lot.warehouseId,
        quantityDelta,
        reasonCode,
      },
    }
    return audit.record(tx, event)
  }

  private async createReceipt(
    tx: DatabaseTransaction,
    operationId: string,
    input: NormalizedReceiveLotInput,
    actor: InventoryActor,
  ) {
    const [{ now: rawNow }] = await tx.select({ now: sql<Date>`transaction_timestamp()` }).from(warehouse).limit(1)
    const now = databaseDate(rawNow)
    const [warehouseRow] = await tx.select({
      id: warehouse.id,
      code: warehouse.code,
      isActive: warehouse.isActive,
    }).from(warehouse).where(eq(warehouse.id, input.warehouseId)).limit(1)
    if (!warehouseRow || !warehouseRow.isActive || warehouseRow.code !== 'MAIN') {
      throw new DomainError('WAREHOUSE_NOT_FOUND')
    }

    const [catalogProduct] = await tx.select({ id: product.id, status: product.status })
      .from(product).innerJoin(productVariant, eq(productVariant.productId, product.id))
      .where(eq(productVariant.id, input.variantId)).for('update', { of: product }).limit(1)
    if (!catalogProduct) throw new DomainError('VARIANT_NOT_FOUND')
    const [variant] = await tx.select({
      id: productVariant.id,
      archivedAt: productVariant.archivedAt,
      salesEnabled: productVariant.salesEnabled,
      minRemainingShelfLifeDays: productVariant.minRemainingShelfLifeDays,
    }).from(productVariant).where(eq(productVariant.id, input.variantId)).for('update').limit(1)
    if (!variant) throw new DomainError('VARIANT_NOT_FOUND')
    if (catalogProduct.status === 'archived' || variant.archivedAt) throw new DomainError('PRODUCT_STATE_CONFLICT')

    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : now
    if (!Number.isFinite(receivedAt.getTime()) || receivedAt.getTime() > now.getTime()) {
      throw new DomainError('INVALID_RECEIPT')
    }
    const quarantined = input.quarantined ?? false
    if (!isLotEligible(input.expiryDate, 0, now) && !quarantined) throw new DomainError('INVALID_RECEIPT')

    const lotId = crypto.randomUUID()
    const [created] = await tx.insert(inventoryLot).values({
      id: lotId,
      warehouseId: warehouseRow.id,
      variantId: variant.id,
      lotCode: input.lotCode,
      receivedAt,
      expiryDate: input.expiryDate,
      quarantinedAt: quarantined ? now : null,
      quarantineReason: quarantined ? input.quarantineReason ?? null : null,
      onHandQuantity: input.quantity,
      reservedQuantity: 0,
    }).returning(lotProjection)

    await tx.insert(stockMovement).values({
      id: crypto.randomUUID(),
      lotId,
      operationId,
      quantityDelta: input.quantity,
      balanceAfter: input.quantity,
      type: 'receipt',
      reasonCode: 'receipt',
      actorId: inventoryActorId(actor),
    })
    await recordReceiptAudit(this.audit, tx, actor, lotId, variant.id, warehouseRow.id, input.quantity)

    return {
      status: 201,
      body: asLotDetail(
        created,
        now,
        catalogProduct.status,
        variant.salesEnabled,
        variant.archivedAt,
        variant.minRemainingShelfLifeDays,
        warehouseRow.isActive,
      ),
    }
  }
}
