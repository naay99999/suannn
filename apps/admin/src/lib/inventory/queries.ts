import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { inventoryApi, type LotListInput, type MovementListInput } from './api'

export const inventoryKeys = {
  all: ['inventory'] as const,
  warehouse: () => [...inventoryKeys.all, 'warehouse'] as const,
  lots: () => [...inventoryKeys.all, 'lots'] as const,
  lotList: (query: LotListInput) => [...inventoryKeys.lots(), 'list', query] as const,
  lot: (id: string) => [...inventoryKeys.all, 'lot', id] as const,
  summary: (variantId: string) => [...inventoryKeys.all, 'summary', variantId] as const,
  movements: () => [...inventoryKeys.all, 'movements'] as const,
  movementList: (query: MovementListInput) => [...inventoryKeys.movements(), 'list', query] as const,
  reservations: () => [...inventoryKeys.all, 'reservations'] as const,
}

export function warehouseQuery() {
  return queryOptions({
    queryKey: inventoryKeys.warehouse(),
    queryFn: () => inventoryApi.warehouse(),
  })
}

export function stockSummaryQuery(variantId: string) {
  return queryOptions({
    queryKey: inventoryKeys.summary(variantId),
    queryFn: () => inventoryApi.summary(variantId),
    enabled: Boolean(variantId),
  })
}

export function lotsQuery(query: LotListInput) {
  return queryOptions({
    queryKey: inventoryKeys.lotList(query),
    queryFn: () => inventoryApi.lots(query),
  })
}

export function lotQuery(id: string) {
  return queryOptions({
    queryKey: inventoryKeys.lot(id),
    queryFn: () => inventoryApi.lot(id),
    enabled: Boolean(id),
  })
}

export function movementsQuery(query: MovementListInput) {
  return queryOptions({
    queryKey: inventoryKeys.movementList(query),
    queryFn: () => inventoryApi.movements(query),
  })
}

export async function invalidateInventory(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: inventoryKeys.all }),
    client.invalidateQueries({ queryKey: ['catalog'] }),
  ])
}
