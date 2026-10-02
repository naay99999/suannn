import type { ApiClient } from '../api'
import { api } from '../api'
import { apiData, apiEmpty, apiRequest } from '../api-result'

type ProductsRoute = ApiClient['admin']['products']
type ProductRoute = ReturnType<ProductsRoute>
type ProductVariantsRoute = ProductRoute['variants']
type ProductVariantRoute = ReturnType<ProductVariantsRoute>
type ProductListResponse = Awaited<ReturnType<ProductsRoute['get']>>
type ProductDetailResponse = Awaited<ReturnType<ProductRoute['get']>>
type ProductCreateResponse = Awaited<ReturnType<ProductsRoute['post']>>
type ProductUpdateResponse = Awaited<ReturnType<ProductRoute['patch']>>
type VariantResponse = Awaited<ReturnType<ProductVariantsRoute['post']>>
type VariantUpdateResponse = Awaited<ReturnType<ProductVariantRoute['patch']>>
type CatalogSuccess<T> = Exclude<NonNullable<T>, { code: string; message: string }>

export type ProductSummary = CatalogSuccess<ProductListResponse['data']>['items'][number]
export type ProductDetail = CatalogSuccess<ProductDetailResponse['data']>
export type ProductCreated = CatalogSuccess<ProductCreateResponse['data']>
export type ProductUpdated = CatalogSuccess<ProductUpdateResponse['data']>
export type Variant = CatalogSuccess<VariantResponse['data']>
export type VariantUpdated = CatalogSuccess<VariantUpdateResponse['data']>
export type CatalogListInput = NonNullable<Parameters<ApiClient['admin']['products']['get']>[0]>['query']
export type ProductCreateInput = NonNullable<Parameters<ApiClient['admin']['products']['post']>[0]>
export type ProductUpdateInput = NonNullable<Parameters<ProductRoute['patch']>[0]>
export type VariantCreateInput = NonNullable<Parameters<ProductVariantsRoute['post']>[0]>
export type VariantUpdateInput = NonNullable<Parameters<ProductVariantRoute['patch']>[0]>

export function createCatalogApi(client: ApiClient = api) {
  return {
    list: (query?: CatalogListInput) => apiRequest(async () =>
      apiData(await client.admin.products.get({ query }))),
    get: (id: string) => apiRequest(async () =>
      apiData(await client.admin.products({ id }).get()) as ProductDetail),
    create: (input: ProductCreateInput) => apiRequest(async () =>
      apiData(await client.admin.products.post(input)) as ProductCreated),
    update: (id: string, input: ProductUpdateInput) => apiRequest(async () =>
      apiData(await client.admin.products({ id }).patch(input)) as ProductUpdated),
    publish: (id: string) => apiRequest(async () => {
      apiEmpty(await client.admin.products({ id }).publish.post())
    }),
    unpublish: (id: string) => apiRequest(async () => {
      apiEmpty(await client.admin.products({ id }).unpublish.post())
    }),
    archive: (id: string) => apiRequest(async () => {
      apiEmpty(await client.admin.products({ id }).delete())
    }),
    createVariant: (productId: string, input: VariantCreateInput) => apiRequest(async () =>
      apiData(await client.admin.products({ id: productId }).variants.post(input)) as Variant),
    updateVariant: (productId: string, variantId: string, input: VariantUpdateInput) => apiRequest(async () =>
      apiData(await client.admin.products({ id: productId }).variants({ variantId }).patch(input)) as VariantUpdated),
    archiveVariant: (productId: string, variantId: string) => apiRequest(async () => {
      apiEmpty(await client.admin.products({ id: productId }).variants({ variantId }).delete())
    }),
  }
}

export const catalogApi = createCatalogApi()
