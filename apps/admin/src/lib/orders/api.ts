import type { ApiClient } from '../api'
import { api } from '../api'
import { apiData, apiRequest } from '../api-result'

type OrdersRoute = ApiClient['admin']['orders']
type OrderRoute = ReturnType<OrdersRoute>
type OrderListResponse = Awaited<ReturnType<OrdersRoute['get']>>
type OrderDetailResponse = Awaited<ReturnType<OrderRoute['get']>>
type OrderSuccess<T> = Exclude<NonNullable<T>, { code: string; message: string }>

export type OrderPage = OrderSuccess<OrderListResponse['data']>
export type OrderDetail = OrderSuccess<OrderDetailResponse['data']>
export type OrderListInput = NonNullable<Parameters<OrdersRoute['get']>[0]>['query']

export function createOrdersApi(client: ApiClient = api) {
  return {
    list: (query?: OrderListInput) => apiRequest(async () => apiData(await client.admin.orders.get({ query })) as OrderPage),
    get: (orderId: string) => apiRequest(async () => apiData(await client.admin.orders({ orderId }).get()) as OrderDetail),
  }
}

export const ordersApi = createOrdersApi()
