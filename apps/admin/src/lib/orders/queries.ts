import { keepPreviousData, queryOptions, type QueryClient } from '@tanstack/react-query'
import { ordersApi, type OrderListInput } from './api'

export const ordersKeys = {
  all: ['orders'] as const,
  lists: () => [...ordersKeys.all, 'list'] as const,
  list: (query?: OrderListInput) => [...ordersKeys.lists(), query] as const,
  detail: (id: string) => [...ordersKeys.all, 'detail', id] as const,
  receipt: (id: string, number: string, status: string) => [...ordersKeys.detail(id), 'receipt', number, status] as const,
}

export function ordersQuery(query?: OrderListInput) {
  // Keep the current rows on screen while another sort or page loads, instead of flashing a skeleton.
  return queryOptions({ queryKey: ordersKeys.list(query), queryFn: () => ordersApi.list(query), placeholderData: keepPreviousData })
}

export function orderQuery(id: string) {
  return queryOptions({ queryKey: ordersKeys.detail(id), queryFn: () => ordersApi.get(id) })
}

export function receiptPdfQuery(id: string, number: string, status: string) {
  // The PDF changes when the receipt is cancelled, so the status is part of the key; never keep blobs around after closing.
  return queryOptions({ queryKey: ordersKeys.receipt(id, number, status), queryFn: () => ordersApi.fetchReceipt(id), staleTime: Infinity, gcTime: 0 })
}

export async function invalidateOrders(client: QueryClient, orderId?: string): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: ordersKeys.lists() }),
    orderId ? client.invalidateQueries({ queryKey: ordersKeys.detail(orderId) }) : client.invalidateQueries({ queryKey: ordersKeys.all }),
    client.invalidateQueries({ queryKey: ['inventory'] }),
  ])
}
