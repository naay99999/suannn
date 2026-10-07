import { api } from '@/lib/api'

export type StoreFarmPage = NonNullable<Awaited<ReturnType<typeof api.store.farms.get>>['data']>
export type StoreFarmSummary = StoreFarmPage['items'][number]
export type StoreFarmDetail = NonNullable<Awaited<ReturnType<ReturnType<typeof api.store.farms>['get']>>['data']>
export type StoreFarmProductsPage = NonNullable<Awaited<ReturnType<ReturnType<typeof api.store.farms>['products']['get']>>['data']>
export type StoreFarmProductQuery = { limit?: number; cursor?: string }

export class StoreFarmRequestError extends Error {
  constructor(public status: number, public code: string) {
    super(code)
    this.name = 'StoreFarmRequestError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unwrapStoreFarmResult<T>(result: { data: T | null; error: unknown; status: number }): T {
  if (result.error) {
    const body = isRecord(result.error) && 'value' in result.error ? result.error.value : result.error
    const code = isRecord(body) && typeof body.code === 'string' ? body.code : 'STORE_FARM_REQUEST_FAILED'
    throw new StoreFarmRequestError(result.status, code)
  }
  if (result.data === null) throw new StoreFarmRequestError(502, 'EMPTY_STORE_FARM_RESPONSE')
  return result.data
}

export async function getStoreFarms(query: StoreFarmProductQuery = {}): Promise<StoreFarmPage> {
  return unwrapStoreFarmResult(await api.store.farms.get({ query }))
}

export async function getStoreFarm(slug: string): Promise<StoreFarmDetail> {
  return unwrapStoreFarmResult(await api.store.farms({ slug }).get())
}

export async function getStoreFarmProducts(slug: string, query: StoreFarmProductQuery = {}): Promise<StoreFarmProductsPage> {
  return unwrapStoreFarmResult(await api.store.farms({ slug }).products.get({ query }))
}

export function storeFarmListQueryKey(query: StoreFarmProductQuery) {
  return ['store-farms', query] as const
}

export function storeFarmDetailQueryKey(slug: string) {
  return ['store-farm', slug] as const
}

export function storeFarmProductsQueryKey(slug: string, query: StoreFarmProductQuery) {
  return ['store-farm-products', slug, query] as const
}
