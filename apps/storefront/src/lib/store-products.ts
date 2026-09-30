import { api } from '@/lib/api'

export type StoreProductPage = NonNullable<Awaited<ReturnType<typeof api.store.products.get>>['data']>
export type StoreProductSummary = StoreProductPage['items'][number]
export type StoreProductDetail = NonNullable<Awaited<ReturnType<ReturnType<typeof api.store.products>['get']>>['data']>
export interface StoreProductGalleryImage {
  src: string
  alt: string
  caption: string
  thumbnailSrc?: string
}
export interface StoreProductGallery {
  id: string
  name: string
  images: StoreProductGalleryImage[]
}
export type StoreProductSort = StoreProductQuery['sort']

export interface StoreProductQuery {
  q?: string
  category?: 'fresh' | 'processed'
  sort?: 'newest' | 'price-asc' | 'price-desc'
  limit?: number
  cursor?: string
}

export class StoreProductRequestError extends Error {
  constructor(public status: number, public code: string) {
    super(code)
    this.name = 'StoreProductRequestError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unwrapStoreResult<T>(result: { data: T | null; error: unknown; status: number }): T {
  if (result.error) {
    const body = isRecord(result.error) && 'value' in result.error ? result.error.value : result.error
    const code = isRecord(body) && typeof body.code === 'string' ? body.code : 'STORE_PRODUCT_REQUEST_FAILED'
    throw new StoreProductRequestError(result.status, code)
  }
  if (result.data === null) throw new StoreProductRequestError(502, 'EMPTY_STORE_PRODUCT_RESPONSE')
  return result.data
}

export async function getStoreProducts(query: StoreProductQuery = {}): Promise<StoreProductPage> {
  const result = await api.store.products.get({ query })
  return unwrapStoreResult(result)
}

export async function getStoreProduct(slug: string): Promise<StoreProductDetail> {
  const result = await api.store.products({ slug }).get()
  return unwrapStoreResult(result)
}

export function storeProductQueryKey(query: StoreProductQuery) {
  return ['store-products', query] as const
}

export function storeProductDetailQueryKey(slug: string) {
  return ['store-product', slug] as const
}

export function readCatalogFilters(params: URLSearchParams): Pick<StoreProductQuery, 'q' | 'category' | 'sort'> {
  const q = params.get('q')?.trim()
  const category = params.get('category')
  const sort = params.get('sort')
  return {
    ...(q ? { q } : {}),
    category: category === 'fresh' || category === 'processed' ? category : undefined,
    sort: sort === 'newest' || sort === 'price-asc' || sort === 'price-desc' ? sort : undefined,
  }
}

export function updateCatalogParams(params: URLSearchParams, key: 'q' | 'category' | 'sort', value: string): URLSearchParams {
  const next = new URLSearchParams(params)
  if (!value || value === 'all' || value === 'newest') next.delete(key)
  else next.set(key, value)
  next.delete('cursor')
  return next
}

export function readStoreCategorySlug(slug: string | undefined): StoreProductQuery['category'] {
  return slug === 'fresh' || slug === 'processed' ? slug : undefined
}

export function formatStorePrice(priceSatang: number): string {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 2,
  }).format(priceSatang / 100)
}

export const storeCategoryLabels = {
  fresh: 'ผลไม้สด',
  processed: 'ผลิตภัณฑ์แปรรูป',
} satisfies Record<NonNullable<StoreProductSummary['category']>, string>
