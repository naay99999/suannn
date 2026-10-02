import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { inventoryApi, type LotListInput, type MovementListInput } from './api'

export const RESERVATION_POLL_INTERVAL = 30_000

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
  reservation: (id: string) => [...inventoryKeys.reservations(), id] as const,
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

export function reservationQuery(id: string) {
  return queryOptions({
    queryKey: inventoryKeys.reservation(id),
    queryFn: () => inventoryApi.reservation(id),
    enabled: Boolean(id),
    refetchInterval: (query) => query.state.data?.status === 'active'
      && typeof document !== 'undefined'
      && document.visibilityState === 'visible'
      ? RESERVATION_POLL_INTERVAL
      : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })
}

export type ReservationExpiryScheduler = {
  now: () => number
  setTimeout: (callback: () => void, delay: number) => unknown
  clearTimeout: (timer: unknown) => void
}

export function scheduleReservationExpiry(
  expiresAt: string,
  onExpiry: () => void,
  scheduler: ReservationExpiryScheduler = {
    now: () => Date.now(),
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
  },
): () => void {
  let cancelled = false
  let fired = false
  const timer = scheduler.setTimeout(() => {
    if (cancelled || fired) return
    fired = true
    onExpiry()
  }, Math.max(0, Date.parse(expiresAt) - scheduler.now()))

  return () => {
    cancelled = true
    scheduler.clearTimeout(timer)
  }
}

export async function invalidateInventory(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: inventoryKeys.all }),
    client.invalidateQueries({ queryKey: ['catalog'] }),
  ])
}
