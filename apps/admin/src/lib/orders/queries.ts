import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { ordersApi, type OrderListInput } from './api'

export const ordersKeys = {
  all: ['orders'] as const,
  lists: () => [...ordersKeys.all, 'list'] as const,
  list: (query?: OrderListInput) => [...ordersKeys.lists(), query] as const,
  detail: (id: string) => [...ordersKeys.all, 'detail', id] as const,
}

export function ordersQuery(query?: OrderListInput) {
  return queryOptions({ queryKey: ordersKeys.list(query), queryFn: () => ordersApi.list(query) })
}

export function orderQuery(id: string) {
  return queryOptions({ queryKey: ordersKeys.detail(id), queryFn: () => ordersApi.get(id) })
}

export async function invalidateOrders(client: QueryClient, orderId?: string): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: ordersKeys.lists() }),
    orderId ? client.invalidateQueries({ queryKey: ordersKeys.detail(orderId) }) : client.invalidateQueries({ queryKey: ordersKeys.all }),
    client.invalidateQueries({ queryKey: ['inventory'] }),
  ])
}
