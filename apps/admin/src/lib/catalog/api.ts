import type { ApiClient } from '../api'
import { api } from '../api'
import { apiData, apiEmpty, apiRequest } from '../api-result'

type ProductsRoute = ApiClient['admin']['products']
type ProductRoute = ReturnType<ProductsRoute>
type ProductVariantsRoute = ProductRoute['variants']
type ProductVariantRoute = ReturnType<ProductVariantsRoute>
type ProductListResponse = Awaited<ReturnType<ProductsRoute['get']>>
type ProductDetailResponse = Awaited<ReturnType<ProductRoute['get']>>
type VariantResponse = Awaited<ReturnType<ProductVariantsRoute['post']>>

export type ProductSummary = NonNullable<ProductListResponse['data']>['items'][number]
export type ProductDetail = NonNullable<ProductDetailResponse['data']>
export type Variant = NonNullable<VariantResponse['data']>
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
      apiData(await client.admin.products({ id }).get())),
    create: (input: ProductCreateInput) => apiRequest(async () =>
      apiData(await client.admin.products.post(input))),
    update: (id: string, input: ProductUpdateInput) => apiRequest(async () =>
      apiData(await client.admin.products({ id }).patch(input))),
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
      apiData(await client.admin.products({ id: productId }).variants.post(input))),
    updateVariant: (productId: string, variantId: string, input: VariantUpdateInput) => apiRequest(async () =>
      apiData(await client.admin.products({ id: productId }).variants({ variantId }).patch(input))),
    archiveVariant: (productId: string, variantId: string) => apiRequest(async () => {
      apiEmpty(await client.admin.products({ id: productId }).variants({ variantId }).delete())
    }),
  }
}

export const catalogApi = createCatalogApi()
