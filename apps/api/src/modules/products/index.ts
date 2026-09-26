import { Elysia } from 'elysia'
import type { AppConfig } from '../../config/env'
import { createAuthMacros } from '../../plugins/auth'
import type { Auth } from '../../plugins/auth/auth'
import { createBrowserMutationPlugin } from '../../plugins/browser-mutation'
import { createRequestContextPlugin } from '../../plugins/request-context'
import { httpModels } from '../../shared/http-model'
import { productModels } from './model'
import type { ProductService } from './service'
import type {
  CreateProductInput,
  CreateVariantInput,
  AdminProduct,
  AdminVariant,
  ProductActor,
  StoreProductQuery,
  AdminProductQuery,
  UpdateProductInput,
  UpdateVariantInput,
} from './types'

function productActor(userId: string, requestContext: { requestId: string; clientIp: string; userAgent: string | null }): ProductActor {
  return {
    userId,
    auditContext: {
      requestId: requestContext.requestId,
      ipAddress: requestContext.clientIp,
      userAgent: requestContext.userAgent,
    },
  }
}

function rejectUnknownQueryFields(allowed: readonly string[]) {
  const allowedFields = new Set(allowed)
  return ({ request, set }: { request: Request; set: { status?: number | string } }) => {
    for (const key of new URL(request.url).searchParams.keys()) {
      if (!allowedFields.has(key)) {
        set.status = 422
        return { code: 'VALIDATION_ERROR', message: 'Request validation failed' }
      }
    }
  }
}

function parseStrictJsonBody(allowed: readonly string[]) {
  const allowedFields = new Set(allowed)
  return async ({ request }: { request: Request }) => {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((key) => !allowedFields.has(key))) {
      throw new Error('INVALID_PRODUCT')
    }
    return body
  }
}

export function createStoreProductsModule(service: ProductService) {
  return new Elysia({ name: 'store-products', prefix: '/api/v1/store/products' })
    .model(httpModels)
    .model(productModels)
    .get('/', ({ query }) => service.listStore(query as StoreProductQuery), {
      beforeHandle: rejectUnknownQueryFields(['q', 'category', 'sort', 'limit', 'cursor']),
      query: 'product.storeQuery',
      response: { 200: 'product.storePage', 422: 'http.error' },
      detail: {
        summary: 'List published products',
        description: 'Returns published product summaries and their lowest active variant prices. Storefront access is public. canPurchase reflects the manual sales switch, not stock availability.',
        tags: ['Store Products'],
        security: [],
      },
    })
    .get('/:slug', ({ params }) => service.getStoreBySlug(params.slug), {
      beforeHandle: rejectUnknownQueryFields([]),
      params: 'product.storeSlugParams',
      response: { 200: 'product.storeDetail', 404: 'http.error', 422: 'http.error' },
      detail: {
        summary: 'Get a published product',
        description: 'Returns a published product and its active variants. Draft, archived, and unknown products return 404. Storefront access is public.',
        tags: ['Store Products'],
        security: [],
      },
    })
}

export function createAdminProductsModule(config: AppConfig, auth: Auth, service: ProductService) {
  const staffSecurity = [{ sessionCookie: [] }]
  const errors = { 401: 'http.error', 403: 'http.error', 404: 'http.error', 409: 'http.error', 422: 'http.error' } as const

  return new Elysia({ name: 'admin-products', prefix: '/api/v1/admin/products' })
    .use(createBrowserMutationPlugin(config))
    .use(createRequestContextPlugin(config))
    .use(createAuthMacros(auth))
    .model(httpModels)
    .model(productModels)
    .get('/', ({ query }) => service.listAdmin(query as AdminProductQuery), {
      beforeHandle: rejectUnknownQueryFields(['q', 'status', 'limit', 'cursor']),
      permission: { catalog: ['read'] },
      query: 'product.adminQuery',
      response: { 200: 'product.adminPage', 401: 'http.error', 403: 'http.error', 422: 'http.error' },
      detail: {
        summary: 'List products for catalog management',
        description: 'Returns product summaries across draft, published, and archived statuses. Requires catalog:read permission.',
        tags: ['Admin Products'], security: staffSecurity,
      },
    })
    .get('/:id', ({ params }) => service.getAdminById(params.id) as Promise<AdminProduct & { variants: AdminVariant[] }>, {
      permission: { catalog: ['read'] },
      params: 'product.idParams',
      response: { 200: 'product.adminProduct', ...errors },
      detail: {
        summary: 'Get a product for catalog management',
        description: 'Returns a product and its active and archived variants. Requires catalog:read permission.',
        tags: ['Admin Products'], security: staffSecurity,
      },
    })
    .post('/', ({ body, user, requestContext, set }) => {
      set.status = 201
      return service.createProduct(body as CreateProductInput, productActor(user.id, requestContext))
    }, {
      parse: [parseStrictJsonBody([
        'slug', 'name', 'category', 'englishName', 'description', 'originStory',
        'storageInstructions', 'imageUrl', 'imageAlt',
      ]), 'json'],
      browserMutation: 'admin',
      permission: { catalog: ['create'] },
      body: 'product.createBody',
      response: { 201: 'product.adminProductMutation', ...errors },
      detail: {
        summary: 'Create a draft product',
        description: 'Creates a draft product. Requires catalog:create permission and an admin-origin browser request.',
        tags: ['Admin Products'], security: staffSecurity,
      },
    })
    .patch('/:id', ({ params, body, user, requestContext }) => service.updateProduct(
      params.id, body as UpdateProductInput, productActor(user.id, requestContext),
    ), {
      parse: [parseStrictJsonBody([
        'name', 'category', 'englishName', 'description', 'originStory',
        'storageInstructions', 'imageUrl', 'imageAlt',
      ]), 'json'],
      browserMutation: 'admin',
      permission: { catalog: ['update'] },
      params: 'product.idParams',
      body: 'product.updateBody',
      response: { 200: 'product.adminProductMutation', ...errors },
      detail: {
        summary: 'Update product details',
        description: 'Updates mutable product details. Slugs cannot be changed; edits to a published product must leave it publishable. Requires catalog:update permission.',
        tags: ['Admin Products'], security: staffSecurity,
      },
    })
    .post('/:id/publish', ({ params, user, requestContext }) => service.publishProduct(
      params.id, productActor(user.id, requestContext),
    ), {
      browserMutation: 'admin',
      permission: { catalog: ['publish'] },
      params: 'product.idParams',
      response: { 200: 'http.empty', ...errors },
      detail: {
        summary: 'Publish a product',
        description: 'Publishes a draft product that satisfies publication requirements. Requires catalog:publish permission.',
        tags: ['Admin Products'], security: staffSecurity,
      },
    })
    .post('/:id/unpublish', ({ params, user, requestContext }) => service.unpublishProduct(
      params.id, productActor(user.id, requestContext),
    ), {
      browserMutation: 'admin',
      permission: { catalog: ['publish'] },
      params: 'product.idParams',
      response: { 200: 'http.empty', ...errors },
      detail: {
        summary: 'Unpublish a product',
        description: 'Returns a published product to draft and removes it from Store routes. Requires catalog:publish permission.',
        tags: ['Admin Products'], security: staffSecurity,
      },
    })
    .delete('/:id', ({ params, user, requestContext }) => service.archiveProduct(
      params.id, productActor(user.id, requestContext),
    ), {
      browserMutation: 'admin',
      permission: { catalog: ['delete'] },
      params: 'product.idParams',
      response: { 200: 'http.empty', ...errors },
      detail: {
        summary: 'Archive a product',
        description: 'Archives a product without physically deleting its product or variants. Requires catalog:delete permission.',
        tags: ['Admin Products'], security: staffSecurity,
      },
    })
    .post('/:id/variants', ({ params, body, user, requestContext, set }) => {
      set.status = 201
      return service.createVariant(params.id, body as CreateVariantInput, productActor(user.id, requestContext))
    }, {
      parse: [parseStrictJsonBody([
        'sku', 'name', 'unit', 'priceSatang', 'salesEnabled', 'displayOrder',
      ]), 'json'],
      browserMutation: 'admin',
      permission: { catalog: ['create'] },
      params: 'product.idParams',
      body: 'product.createVariantBody',
      response: { 201: 'product.adminVariant', ...errors },
      detail: {
        summary: 'Create a product variant',
        description: 'Creates a sellable product variant with a globally unique SKU. Requires catalog:create permission.',
        tags: ['Admin Products'], security: staffSecurity,
      },
    })
    .patch('/:id/variants/:variantId', ({ params, body, user, requestContext }) => service.updateVariant(
      params.id, params.variantId, body as UpdateVariantInput, productActor(user.id, requestContext),
    ), {
      parse: [parseStrictJsonBody([
        'name', 'unit', 'priceSatang', 'salesEnabled', 'displayOrder',
      ]), 'json'],
      browserMutation: 'admin',
      permission: { catalog: ['update'] },
      params: 'product.variantParams',
      body: 'product.updateVariantBody',
      response: { 200: 'product.adminVariant', ...errors },
      detail: {
        summary: 'Update a product variant',
        description: 'Updates an active variant, including its manual sales switch. Requires catalog:update permission.',
        tags: ['Admin Products'], security: staffSecurity,
      },
    })
    .delete('/:id/variants/:variantId', ({ params, user, requestContext }) => service.archiveVariant(
      params.id, params.variantId, productActor(user.id, requestContext),
    ), {
      browserMutation: 'admin',
      permission: { catalog: ['delete'] },
      params: 'product.variantParams',
      response: { 200: 'http.empty', ...errors },
      detail: {
        summary: 'Archive a product variant',
        description: 'Archives an active variant while preserving its SKU and stable ID. Requires catalog:delete permission.',
        tags: ['Admin Products'], security: staffSecurity,
      },
    })
}

export * from './model'
export * from './repository'
export * from './service'
export * from './types'
