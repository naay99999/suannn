import type { ApiClient } from '../api'
import { api } from '../api'
import { apiData, apiRequest } from '../api-result'
import type { DateRange } from './format'

type MarketingRoute = ApiClient['admin']['marketing']
type Success<T> = Exclude<NonNullable<T>, { code: string; message: string }>
export type MarketingOverview = Success<Awaited<ReturnType<MarketingRoute['overview']['get']>>['data']>
export type MarketingCampaign = MarketingOverview['campaigns'][number]
export type MarketingSettings = Success<Awaited<ReturnType<MarketingRoute['settings']['get']>>['data']>
export type MarketingTemplates = Success<Awaited<ReturnType<MarketingRoute['templates']['get']>>['data']>
export type MarketingSyncResult = Success<Awaited<ReturnType<MarketingRoute['sync']['post']>>['data']>
export interface UpdateMarginInput { marginPercent: number; version: number }

export function createMarketingApi(client: ApiClient = api) {
  return {
    overview: (range: DateRange) => apiRequest(async () => apiData(await client.admin.marketing.overview.get({ query: range })) as MarketingOverview),
    settings: () => apiRequest(async () => apiData(await client.admin.marketing.settings.get()) as MarketingSettings),
    updateMargin: (input: UpdateMarginInput) => apiRequest(async () => apiData(await client.admin.marketing.settings.put(input)) as MarketingSettings),
    templates: () => apiRequest(async () => apiData(await client.admin.marketing.templates.get()) as MarketingTemplates),
    // An empty JSON body is required: the browser-mutation guard rejects body-less POSTs.
    sync: () => apiRequest(async () => apiData(await client.admin.marketing.sync.post({})) as MarketingSyncResult),
  }
}

export const marketingApi = createMarketingApi()
