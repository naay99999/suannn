import type { ApiClient } from '../api'
import { api } from '../api'
import { apiData, apiRequest } from '../api-result'

type TrackingRoute = ApiClient['admin']['integrations']['tracking']
type TrackingGet = Awaited<ReturnType<TrackingRoute['get']>>
type Success<T> = Exclude<NonNullable<T>, { code: string; message: string }>
export type TrackingStatus = Success<TrackingGet['data']>
export type TrackingDestinationStatus = TrackingStatus['destinations'][number]

export function createIntegrationsApi(client: ApiClient = api) {
  return {
    trackingStatus: () => apiRequest(async () => apiData(await client.admin.integrations.tracking.get()) as TrackingStatus),
  }
}

export const integrationsApi = createIntegrationsApi()
