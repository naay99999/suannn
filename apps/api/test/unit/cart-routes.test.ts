import { describe, expect, it } from 'bun:test'
import { createApp, type AppDependencies } from '../../src/app'
import { loadConfig } from '../../src/config/env'
import type { AuditService } from '../../src/modules/audit/service'
import type { CustomerSignupService } from '../../src/modules/auth/customer/service'
import type { StaffInvitationService } from '../../src/modules/auth/invitations/service'
import type { StaffMfaService } from '../../src/modules/auth/mfa/service'
import type { StaffService } from '../../src/modules/auth/staff/service'
import type { CartService } from '../../src/modules/cart/service'
import type { CartDetail, CartPrincipal } from '../../src/modules/cart/types'
import type { CustomerAddressService } from '../../src/modules/customer/addresses/service'
import type { CustomerEmailChangeService } from '../../src/modules/customer/email-change/service'
import type { CustomerProfileService } from '../../src/modules/customer/profile/service'
import type { InventoryService } from '../../src/modules/inventory/service'
import type { ProductService } from '../../src/modules/products/service'
import type { SystemSettingsService } from '../../src/modules/settings/service'
import type { Auth } from '../../src/plugins/auth/auth'
import type { RateLimiter } from '../../src/modules/rate-limit/service'
import { hashToken } from '../../src/shared/crypto'
import { testEnv } from '../fixtures'

const config = loadConfig(testEnv)
const variantId = '00000000-0000-4000-8000-000000000002'
const cart: CartDetail = { cartVersion: 0, lines: [] }

async function createHarness(options: { denyRateLimit?: boolean; secureCookies?: boolean } = {}) {
  const principals: CartPrincipal[] = []
  const mutations: string[] = []
  const mergeCalls: Array<{ userId: string; guestTokenHash: string }> = []
  const rateLimitCalls: unknown[] = []
  const service = {
    get: async (principal: CartPrincipal) => { principals.push(principal); return cart },
    setItem: async (principal: CartPrincipal) => { principals.push(principal); mutations.push('setItem'); return cart },
    removeItem: async (principal: CartPrincipal) => { principals.push(principal); mutations.push('removeItem'); return cart },
    mergeGuest: async (userId: string, guestTokenHash: string) => {
      mergeCalls.push({ userId, guestTokenHash })
      return { cart, skipped: [] }
    },
  }
  const auth = {
    api: {
      generateOpenAPISchema: async () => ({ components: {}, paths: {} }),
      getSession: async ({ headers }: { headers: Headers }) => {
        const session = headers.get('cookie')?.match(/(?:^|;\s*)session=([^;]+)/)?.[1]
        if (session === 'customer') {
          return { user: { id: 'customer-1', accountType: 'customer' as const }, session: { id: 'session-1' } }
        }
        if (session === 'staff') {
          return {
            user: { id: 'staff-1', accountType: 'staff' as const },
            staff: { role: 'support', permissions: [] },
            session: { id: 'session-2' },
          }
        }
        return null
      },
    },
    handler: async () => new Response(),
  } as unknown as Auth
  const limiter = {
    consume: async (input: unknown) => {
      rateLimitCalls.push(input)
      return {
        allowed: !options.denyRateLimit,
        remaining: options.denyRateLimit ? 0 : 9,
        retryAfterSeconds: 60,
        resetAt: new Date('2026-09-27T00:01:00Z'),
      }
    },
  } as unknown as RateLimiter
  const dependencies = {
    auth,
    audit: {} as AuditService,
    customerSignup: {} as CustomerSignupService,
    customerProfile: {} as CustomerProfileService,
    customerAddresses: {} as CustomerAddressService,
    customerEmailChange: {} as CustomerEmailChangeService,
    staffInvitations: {} as StaffInvitationService,
    staffMfa: {} as StaffMfaService,
    staff: {} as StaffService,
    systemSettings: {} as SystemSettingsService,
    products: {} as ProductService,
    inventory: {} as InventoryService,
    cart: service as unknown as CartService,
    staffMfaRequired: async () => true,
    identityReservations: { findState: async () => null },
    limiter,
  } as unknown as AppDependencies
  const appConfig = { ...config, secureCookies: options.secureCookies ?? config.secureCookies }
  const app = await createApp(appConfig, dependencies)

  return { app, principals, mutations, mergeCalls, rateLimitCalls }
}

function request(path: string, init: RequestInit = {}, cookie?: string, origin = config.storefrontUrl) {
  const headers = new Headers(init.headers)
  if (cookie) headers.set('cookie', cookie)
  if (init.method && init.method !== 'GET') {
    headers.set('content-type', 'application/json')
    headers.set('origin', origin)
  }
  return new Request(`http://localhost${path}`, { ...init, headers })
}

describe('store cart HTTP contract', () => {
  it('returns an empty cart for an anonymous read without creating a guest cookie', async () => {
    const harness = await createHarness()
    const response = await harness.app.handle(request('/api/v1/store/cart'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(cart)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(harness.principals[0]).toMatchObject({ kind: 'guest' })
    expect(harness.mutations).toEqual([])
  })

  it('uses a customer session ahead of a guest cart cookie', async () => {
    const harness = await createHarness()
    const response = await harness.app.handle(request(
      '/api/v1/store/cart', {}, 'session=customer; suannn_cart=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ))

    expect(response.status).toBe(200)
    expect(harness.principals).toEqual([{ kind: 'customer', userId: 'customer-1' }])
  })

  it('rejects a staff session from the customer cart', async () => {
    const harness = await createHarness()
    const response = await harness.app.handle(request('/api/v1/store/cart', {}, 'session=staff'))

    expect(response.status).toBe(403)
    expect(harness.principals).toEqual([])
  })

  it('creates a 256-bit HttpOnly guest cookie on the first item mutation', async () => {
    const harness = await createHarness()
    const response = await harness.app.handle(request('/api/v1/store/cart/items/' + variantId, {
      method: 'PUT', body: JSON.stringify({ quantity: 2 }),
    }))
    const setCookie = response.headers.get('set-cookie') ?? ''
    const token = setCookie.match(/suannn_cart=([^;]+)/)?.[1]

    expect(response.status).toBe(200)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Max-Age=2592000')
    expect(setCookie).toContain('Path=/api/v1/store;')
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(harness.principals).toEqual([{ kind: 'guest', tokenHash: hashToken(token!) }])
    expect(await response.text()).not.toContain(token!)
  })

  it('does not create a guest cookie when a customer mutates their cart', async () => {
    const harness = await createHarness()
    const response = await harness.app.handle(request(`/api/v1/store/cart/items/${variantId}`, {
      method: 'PUT', body: JSON.stringify({ quantity: 1 }),
    }, 'session=customer'))

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(harness.principals).toEqual([{ kind: 'customer', userId: 'customer-1' }])
  })

  it('marks guest cart cookies Secure in production cookie configuration', async () => {
    const harness = await createHarness({ secureCookies: true })
    const response = await harness.app.handle(request(`/api/v1/store/cart/items/${variantId}`, {
      method: 'PUT', body: JSON.stringify({ quantity: 1 }),
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('Secure')
  })

  it('supports DELETE with a guest cookie', async () => {
    const harness = await createHarness()
    const token = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const response = await harness.app.handle(request(
      `/api/v1/store/cart/items/${variantId}`, { method: 'DELETE' }, `suannn_cart=${token}`,
    ))

    expect(response.status).toBe(200)
    expect(harness.mutations).toEqual(['removeItem'])
    expect(harness.principals).toEqual([{ kind: 'guest', tokenHash: hashToken(token) }])
    expect(response.headers.get('set-cookie')).toContain(`suannn_cart=${token}`)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=2592000')
  })

  it('rejects unknown body fields and malformed variant IDs with 422', async () => {
    const harness = await createHarness()
    const unknownField = await harness.app.handle(request(`/api/v1/store/cart/items/${variantId}`, {
      method: 'PUT', body: JSON.stringify({ quantity: 2, priceSatang: 1 }),
    }))
    const invalidId = await harness.app.handle(request('/api/v1/store/cart/items/not-a-uuid', {
      method: 'PUT', body: JSON.stringify({ quantity: 2 }),
    }))

    expect(unknownField.status).toBe(422)
    expect(invalidId.status).toBe(422)
    expect(harness.mutations).toEqual([])
  })

  it('rejects storefront mutations from an untrusted origin before changing the cart', async () => {
    const harness = await createHarness()
    const response = await harness.app.handle(request(`/api/v1/store/cart/items/${variantId}`, {
      method: 'PUT', body: JSON.stringify({ quantity: 1 }),
    }, undefined, 'https://attacker.example'))

    expect(response.status).toBe(403)
    expect(harness.mutations).toEqual([])
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('allows only a customer session to merge a guest cart and consumes its cookie', async () => {
    const harness = await createHarness()
    const token = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBQ'
    const response = await harness.app.handle(request('/api/v1/store/cart/merge', {
      method: 'POST', body: '{}',
    }, `session=customer; suannn_cart=${token}`))

    expect(response.status).toBe(200)
    expect(harness.mergeCalls).toEqual([{ userId: 'customer-1', guestTokenHash: hashToken(token) }])
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(response.headers.get('set-cookie')).toContain('Path=/api/v1/store;')
    expect(await response.text()).not.toContain(token)
  })

  it('requires customer authentication to merge and rejects staff', async () => {
    const harness = await createHarness()
    const anonymous = await harness.app.handle(request('/api/v1/store/cart/merge', { method: 'POST', body: '{}' }))
    const staff = await harness.app.handle(request('/api/v1/store/cart/merge', {
      method: 'POST', body: '{}',
    }, 'session=staff'))

    expect(anonymous.status).toBe(401)
    expect(staff.status).toBe(403)
    expect(harness.mergeCalls).toEqual([])
  })

  it('rate limits guest mutations before issuing a cart cookie', async () => {
    const harness = await createHarness({ denyRateLimit: true })
    const response = await harness.app.handle(request(`/api/v1/store/cart/items/${variantId}`, {
      method: 'PUT', body: JSON.stringify({ quantity: 1 }),
    }))

    expect(response.status).toBe(429)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(harness.mutations).toEqual([])
    expect(harness.rateLimitCalls).toHaveLength(1)
  })

  it('documents typed cart responses and no guest token field', async () => {
    const harness = await createHarness()
    const response = await harness.app.handle(new Request('http://localhost/api/v1/openapi.json'))
    const document = await response.text()

    expect(response.status).toBe(200)
    expect(document).toContain('/api/v1/store/cart/items/{variantId}')
    expect(document).toContain('cartVersion')
    expect(document).not.toContain('tokenHash')
    expect(document).not.toContain('guestToken')
  })

  it('allows credentialed cart CORS only from the storefront origin', async () => {
    const harness = await createHarness()
    const makePreflight = (origin: string) => new Request('http://localhost/api/v1/store/cart', {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'GET' },
    })
    const store = await harness.app.handle(makePreflight(config.storefrontUrl))
    const admin = await harness.app.handle(makePreflight(config.adminUrl))

    expect(store.status).toBe(204)
    expect(store.headers.get('access-control-allow-origin')).toBe(config.storefrontUrl)
    expect(store.headers.get('access-control-allow-credentials')).toBe('true')
    expect(admin.status).toBe(204)
    expect(admin.headers.get('access-control-allow-origin')).toBeNull()
  })
})
