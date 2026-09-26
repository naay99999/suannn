import { eq, sql } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../database/types'
import { inventoryLot, product, productVariant, stockMovement, warehouse } from '../../database/schema'
import { AuditRepository } from '../audit/repository'
import { AuditService } from '../audit/service'
import type { AuditEvent } from '../audit/model'
import { DomainError } from '../../shared/domain-error'
import { isLotEligible, normalizeReceiveLot, type NormalizedReceiveLotInput } from './policy'
import { runInventoryCommand } from './operation'
import type { CommandContext, InventoryActor, LotDetail, ReceiveLotInput } from './types'

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
  createdAt: Date
  updatedAt: Date
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
      actorId: actor.userId ?? 'system',
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
