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
export type FulfillmentInput = NonNullable<Parameters<OrderRoute['fulfillment']['post']>[0]>
export type GuestAccessInput = NonNullable<Parameters<OrderRoute['guest-access']['reissue']['post']>[0]>
export type OrderCommand =
  | { kind: 'fulfillment'; status: FulfillmentInput['status'] }
  | { kind: 'cancel' }
  | { kind: 'collectCod'; amountSatang: number }
  | { kind: 'refund' }
  | { kind: 'reissue' | 'revoke'; reasonCode: GuestAccessInput['reasonCode'] }

export function createOrdersApi(client: ApiClient = api) {
  return {
    list: (query?: OrderListInput) => apiRequest(async () => apiData(await client.admin.orders.get({ query })) as OrderPage),
    get: (orderId: string) => apiRequest(async () => apiData(await client.admin.orders({ orderId }).get()) as OrderDetail),
    execute: (orderId: string, command: OrderCommand, key: string) => apiRequest(async () => {
      const route = client.admin.orders({ orderId })
      switch (command.kind) {
        case 'fulfillment': return apiData(await route.fulfillment.post({ status: command.status }, { headers: { 'idempotency-key': key } })) as OrderDetail
        case 'cancel': return apiData(await route.cancel.post({}, { headers: { 'idempotency-key': key } })) as OrderDetail
        case 'collectCod': return apiData(await route['collect-cod'].post({ amountSatang: command.amountSatang }, { headers: { 'idempotency-key': key } })) as OrderDetail
        case 'refund': return apiData(await route.refund.post({}, { headers: { 'idempotency-key': key } })) as OrderDetail
        case 'reissue': return apiData(await route['guest-access'].reissue.post({ reasonCode: command.reasonCode }, { headers: { 'idempotency-key': key } })) as OrderDetail
        case 'revoke': return apiData(await route['guest-access'].revoke.post({ reasonCode: command.reasonCode }, { headers: { 'idempotency-key': key } })) as OrderDetail
      }
    }),
  }
}

export const ordersApi = createOrdersApi()
