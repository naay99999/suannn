import type { ApiClient } from '../api'
import { api } from '../api'
import { apiData, apiEmpty, apiRequest } from '../api-result'

type DiscountsRoute = ApiClient['admin']['discounts']
type Success<T> = Exclude<NonNullable<T>, { code: string; message: string }>
export type DiscountList = Success<Awaited<ReturnType<DiscountsRoute['get']>>['data']>
export type Discount = DiscountList['items'][number]
export type DiscountDetail = Success<Awaited<ReturnType<ReturnType<DiscountsRoute>['get']>>['data']>
export type DiscountInput = NonNullable<Parameters<DiscountsRoute['post']>[0]>
export type DiscountUpdateInput = NonNullable<Parameters<ReturnType<DiscountsRoute>['put']>[0]>

export function createDiscountsApi(client: ApiClient = api) {
  return {
    list: () => apiRequest(async () => apiData(await client.admin.discounts.get()) as DiscountList),
    get: (discountId: string) => apiRequest(async () => apiData(await client.admin.discounts({ discountId }).get()) as DiscountDetail),
    create: (input: DiscountInput) => apiRequest(async () => apiData(await client.admin.discounts.post(input)) as DiscountDetail),
    update: (discountId: string, input: DiscountUpdateInput) => apiRequest(async () => apiData(await client.admin.discounts({ discountId }).put(input)) as DiscountDetail),
    // An empty JSON body is required: the browser-mutation guard rejects body-less DELETEs.
    remove: (discountId: string) => apiRequest(async () => { apiEmpty(await client.admin.discounts({ discountId }).delete({})) }),
  }
}

export const discountsApi = createDiscountsApi()
