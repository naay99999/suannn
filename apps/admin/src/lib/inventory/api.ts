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
type LotCommandsRoute = ReturnType<InventoryRoute['lots']>
type HyphenatedLotCommands = {
  'release-quarantine': LotCommandsRoute['release-quarantine']
  'write-offs': LotCommandsRoute['write-offs']
  'count-adjustments': LotCommandsRoute['count-adjustments']
}
type ReceiveResponse = Awaited<ReturnType<InventoryRoute['lots']['post']>>
type QuarantineResponse = Awaited<ReturnType<LotCommandsRoute['quarantine']['post']>>
type ReleaseQuarantineResponse = Awaited<ReturnType<LotCommandsRoute['release-quarantine']['post']>>
type WriteOffResponse = Awaited<ReturnType<LotCommandsRoute['write-offs']['post']>>
type CountAdjustmentResponse = Awaited<ReturnType<LotCommandsRoute['count-adjustments']['post']>>
type InventorySuccess<T> = Exclude<NonNullable<T>, { code: string; message: string }>

export type Warehouse = InventorySuccess<WarehouseResponse['data']>
export type StockSummary = InventorySuccess<SummaryResponse['data']>
export type Lot = InventorySuccess<LotDetailResponse['data']>
export type Movement = InventorySuccess<MovementListResponse['data']>['items'][number]
export type LotListInput = NonNullable<Parameters<InventoryRoute['lots']['get']>[0]>['query']
export type MovementListInput = NonNullable<Parameters<InventoryRoute['movements']['get']>[0]>['query']
export type ReceiveInput = NonNullable<Parameters<InventoryRoute['lots']['post']>[0]>
export type QuarantineInput = NonNullable<Parameters<LotCommandsRoute['quarantine']['post']>[0]>
export type WriteOffInput = NonNullable<Parameters<LotCommandsRoute['write-offs']['post']>[0]>
export type CountAdjustmentInput = NonNullable<Parameters<LotCommandsRoute['count-adjustments']['post']>[0]>

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
    receive: (input: ReceiveInput, key: string) => apiRequest(async () => apiData(
      await client.admin.inventory.lots.post(input, { headers: { 'idempotency-key': key } }),
    ) as InventorySuccess<ReceiveResponse['data']>),
    quarantine: (lotId: string, input: QuarantineInput, key: string) => apiRequest(async () => apiData(
      await client.admin.inventory.lots({ lotId }).quarantine.post(input, { headers: { 'idempotency-key': key } }),
    ) as InventorySuccess<QuarantineResponse['data']>),
    releaseQuarantine: (lotId: string, key: string) => apiRequest(async () => {
      const route = client.admin.inventory.lots({ lotId }) as LotCommandsRoute & HyphenatedLotCommands
      return apiData(await route['release-quarantine'].post({}, { headers: { 'idempotency-key': key } })) as InventorySuccess<ReleaseQuarantineResponse['data']>
    }),
    writeOff: (lotId: string, input: WriteOffInput, key: string) => apiRequest(async () => {
      const route = client.admin.inventory.lots({ lotId }) as LotCommandsRoute & HyphenatedLotCommands
      return apiData(await route['write-offs'].post(input, { headers: { 'idempotency-key': key } })) as InventorySuccess<WriteOffResponse['data']>
    }),
    adjustCount: (lotId: string, input: CountAdjustmentInput, key: string) => apiRequest(async () => {
      const route = client.admin.inventory.lots({ lotId }) as LotCommandsRoute & HyphenatedLotCommands
      return apiData(await route['count-adjustments'].post(input, { headers: { 'idempotency-key': key } })) as InventorySuccess<CountAdjustmentResponse['data']>
    }),
  }
}

export const inventoryApi = createInventoryApi()
