import { describe, expect, it } from 'bun:test'
import { createApp, type AppDependencies } from '../../src/app'
import { loadConfig } from '../../src/config/env'
import type { Auth } from '../../src/plugins/auth/auth'
import { DomainError } from '../../src/shared/domain-error'
import { testEnv } from '../fixtures'

const config = loadConfig(testEnv)
const customerOrderId = '00000000-0000-4000-8000-000000000010'
const guestOrderId = '00000000-0000-4000-8000-000000000011'
const orderItemId = '00000000-0000-4000-8000-000000000012'
const variantId = '00000000-0000-4000-8000-000000000020'
const guestCartToken = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

const guestOrder = {
  id: guestOrderId,
  orderNumber: 'SN-20260927-0001',
  status: 'placed',
  customerId: null,
  contactEmail: 'guest@example.com',
  contactPhone: '+66812345678',
  recipientName: 'Somchai',
  addressLine1: '1 Main Road',
  addressLine2: null,
  subdistrict: 'Suthep',
  district: 'Mueang Chiang Mai',
  province: 'Chiang Mai',
  postalCode: '50200',
  subtotalSatang: 2500,
  shippingSatang: 500,
  totalSatang: 3000,
  currency: 'THB',
  paymentMethod: 'cod',
  createdAt: '2026-09-27T00:00:00.000Z',
  items: [{
    id: orderItemId,
    productId: '00000000-0000-4000-8000-000000000021',
    variantId,
    sku: 'COCO-1L',
    productName: 'Coconut water',
    variantName: '1 litre',
    unit: 'bottle',
    unitPriceSatang: 2500,
    quantity: 1,
    lineTotalSatang: 2500,
  }],
}

const guestDetail = {
  ...guestOrder,
  payment: {
    id: '00000000-0000-4000-8000-000000000030',
    method: 'cod',
    provider: 'cod',
    amountSatang: 3000,
    currency: 'THB',
    status: 'awaiting_collection',
  },
}

const customerOrder = { ...guestOrder, id: customerOrderId, customerId: 'customer-1' }
const customerDetail = { ...guestDetail, id: customerOrderId, customerId: 'customer-1' }
const quote = {
  cartVersion: 3,
  settingsVersion: 2,
  currency: 'THB',
  lines: [{
    variantId,
    productId: '00000000-0000-4000-8000-000000000021',
    productName: 'Coconut water',
    variantName: '1 litre',
    unit: 'bottle',
    quantity: 1,
    unitPriceSatang: 2500,
    lineTotalSatang: 2500,
  }],
  subtotalSatang: 2500,
  shippingSatang: 500,
  totalSatang: 3000,
  expiresAt: '2026-09-27T00:15:00.000Z',
  quoteToken: 'signed-quote',
}

const validCheckoutBody = {
  quoteToken: 'signed-quote',
  paymentMethod: 'cod',
  contact: { email: 'guest@example.com', phone: '+66812345678' },
  address: {
    recipientName: 'Somchai',
    addressLine1: '1 Main Road',
    subdistrict: 'Suthep',
    district: 'Mueang Chiang Mai',
    province: 'Chiang Mai',
    postalCode: '50200',
  },
}

function createHarness(options: {
  denyRateLimit?: boolean
  quoteError?: string
  checkoutError?: string
} = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const rateLimitCalls: Array<Record<string, unknown>> = []
  const quoteService = {
    create: async (...args: unknown[]) => {
      calls.push({ method: 'quote.create', args })
      if (options.quoteError) throw new DomainError(options.quoteError as never)
      return quote
    },
  }
  const checkoutService = {
    placeCod: async (...args: unknown[]) => {
      calls.push({ method: 'checkout.placeCod', args })
      if (options.checkoutError) throw new DomainError(options.checkoutError as never)
      const principal = args[1] as { kind: string }
      return {
        order: principal.kind === 'customer' ? customerOrder : guestOrder,
        ...(principal.kind === 'guest' ? { guestAccessToken: 'guest-access-secret' } : {}),
      }
    },
  }
  const ordersService = {
    listCustomer: async (...args: unknown[]) => {
      calls.push({ method: 'orders.listCustomer', args })
      return { items: [customerDetail], nextCursor: null }
    },
    getForPrincipal: async (...args: unknown[]) => {
      calls.push({ method: 'orders.getForPrincipal', args })
      const [orderId, principal] = args as [string, { kind: string; userId?: string; accessToken?: string }]
      if (orderId === customerOrderId && principal.kind === 'customer' && principal.userId === 'customer-1') {
        return customerDetail
      }
      if (orderId === guestOrderId && principal.kind === 'guest' && principal.accessToken === 'guest-access-secret') {
        return guestDetail
      }
      if (orderId === guestOrderId && principal.kind === 'customer') throw new DomainError('ORDER_ACCESS_DENIED')
      throw new DomainError('ORDER_NOT_FOUND')
    },
    cancel: async (...args: unknown[]) => {
      calls.push({ method: 'orders.cancel', args })
      return guestDetail
    },
  }
  const auth = {
    handler: async () => new Response(),
    api: {
      generateOpenAPISchema: async () => ({ components: {}, paths: {} }),
      getSession: async ({ headers }: { headers: Headers }) => {
        const value = headers.get('cookie')?.match(/(?:^|;\s*)session=([^;]+)/)?.[1]
        if (value === 'customer') {
          return { user: { id: 'customer-1', accountType: 'customer' as const }, session: { id: 'session-customer' } }
        }
        if (value === 'empty-customer') {
          return { user: { id: ' ', accountType: 'customer' as const }, session: { id: 'session-customer' } }
        }
        if (value === 'staff') {
          return {
            user: { id: 'staff-1', accountType: 'staff' as const },
            staff: { role: 'support', permissions: [] },
            session: { id: 'session-staff' },
          }
        }
        return null
      },
    },
  } as unknown as Auth
  const limiter = {
    consume: async (input: Record<string, unknown>) => {
      rateLimitCalls.push(input)
      return {
        allowed: !options.denyRateLimit,
        remaining: options.denyRateLimit ? 0 : 9,
        retryAfterSeconds: 60,
        resetAt: new Date('2026-09-27T00:01:00Z'),
      }
    },
  }
  const empty = {} as never
  const dependencies = {
    auth,
    audit: empty,
    customerSignup: empty,
    customerProfile: empty,
    customerAddresses: empty,
    customerEmailChange: empty,
    staffInvitations: empty,
    staffMfa: empty,
    staff: empty,
    systemSettings: empty,
    products: empty,
    inventory: empty,
    cart: { get: async () => ({ cartVersion: 3, lines: [] }) },
    quote: quoteService,
    checkout: checkoutService,
    orders: ordersService,
    staffMfaRequired: async () => true,
    identityReservations: { findState: async () => null },
    limiter,
  } as unknown as AppDependencies
  const appPromise = createApp(config, dependencies)

  return { appPromise, calls, rateLimitCalls }
}

function request(path: string, init: RequestInit = {}, cookie?: string, origin = config.storefrontUrl) {
  const headers = new Headers(init.headers)
  if (cookie) headers.set('cookie', cookie)
  if (init.body) headers.set('content-type', 'application/json')
  if (init.method && init.method !== 'GET') headers.set('origin', origin)
  return new Request(`http://localhost${path}`, { ...init, headers })
}

function checkoutRequest(body: unknown, cookie = `suannn_cart=${guestCartToken}`, key = 'checkout-1', origin = config.storefrontUrl) {
  return request('/api/v1/store/checkout/orders', {
    method: 'POST',
    headers: key ? { 'idempotency-key': key } : {},
    body: JSON.stringify(body),
  }, cookie, origin)
}

describe('store checkout and order HTTP contracts', () => {
  it('mounts the quote, create, customer list, detail, and cancel paths with public projections', async () => {
    const { appPromise } = createHarness()
    const app = await appPromise

    const quoteResponse = await app.handle(request('/api/v1/store/checkout/quote', {
      method: 'POST', body: '{}',
    }, `suannn_cart=${guestCartToken}`))
    const createResponse = await app.handle(checkoutRequest(validCheckoutBody))
    const listResponse = await app.handle(request('/api/v1/store/orders', {}, 'session=customer'))
    const detailResponse = await app.handle(request(`/api/v1/store/orders/${guestOrderId}`, {
      headers: { 'x-order-access-token': 'guest-access-secret' },
    }))
    const cancelResponse = await app.handle(request(`/api/v1/store/orders/${guestOrderId}/cancel`, {
      method: 'POST',
      headers: { 'x-order-access-token': 'guest-access-secret', 'idempotency-key': 'cancel-1' },
      body: '{}',
    }))
    const created = await createResponse.json() as Record<string, unknown>
    const detail = await detailResponse.json() as Record<string, unknown>

    expect(quoteResponse.status).toBe(200)
    expect(await quoteResponse.json()).toEqual(quote)
    expect(createResponse.status).toBe(201)
    expect(created).toHaveProperty('guestAccessToken', 'guest-access-secret')
    expect(listResponse.status).toBe(200)
    expect(detailResponse.status).toBe(200)
    expect(detail).not.toHaveProperty('guestAccessToken')
    expect(detail).not.toHaveProperty('guestAccessTokenHash')
    expect(cancelResponse.status).toBe(200)
  })

  it('accepts only the strict checkout contact and Thai address shapes', async () => {
    const { appPromise, calls } = createHarness()
    const app = await appPromise
    const withClientTotal = await app.handle(checkoutRequest({ ...validCheckoutBody, totalSatang: 1 }))
    const invalidContact = await app.handle(checkoutRequest({
      ...validCheckoutBody,
      contact: { email: 'not-email', phone: '+66812345678' },
    }))
    const invalidAddress = await app.handle(checkoutRequest({
      ...validCheckoutBody,
      address: { ...validCheckoutBody.address, postalCode: '5020' },
    }))
    const unknownAddressField = await app.handle(checkoutRequest({
      ...validCheckoutBody,
      address: { ...validCheckoutBody.address, country: 'TH' },
    }))
    const malformedSavedAddressId = await app.handle(checkoutRequest({
      ...validCheckoutBody,
      address: { addressId: 'not-a-uuid' },
    }, 'session=customer'))

    expect(withClientTotal.status).toBe(422)
    expect(invalidContact.status).toBe(422)
    expect(invalidAddress.status).toBe(422)
    expect(unknownAddressField.status).toBe(422)
    expect(malformedSavedAddressId.status).toBe(422)
    expect(calls.some((call) => call.method === 'checkout.placeCod')).toBe(false)
  })

  it('rejects unknown quote fields and malformed order IDs before service calls', async () => {
    const { appPromise, calls } = createHarness()
    const app = await appPromise
    const unknownQuoteField = await app.handle(request('/api/v1/store/checkout/quote', {
      method: 'POST', body: JSON.stringify({ cartId: guestOrderId }),
    }, `suannn_cart=${guestCartToken}`))
    const malformedOrderId = await app.handle(request('/api/v1/store/orders/not-a-uuid', {
      headers: { 'x-order-access-token': 'guest-access-secret' },
    }))

    expect(unknownQuoteField.status).toBe(422)
    expect(malformedOrderId.status).toBe(422)
    expect(calls).toEqual([])
  })

  it('requires Idempotency-Key before placing an order', async () => {
    const { appPromise, calls } = createHarness()
    const app = await appPromise
    const response = await app.handle(checkoutRequest(validCheckoutBody, undefined, ''))

    expect(response.status).toBe(422)
    expect(calls.some((call) => call.method === 'checkout.placeCod')).toBe(false)
  })

  it('requires Idempotency-Key before cancelling an order', async () => {
    const { appPromise, calls } = createHarness()
    const app = await appPromise
    const response = await app.handle(request(`/api/v1/store/orders/${guestOrderId}/cancel`, {
      method: 'POST',
      headers: { 'x-order-access-token': 'guest-access-secret' },
      body: '{}',
    }))

    expect(response.status).toBe(422)
    expect(calls.some((call) => call.method === 'orders.cancel')).toBe(false)
  })

  it('maps a stale quote to 409 without changing the route contract', async () => {
    const { appPromise, calls } = createHarness({ checkoutError: 'QUOTE_STALE' })
    const app = await appPromise
    const response = await app.handle(checkoutRequest(validCheckoutBody))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ code: 'QUOTE_STALE', message: 'Checkout quote is expired or no longer current' })
    expect(calls.some((call) => call.method === 'checkout.placeCod')).toBe(true)
  })

  it('requires customer auth for the order list and rejects staff sessions', async () => {
    const { appPromise, calls } = createHarness()
    const app = await appPromise
    const anonymous = await app.handle(request('/api/v1/store/orders'))
    const staff = await app.handle(request('/api/v1/store/orders', {}, 'session=staff'))
    const customer = await app.handle(request('/api/v1/store/orders?limit=20', {}, 'session=customer'))

    expect(anonymous.status).toBe(401)
    expect(staff.status).toBe(403)
    expect(customer.status).toBe(200)
    expect(calls.find((call) => call.method === 'orders.listCustomer')?.args).toEqual(['customer-1', undefined, 20])
  })

  it('uses customer ownership ahead of guest tokens and keeps invalid guest access indistinguishable as 404', async () => {
    const { appPromise, calls } = createHarness()
    const app = await appPromise
    const guestOrderWithCustomerToken = await app.handle(request(`/api/v1/store/orders/${guestOrderId}`, {
      headers: { 'x-order-access-token': 'guest-access-secret' },
    }, 'session=customer'))
    const staff = await app.handle(request(`/api/v1/store/orders/${guestOrderId}`, {
      headers: { 'x-order-access-token': 'guest-access-secret' },
    }, 'session=staff'))
    const cartCookieOnly = await app.handle(request(`/api/v1/store/orders/${guestOrderId}`, {}, `suannn_cart=${guestCartToken}`))
    const invalidToken = await app.handle(request(`/api/v1/store/orders/${guestOrderId}`, {
      headers: { 'x-order-access-token': 'wrong-token' },
    }))
    const unknownOrder = await app.handle(request('/api/v1/store/orders/00000000-0000-4000-8000-000000000099', {
      headers: { 'x-order-access-token': 'wrong-token' },
    }))
    const ownedCustomerOrder = await app.handle(request(`/api/v1/store/orders/${customerOrderId}`, {}, 'session=customer'))
    const invalidCustomerSession = await app.handle(request(`/api/v1/store/orders/${guestOrderId}`, {
      headers: { 'x-order-access-token': 'guest-access-secret' },
    }, 'session=empty-customer'))

    expect(guestOrderWithCustomerToken.status).toBe(403)
    expect(staff.status).toBe(403)
    expect(cartCookieOnly.status).toBe(404)
    expect(invalidToken.status).toBe(404)
    expect(await invalidToken.json()).toEqual(await unknownOrder.json())
    expect(ownedCustomerOrder.status).toBe(200)
    expect(invalidCustomerSession.status).toBe(401)
    const customerCall = calls.find((call) => call.method === 'orders.getForPrincipal' && call.args[0] === guestOrderId)
    expect(customerCall?.args[1]).toEqual({ kind: 'customer', userId: 'customer-1' })
  })

  it('binds checkout quotes and order placement to the authenticated customer session', async () => {
    const { appPromise, calls } = createHarness()
    const app = await appPromise
    const quoteResponse = await app.handle(request('/api/v1/store/checkout/quote', {
      method: 'POST', body: '{}',
    }, `session=customer; suannn_cart=${guestCartToken}`))
    const createResponse = await app.handle(checkoutRequest(validCheckoutBody, 'session=customer'))
    const invalidCustomerSession = await app.handle(request('/api/v1/store/checkout/quote', {
      method: 'POST', body: '{}',
    }, `session=empty-customer; suannn_cart=${guestCartToken}`))
    const created = await createResponse.json() as Record<string, unknown>

    expect(quoteResponse.status).toBe(200)
    expect(createResponse.status).toBe(201)
    expect(invalidCustomerSession.status).toBe(401)
    expect(created).not.toHaveProperty('guestAccessToken')
    expect(calls.find((call) => call.method === 'quote.create')?.args[0]).toEqual({ kind: 'customer', userId: 'customer-1' })
    expect(calls.find((call) => call.method === 'checkout.placeCod')?.args[1]).toEqual({ kind: 'customer', userId: 'customer-1' })
  })

  it('guards storefront mutations by Origin before quote, checkout, and cancellation service calls', async () => {
    const { appPromise, calls } = createHarness()
    const app = await appPromise
    const quoteResponse = await app.handle(request('/api/v1/store/checkout/quote', {
      method: 'POST', body: '{}',
    }, `suannn_cart=${guestCartToken}`, 'https://attacker.example'))
    const createResponse = await app.handle(checkoutRequest(validCheckoutBody, `suannn_cart=${guestCartToken}`, 'checkout-1', 'https://attacker.example'))
    const cancelResponse = await app.handle(request(`/api/v1/store/orders/${guestOrderId}/cancel`, {
      method: 'POST',
      headers: { 'x-order-access-token': 'guest-access-secret', 'idempotency-key': 'cancel-1' },
      body: '{}',
    }, undefined, 'https://attacker.example'))

    expect([quoteResponse.status, createResponse.status, cancelResponse.status]).toEqual([403, 403, 403])
    expect(calls).toEqual([])
  })

  it('rate-limits guest quote, checkout, and order access requests', async () => {
    const { appPromise, calls, rateLimitCalls } = createHarness({ denyRateLimit: true })
    const app = await appPromise
    const quoteResponse = await app.handle(request('/api/v1/store/checkout/quote', {
      method: 'POST', body: '{}',
    }, `suannn_cart=${guestCartToken}`))
    const createResponse = await app.handle(checkoutRequest(validCheckoutBody))
    const orderResponse = await app.handle(request(`/api/v1/store/orders/${guestOrderId}`, {
      headers: { 'x-order-access-token': 'guest-access-secret' },
    }))
    const cancelResponse = await app.handle(request(`/api/v1/store/orders/${guestOrderId}/cancel`, {
      method: 'POST',
      headers: { 'x-order-access-token': 'guest-access-secret', 'idempotency-key': 'cancel-1' },
      body: '{}',
    }))

    expect([quoteResponse.status, createResponse.status, orderResponse.status, cancelResponse.status]).toEqual([429, 429, 429, 429])
    expect(rateLimitCalls).toHaveLength(4)
    expect(calls).toEqual([])
  })

  it('documents typed public store schemas without credential or provider secret fields', async () => {
    const { appPromise } = createHarness()
    const app = await appPromise
    const response = await app.handle(new Request('http://localhost/api/v1/openapi.json'))
    const document = await response.json() as { paths: Record<string, Record<string, Record<string, unknown>>>; components: { schemas: Record<string, unknown> } }
    const serialized = JSON.stringify(document)

    expect(response.status).toBe(200)
    for (const [path, method] of [
      ['/api/v1/store/checkout/quote', 'post'],
      ['/api/v1/store/checkout/orders', 'post'],
      ['/api/v1/store/orders/', 'get'],
      ['/api/v1/store/orders/{orderId}', 'get'],
      ['/api/v1/store/orders/{orderId}/cancel', 'post'],
    ]) {
      expect(document.paths[path]?.[method]).toBeDefined()
      expect(document.paths[path]?.[method]?.responses).toBeDefined()
    }
    expect(JSON.stringify(document.paths['/api/v1/store/checkout/orders']?.post).toLowerCase()).toContain('idempotency-key')
    expect(serialized).not.toContain('guestAccessTokenHash')
    expect(serialized).not.toContain('guestAccessTokenNonce')
    expect(serialized).not.toContain('COMMERCE_SECRET')
    expect(serialized).not.toContain('providerSecret')
  })
})
