import type { ApiClient } from '../api'
import { api } from '../api'
import { apiData, apiRequest } from '../api-result'

type CustomerRoute = ReturnType<ApiClient['admin']['customers']>
type CustomerGet = Awaited<ReturnType<CustomerRoute['get']>>
type Success<T> = Exclude<NonNullable<T>, { code: string; message: string }>
export type CustomerDetail = Success<CustomerGet['data']>

export const customerIdPattern = /^[A-Za-z0-9_-]{1,128}$/

export function createCustomersApi(client: ApiClient = api) {
  return {
    get: (customerId: string) => apiRequest(async () => apiData(await client.admin.customers({ customerId }).get()) as CustomerDetail),
  }
}

export const customersApi = createCustomersApi()
