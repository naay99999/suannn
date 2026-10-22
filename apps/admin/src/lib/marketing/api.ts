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
export type MarketingFunnel = Success<Awaited<ReturnType<MarketingRoute['funnel']['get']>>['data']>
export type MarketingExperiments = Success<Awaited<ReturnType<MarketingRoute['experiments']['get']>>['data']>
export type MarketingExperiment = MarketingExperiments['experiments'][number]
export type CatalogFeedSummary = Success<Awaited<ReturnType<MarketingRoute['catalog-feed']['get']>>['data']>
export interface FunnelFilter { platform?: string; campaign?: string }
export interface UpdateMarginInput { marginPercent: number; version: number }
export interface UpdateCatalogBrandInput { catalogBrandName: string; version: number }

export function createMarketingApi(client: ApiClient = api) {
  return {
    overview: (range: DateRange) => apiRequest(async () => apiData(await client.admin.marketing.overview.get({ query: range })) as MarketingOverview),
    funnel: (range: DateRange, filter: FunnelFilter) => apiRequest(async () => apiData(await client.admin.marketing.funnel.get({ query: { ...range, ...filter } })) as MarketingFunnel),
    experiments: () => apiRequest(async () => apiData(await client.admin.marketing.experiments.get()) as MarketingExperiments),
    settings: () => apiRequest(async () => apiData(await client.admin.marketing.settings.get()) as MarketingSettings),
    updateMargin: (input: UpdateMarginInput) => apiRequest(async () => apiData(await client.admin.marketing.settings.put(input)) as MarketingSettings),
    catalogFeed: () => apiRequest(async () => apiData(await client.admin.marketing['catalog-feed'].get()) as CatalogFeedSummary),
    updateCatalogBrand: (input: UpdateCatalogBrandInput) => apiRequest(async () => apiData(await client.admin.marketing.settings['catalog-brand'].put(input)) as MarketingSettings),
    templates: () => apiRequest(async () => apiData(await client.admin.marketing.templates.get()) as MarketingTemplates),
    // An empty JSON body is required: the browser-mutation guard rejects body-less POSTs.
    sync: () => apiRequest(async () => apiData(await client.admin.marketing.sync.post({})) as MarketingSyncResult),
  }
}

export const marketingApi = createMarketingApi()
