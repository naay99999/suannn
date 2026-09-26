import type { InventoryReadRepository } from './read-repository'
import type { InventoryStockRepository } from './stock-repository'
import type { InventoryReservationRepository } from './reservation-repository'
import type {
  CommandContext,
  LotDetail,
  LotQuery,
  MovementDetail,
  MovementQuery,
  ReserveInput,
  ReservationDetail,
  CountAdjustmentInput,
  ReceiveLotInput,
  WriteOffInput,
  VariantStockSummary,
  WarehouseDetail,
} from './types'

export class InventoryService {
  constructor(
    private readonly stock: InventoryStockRepository,
    private readonly reads: InventoryReadRepository,
    private readonly reservations: InventoryReservationRepository,
  ) {}

  receiveLot(input: ReceiveLotInput, context: CommandContext): Promise<LotDetail> {
    return this.stock.receiveLot(input, context)
  }

  writeOff(lotId: string, input: WriteOffInput, context: CommandContext): Promise<LotDetail> {
    return this.stock.writeOff(lotId, input, context)
  }

  adjustCount(lotId: string, input: CountAdjustmentInput, context: CommandContext): Promise<LotDetail> {
    return this.stock.adjustCount(lotId, input, context)
  }

  reserve(input: ReserveInput, context: CommandContext): Promise<ReservationDetail> {
    return this.reservations.reserve(input, context)
  }

  confirm(reservationId: string, context: CommandContext): Promise<ReservationDetail> {
    return this.reservations.confirm(reservationId, context)
  }

  release(reservationId: string, context: CommandContext): Promise<ReservationDetail> {
    return this.reservations.release(reservationId, context)
  }

  expireDueReservations(limit: number): Promise<number> {
    return this.reservations.expireDueReservations(limit)
  }

  quarantineLot(lotId: string, reason: string, context: CommandContext): Promise<LotDetail> {
    return this.reservations.quarantineLot(lotId, reason, context)
  }

  releaseQuarantine(lotId: string, context: CommandContext): Promise<LotDetail> {
    return this.reservations.releaseQuarantine(lotId, context)
  }

  getVariantSummary(variantId: string, warehouseId: string): Promise<VariantStockSummary> {
    return this.reads.getVariantSummary(variantId, warehouseId)
  }

  getDefaultWarehouse(): Promise<WarehouseDetail> {
    return this.reads.getDefaultWarehouse()
  }

  listLots(query: LotQuery) {
    return this.reads.listLots(query)
  }

  getLot(id: string): Promise<LotDetail> {
    return this.reads.getLot(id)
  }

  getReservation(id: string): Promise<ReservationDetail> {
    return this.reservations.getReservation(id)
  }

  listMovements(query: MovementQuery): Promise<import('./types').InventoryCursorPage<MovementDetail>> {
    return this.reads.listMovements(query)
  }
}
