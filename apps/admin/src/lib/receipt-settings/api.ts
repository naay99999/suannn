import type { ApiClient } from '../api'
import { api } from '../api'
import { apiData, apiRequest } from '../api-result'

type SettingsRoute = ApiClient['admin']['receipt-settings']
type SettingsGet = Awaited<ReturnType<SettingsRoute['get']>>
type SettingsPut = Awaited<ReturnType<SettingsRoute['put']>>
type Success<T> = Exclude<NonNullable<T>, { code: string; message: string }>
export type ReceiptSettings = Success<SettingsGet['data']>
export type ReceiptSettingsInput = NonNullable<Parameters<SettingsRoute['put']>[0]>

export function createReceiptSettingsApi(client: ApiClient = api) {
  return {
    get: () => apiRequest(async () => apiData(await client.admin['receipt-settings'].get()) as ReceiptSettings),
    update: (input: ReceiptSettingsInput) => apiRequest(async () => apiData(await client.admin['receipt-settings'].put(input)) as Success<SettingsPut['data']>),
  }
}

export const receiptSettingsApi = createReceiptSettingsApi()
