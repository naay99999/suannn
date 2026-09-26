import type { AuditContext } from '../audit/model'
import type { CursorPage } from '../products/types'

export interface InventoryActor {
  userId: string | null
  auditContext: AuditContext
}

export interface CommandContext {
  actor: InventoryActor
  idempotencyKey: string
}

export interface ReceiveLotInput {
  warehouseId: string
  variantId: string
  lotCode: string
  quantity: number
  expiryDate: string
  receivedAt?: string | Date
  quarantined?: boolean
  quarantineReason?: string
}

export type WriteOffReason = 'spoiled' | 'expired' | 'damaged'

export interface WriteOffInput {
  quantity: number
  reason: WriteOffReason
  note?: string
}

export interface CountAdjustmentInput {
  countedQuantity: number
  reason: string
}

export interface LotDetail {
  id: string
  warehouseId: string
  variantId: string
  lotCode: string
  receivedAt: string
  expiryDate: string
  quarantinedAt: string | null
  quarantineReason: string | null
  onHandQuantity: number
  reservedQuantity: number
  sellableQuantity: number
  createdAt: string
  updatedAt: string
}

export interface VariantStockSummary {
  variantId: string
  warehouseId: string
  onHandQuantity: number
  reservedQuantity: number
  eligibleQuantity: number
  sellableQuantity: number
}

export interface LotQuery {
  warehouseId?: string
  variantId?: string
  limit?: number
  cursor?: string
}

export interface MovementQuery {
  warehouseId?: string
  variantId?: string
  lotId?: string
  limit?: number
  cursor?: string
}

export interface MovementDetail {
  id: string
  lotId: string
  operationId: string
  quantityDelta: number
  balanceAfter: number
  type: 'receipt' | 'write_off' | 'count_adjustment' | 'reservation_confirm'
  reasonCode: string
  occurredAt: string
  actorId: string
}

export type InventoryCursorPage<T> = CursorPage<T>
