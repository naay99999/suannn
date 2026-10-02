import type { ApiClient } from '../api'
import { api } from '../api'
import { apiData, apiRequest } from '../api-result'

type InventoryRoute = ApiClient['admin']['inventory']
type VariantRoute = ReturnType<InventoryRoute['variants']>
type LotRoute = ReturnType<InventoryRoute['lots']>
type WarehouseResponse = Awaited<ReturnType<InventoryRoute['warehouses']['get']>>
type SummaryResponse = Awaited<ReturnType<VariantRoute['summary']['get']>>
type LotListResponse = Awaited<ReturnType<InventoryRoute['lots']['get']>>
type LotDetailResponse = Awaited<ReturnType<LotRoute['get']>>
type MovementListResponse = Awaited<ReturnType<InventoryRoute['movements']['get']>>
type InventorySuccess<T> = Exclude<NonNullable<T>, { code: string; message: string }>

export type Warehouse = InventorySuccess<WarehouseResponse['data']>
export type StockSummary = InventorySuccess<SummaryResponse['data']>
export type Lot = InventorySuccess<LotDetailResponse['data']>
export type Movement = InventorySuccess<MovementListResponse['data']>['items'][number]
export type LotListInput = NonNullable<Parameters<InventoryRoute['lots']['get']>[0]>['query']
export type MovementListInput = NonNullable<Parameters<InventoryRoute['movements']['get']>[0]>['query']

export function createInventoryApi(client: ApiClient = api) {
  return {
    warehouse: () => apiRequest(async () => apiData(await client.admin.inventory.warehouses.get()) as Warehouse),
    summary: (variantId: string) => apiRequest(async () => apiData(
      await client.admin.inventory.variants({ variantId }).summary.get(),
    ) as StockSummary),
    lots: (query: LotListInput) => apiRequest(async () => apiData(
      await client.admin.inventory.lots.get({ query }),
    ) as InventorySuccess<LotListResponse['data']>),
    lot: (lotId: string) => apiRequest(async () => apiData(
      await client.admin.inventory.lots({ lotId }).get(),
    ) as Lot),
    movements: (query: MovementListInput) => apiRequest(async () => apiData(
      await client.admin.inventory.movements.get({ query }),
    ) as InventorySuccess<MovementListResponse['data']>),
  }
}

export const inventoryApi = createInventoryApi()
