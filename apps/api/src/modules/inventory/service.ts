import type { InventoryReadRepository } from './read-repository'
import type { InventoryStockRepository } from './stock-repository'
import type {
  CommandContext,
  LotDetail,
  LotQuery,
  MovementDetail,
  MovementQuery,
  CountAdjustmentInput,
  ReceiveLotInput,
  WriteOffInput,
  VariantStockSummary,
} from './types'

export class InventoryService {
  constructor(
    private readonly stock: InventoryStockRepository,
    private readonly reads: InventoryReadRepository,
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

  getVariantSummary(variantId: string, warehouseId: string): Promise<VariantStockSummary> {
    return this.reads.getVariantSummary(variantId, warehouseId)
  }

  listLots(query: LotQuery) {
    return this.reads.listLots(query)
  }

  getLot(id: string): Promise<LotDetail> {
    return this.reads.getLot(id)
  }

  listMovements(query: MovementQuery): Promise<import('./types').InventoryCursorPage<MovementDetail>> {
    return this.reads.listMovements(query)
  }
}
