import type { ApiClient } from '../api'
import { api } from '../api'
import { ApiRequestError, apiData, apiRequest } from '../api-result'
import { resolveApiUrl } from '../api-url'

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
  | { kind: 'fulfillment'; status: FulfillmentInput['status']; shipment?: FulfillmentInput['shipment'] }
  | { kind: 'cancel' }
  | { kind: 'collectCod'; amountSatang: number }
  | { kind: 'refund' }
  | { kind: 'reissue' | 'revoke'; reasonCode: GuestAccessInput['reasonCode'] }
  | { kind: 'issueReceipt' }
  | { kind: 'cancelReceipt'; reason: string }

const revokeDelayMs = 10_000

export function createOrdersApi(client: ApiClient = api, options: { fetcher?: typeof fetch; baseUrl?: string } = {}) {
  const fetcher = options.fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init))
  const baseUrl = options.baseUrl ?? resolveApiUrl(import.meta.env.VITE_API_URL, import.meta.env.PROD)
  return {
    list: (query?: OrderListInput) => apiRequest(async () => apiData(await client.admin.orders.get({ query })) as OrderPage),
    get: (orderId: string) => apiRequest(async () => apiData(await client.admin.orders({ orderId }).get()) as OrderDetail),
    execute: (orderId: string, command: OrderCommand, key: string) => apiRequest(async () => {
      const route = client.admin.orders({ orderId })
      switch (command.kind) {
        case 'fulfillment': return apiData(await route.fulfillment.post({ status: command.status, ...(command.shipment ? { shipment: command.shipment } : {}) }, { headers: { 'idempotency-key': key } })) as OrderDetail
        case 'cancel': return apiData(await route.cancel.post({}, { headers: { 'idempotency-key': key } })) as OrderDetail
        case 'collectCod': return apiData(await route['collect-cod'].post({ amountSatang: command.amountSatang }, { headers: { 'idempotency-key': key } })) as OrderDetail
        case 'refund': return apiData(await route.refund.post({}, { headers: { 'idempotency-key': key } })) as OrderDetail
        case 'reissue': return apiData(await route['guest-access'].reissue.post({ reasonCode: command.reasonCode }, { headers: { 'idempotency-key': key } })) as OrderDetail
        case 'issueReceipt': return apiData(await route.receipt.post({}, { headers: { 'idempotency-key': key } })) as OrderDetail
        case 'cancelReceipt': return apiData(await route.receipt.cancel.post({ reason: command.reason }, { headers: { 'idempotency-key': key } })) as OrderDetail
        case 'revoke': return apiData(await route['guest-access'].revoke.post({ reasonCode: command.reasonCode }, { headers: { 'idempotency-key': key } })) as OrderDetail
      }
    }),
    downloadReceipt: (orderId: string, receiptNumber: string) => apiRequest(async () => {
      const response = await fetcher(`${baseUrl}/api/v1/admin/orders/${encodeURIComponent(orderId)}/receipt.pdf`, { credentials: 'include' })
      if (!response.ok) throw new ApiRequestError(response.status, 'RECEIPT_DOWNLOAD_FAILED', 'ดาวน์โหลดใบเสร็จไม่ได้')
      const url = URL.createObjectURL(await response.blob())
      try {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${receiptNumber}.pdf`
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
      } catch (error) {
        URL.revokeObjectURL(url)
        throw error
      }
      // Revoking synchronously can cancel the download in Firefox and Safari.
      setTimeout(() => URL.revokeObjectURL(url), revokeDelayMs)
    }),
  }
}

export const ordersApi = createOrdersApi()
