import { describe, expect, it } from 'bun:test'
import { openapi } from '@elysia/openapi'
import { Elysia } from 'elysia'
import { loadConfig } from '../../src/config/env'
import { createAdminProductsModule, createStoreProductsModule } from '../../src/modules/products'
import type { ProductService } from '../../src/modules/products/service'
import type { Auth } from '../../src/plugins/auth/auth'
import { createErrorHandlingPlugin } from '../../src/plugins/error-handling'
import { DomainError } from '../../src/shared/domain-error'
import { testEnv } from '../fixtures'

const config = loadConfig(testEnv)
const productId = '00000000-0000-4000-8000-000000000001'
const variantId = '00000000-0000-4000-8000-000000000002'

const storeProduct = {
  id: productId,
  slug: 'nam-hom-coconut',
  name: 'น้ำมะพร้าว',
  englishName: 'Coconut water',
  category: 'fresh' as const,
  imageUrl: 'https://example.com/coconut.jpg',
  imageAlt: 'Fresh coconut',
  minPriceSatang: 2500,
}

const adminProduct = {
  id: storeProduct.id,
  slug: storeProduct.slug,
  name: storeProduct.name,
  englishName: storeProduct.englishName,
  category: storeProduct.category,
  imageUrl: storeProduct.imageUrl,
  imageAlt: storeProduct.imageAlt,
  description: 'Fresh coconut water',
  originStory: null,
  storageInstructions: null,
  status: 'draft' as const,
  createdAt: new Date('2026-09-26T00:00:00.000Z'),
  updatedAt: new Date('2026-09-26T00:00:00.000Z'),
  publishedAt: null,
  archivedAt: null,
  variants: [],
}

function createService(overrides: Record<string, (...args: never[]) => unknown> = {}) {
  const calls: string[] = []
  const service = {
    listStore: async () => { calls.push('listStore'); return { items: [storeProduct], nextCursor: null } },
    getStoreBySlug: async (slug: string) => {
      calls.push('getStoreBySlug')
      if (slug !== storeProduct.slug) throw new DomainError('PRODUCT_NOT_FOUND')
      return { ...storeProduct, description: 'Fresh coconut water', originStory: null, storageInstructions: null, variants: [
        { id: variantId, name: '1 litre', unit: 'bottle', priceSatang: 2500, displayOrder: 0, canPurchase: true },
      ] }
    },
    listAdmin: async () => { calls.push('listAdmin'); return { items: [], nextCursor: null } },
    getAdminById: async () => { calls.push('getAdminById'); return adminProduct },
    createProduct: async () => { calls.push('createProduct'); return adminProduct },
    updateProduct: async () => { calls.push('updateProduct'); return adminProduct },
    publishProduct: async () => { calls.push('publishProduct') },
    unpublishProduct: async () => { calls.push('unpublishProduct') },
    archiveProduct: async () => { calls.push('archiveProduct') },
    createVariant: async () => { calls.push('createVariant'); return { id: variantId, productId, sku: 'COCO-1L', name: '1 litre', unit: 'bottle', priceSatang: 2500, salesEnabled: true, displayOrder: 0, createdAt: adminProduct.createdAt, updatedAt: adminProduct.updatedAt, archivedAt: null } },
    updateVariant: async () => { calls.push('updateVariant'); return { id: variantId, productId, sku: 'COCO-1L', name: '1 litre', unit: 'bottle', priceSatang: 2500, salesEnabled: true, displayOrder: 0, createdAt: adminProduct.createdAt, updatedAt: adminProduct.updatedAt, archivedAt: null } },
    archiveVariant: async () => { calls.push('archiveVariant') },
    ...overrides,
  }
  return { service: service as unknown as ProductService, calls }
}

function createAuth() {
  const calls: string[] = []
  const auth = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        calls.push('getSession')
        const identity = headers.get('cookie')?.replace('session=', '')
        if (!identity) return null
        if (identity === 'customer') return {
          user: { id: 'customer-1', accountType: 'customer' as const }, session: { id: 'session-1' },
        }
        const role = identity === 'support' ? 'support' : 'catalog_manager'
        return {
          user: { id: 'staff-1', accountType: 'staff' as const },
          staff: { role, permissions: [] }, session: { id: 'session-1' },
        }
      },
      generateOpenAPISchema: async () => ({ components: {}, paths: {} }),
    },
    handler: async () => new Response(),
  }
  return { auth: auth as unknown as Auth, calls }
}

function createApp(service = createService(), auth = createAuth()) {
  const { service: productService, calls } = service
  return {
    service: productService,
    calls,
    auth,
    app: new Elysia()
      .use(openapi({ path: '/api/v1/docs', specPath: '/api/v1/openapi.json' }))
      .use(createErrorHandlingPlugin())
      .use(createStoreProductsModule(productService))
      .use(createAdminProductsModule(config, auth.auth, productService)),
  }
}

function request(path: string, init: RequestInit = {}, cookie?: string) {
  const headers = new Headers(init.headers)
  if (cookie) headers.set('cookie', `session=${cookie}`)
  if (init.body) headers.set('content-type', 'application/json')
  if (init.method && init.method !== 'GET') headers.set('origin', 'http://localhost:5184')
  return new Request(`http://localhost${path}`, { ...init, headers })
}

describe('products HTTP contracts', () => {
  it('serves only public product projections without resolving a session', async () => {
    const { app, auth, calls } = createApp()
    const response = await app.handle(request('/api/v1/store/products', {}, 'staff'))
    const body = await response.json() as { items: Array<Record<string, unknown>>; nextCursor: string | null }

    expect(response.status).toBe(200)
    expect(body).toEqual({ items: [storeProduct], nextCursor: null })
    expect(body.items[0]).not.toHaveProperty('status')
    expect(body.items[0]).not.toHaveProperty('archivedAt')
    expect(auth.calls).toEqual([])
    expect(calls).toEqual(['listStore'])
  })

  it('does not reveal a draft product through the public detail route', async () => {
    const { app, auth } = createApp()
    const response = await app.handle(request('/api/v1/store/products/draft-only', {}, 'staff'))

    expect(response.status).toBe(404)
    expect(auth.calls).toEqual([])
  })

  it('requires a staff session and catalog permission for admin reads', async () => {
    const { app } = createApp()
    const missing = await app.handle(request('/api/v1/admin/products'))
    const customer = await app.handle(request('/api/v1/admin/products', {}, 'customer'))

    expect(missing.status).toBe(401)
    expect(customer.status).toBe(403)
  })

  it('returns product details with the complete variant collection', async () => {
    const { app } = createApp()
    const response = await app.handle(request(`/api/v1/admin/products/${productId}`, {}, 'catalog_manager'))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: productId, variants: [] })
  })

  it('rejects customer and support product writes', async () => {
    const { app, calls } = createApp()
    const body = JSON.stringify({ slug: 'coconut', name: 'Coconut', category: 'fresh' })
    const customer = await app.handle(request('/api/v1/admin/products', { method: 'POST', body }, 'customer'))
    const support = await app.handle(request('/api/v1/admin/products', { method: 'POST', body }, 'support'))

    expect(customer.status).toBe(403)
    expect(support.status).toBe(403)
    expect(calls).toEqual([])
  })

  it('allows a catalog manager to create a product with a 201 response', async () => {
    let actor: Record<string, unknown> | undefined
    const observedCalls: string[] = []
    const service = createService({
      createProduct: async (_input: unknown, suppliedActor: unknown) => {
        observedCalls.push('createProduct')
        actor = suppliedActor as Record<string, unknown>
        return adminProduct
      },
    })
    const { app } = createApp(service)
    const response = await app.handle(request('/api/v1/admin/products', {
      method: 'POST',
      body: JSON.stringify({ slug: 'coconut', name: 'Coconut', category: 'fresh' }),
    }, 'catalog_manager'))

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ id: productId, status: 'draft' })
    expect(observedCalls).toEqual(['createProduct'])
    expect(actor).toMatchObject({
      userId: 'staff-1',
      auditContext: { requestId: expect.any(String), ipAddress: 'unknown', userAgent: null },
    })
  })

  it('rejects admin mutations from an untrusted Origin before calling the service', async () => {
    const { app, calls } = createApp()
    const response = await app.handle(new Request('http://localhost/api/v1/admin/products', {
      method: 'POST',
      headers: { cookie: 'session=catalog_manager', origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'coconut', name: 'Coconut', category: 'fresh' }),
    }))

    expect(response.status).toBe(403)
    expect(calls).toEqual([])
  })

  it('rejects invalid and unknown create fields before calling the service', async () => {
    const { app, calls } = createApp()
    const invalid = await app.handle(request('/api/v1/admin/products', {
      method: 'POST', body: JSON.stringify({ slug: 'coconut', name: 'Coconut', category: 'invalid' }),
    }, 'catalog_manager'))
    const unknown = await app.handle(request('/api/v1/admin/products', {
      method: 'POST', body: JSON.stringify({ slug: 'coconut', name: 'Coconut', category: 'fresh', status: 'published' }),
    }, 'catalog_manager'))
    const unknownQuery = await app.handle(request('/api/v1/admin/products?unexpected=field', {}, 'catalog_manager'))

    expect(invalid.status).toBe(422)
    expect(unknown.status).toBe(422)
    expect(unknownQuery.status).toBe(422)
    expect(calls).toEqual([])
  })

  it('documents all Store and Admin product routes with request and response schemas', async () => {
    const { app } = createApp()
    const response = await app.handle(request('/api/v1/openapi.json'))
    const document = await response.json() as {
      paths: Record<string, Record<string, { parameters?: unknown[]; requestBody?: unknown; responses?: Record<string, unknown> }>>
      components: { schemas: Record<string, { required?: string[] }> }
    }
    const routes: Array<[string, string]> = [
      ['/api/v1/store/products/', 'get'],
      ['/api/v1/store/products/{slug}', 'get'],
      ['/api/v1/admin/products/', 'get'],
      ['/api/v1/admin/products/{id}', 'get'],
      ['/api/v1/admin/products/', 'post'],
      ['/api/v1/admin/products/{id}', 'patch'],
      ['/api/v1/admin/products/{id}/publish', 'post'],
      ['/api/v1/admin/products/{id}/unpublish', 'post'],
      ['/api/v1/admin/products/{id}', 'delete'],
      ['/api/v1/admin/products/{id}/variants', 'post'],
      ['/api/v1/admin/products/{id}/variants/{variantId}', 'patch'],
      ['/api/v1/admin/products/{id}/variants/{variantId}', 'delete'],
    ]

    expect(response.status).toBe(200)
    for (const [path, method] of routes) {
      const operation = document.paths[path]?.[method]
      expect(operation).toBeDefined()
      expect(operation?.responses).toBeDefined()
      if (method !== 'get' && !path.endsWith('/publish') && !path.endsWith('/unpublish') && method !== 'delete') {
        expect(operation?.requestBody).toBeDefined()
      }
    }

    const storeSchema = JSON.stringify(document.components.schemas['product.storeDetail'])
    expect(storeSchema).not.toContain('status')
    expect(storeSchema).not.toContain('archivedAt')
    expect(document.components.schemas['product.adminProduct']?.required).toContain('variants')
  })
})
