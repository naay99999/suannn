import type { ApiClient } from '../api'
import { api } from '../api'
import { apiData, apiRequest } from '../api-result'

type SettingsRoute = ApiClient['admin']['commerce-settings']
type SettingsGet = Awaited<ReturnType<SettingsRoute['get']>>
type SettingsPut = Awaited<ReturnType<SettingsRoute['put']>>
type Success<T> = Exclude<NonNullable<T>, { code: string; message: string }>
export type CommerceSettings = Success<SettingsGet['data']>
export type CommerceSettingsInput = NonNullable<Parameters<SettingsRoute['put']>[0]>

export function createCommerceSettingsApi(client: ApiClient = api) {
  return {
    get: () => apiRequest(async () => apiData(await client.admin['commerce-settings'].get()) as CommerceSettings),
    update: (input: CommerceSettingsInput) => apiRequest(async () => apiData(await client.admin['commerce-settings'].put(input)) as Success<SettingsPut['data']>),
  }
}

export const commerceSettingsApi = createCommerceSettingsApi()
