import { describe, expect, it } from 'bun:test'
import { createApp, type AppDependencies } from '../../src/app'
import { loadConfig } from '../../src/config/env'
import type { Auth } from '../../src/plugins/auth/auth'
import { testEnv } from '../fixtures'

const config = loadConfig(testEnv)
const orderId = '00000000-0000-4000-8000-000000000010'
const orderItemId = '00000000-0000-4000-8000-000000000012'
const variantId = '00000000-0000-4000-8000-000000000020'
const detail = {
  id: orderId,
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
  payment: {
    id: '00000000-0000-4000-8000-000000000030',
    method: 'cod',
    provider: 'cod',
    amountSatang: 3000,
    currency: 'THB',
    status: 'awaiting_collection',
  },
}
const page = { items: [detail], nextCursor: null }
const commerceSettings = {
  id: 1,
  shippingFeeSatang: 500,
  checkoutEnabled: false,
  version: 1,
  updatedAt: new Date('2026-09-27T00:00:00.000Z'),
}

function createHarness(role = 'owner') {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const orders = {
    listStaff: async (...args: unknown[]) => { calls.push({ method: 'orders.listStaff', args }); return page },
    getForPrincipal: async (...args: unknown[]) => { calls.push({ method: 'orders.getForPrincipal', args }); return detail },
    advanceFulfillment: async (...args: unknown[]) => { calls.push({ method: 'orders.advanceFulfillment', args }); return detail },
    cancel: async (...args: unknown[]) => { calls.push({ method: 'orders.cancel', args }); return detail },
    collectCod: async (...args: unknown[]) => { calls.push({ method: 'orders.collectCod', args }); return detail },
    reissueGuestAccess: async (...args: unknown[]) => {
      calls.push({ method: 'orders.reissueGuestAccess', args })
      return { ...detail, guestAccessToken: 'guest-access-secret' }
    },
    revokeGuestAccess: async (...args: unknown[]) => { calls.push({ method: 'orders.revokeGuestAccess', args }); return detail },
  }
  const stripeRefunds = {
    requestFullRefund: async (...args: unknown[]) => {
      calls.push({ method: 'stripeRefunds.requestFullRefund', args })
      return {
        ...detail,
        payment: {
          ...detail.payment,
          method: 'stripe',
          provider: 'stripe',
          status: 'collected',
          refund: {
            id: '00000000-0000-4000-8000-000000000031',
            amountSatang: 3000,
            status: 'pending',
            createdAt: '2026-09-27T00:00:00.000Z',
            updatedAt: '2026-09-27T00:00:00.000Z',
          },
        },
      }
    },
  }
  const settings = {
    get: async (...args: unknown[]) => { calls.push({ method: 'settings.get', args }); return commerceSettings },
    update: async (...args: unknown[]) => { calls.push({ method: 'settings.update', args }); return commerceSettings },
  }
  const auth = {
    handler: async () => new Response(),
    api: {
      generateOpenAPISchema: async () => ({ components: {}, paths: {} }),
      getSession: async ({ headers }: { headers: Headers }) => {
        const identity = headers.get('cookie')?.match(/(?:^|;\s*)session=([^;]+)/)?.[1]
        if (!identity) return null
        if (identity === 'customer') {
          return { user: { id: 'customer-1', accountType: 'customer' as const }, session: { id: 'session-customer' } }
        }
        if (identity === 'inactive-staff') {
          return { user: { id: 'staff-1', accountType: 'staff' as const }, session: { id: 'session-staff' } }
        }
        return {
          user: { id: 'staff-1', accountType: 'staff' as const },
          staff: { role: identity === 'staff' ? role : identity, permissions: [] },
          session: { id: 'session-staff' },
        }
      },
    },
  } as unknown as Auth
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
    cart: empty,
    quote: empty,
    checkout: empty,
    orders,
    stripeRefunds,
    commerceSettings: settings,
    staffMfaRequired: async () => true,
    identityReservations: { findState: async () => null },
    limiter: empty,
  } as unknown as AppDependencies

  return createApp(config, dependencies).then((app) => ({ app, calls }))
}

function request(path: string, init: RequestInit = {}, identity = 'staff', origin = config.adminUrl) {
  const headers = new Headers(init.headers)
  if (identity) headers.set('cookie', `session=${identity}`)
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  if (init.method && init.method !== 'GET') headers.set('origin', origin)
  return new Request(`http://localhost${path}`, { ...init, headers })
}

function command(path: string, body: unknown, identity = 'staff', key = 'command-1', origin = config.adminUrl) {
  return request(path, {
    method: 'POST',
    headers: key ? { 'idempotency-key': key } : {},
    body: JSON.stringify(body),
  }, identity, origin)
}

describe('admin order and commerce settings HTTP contracts', () => {
  it('mounts staff order lifecycle and commerce settings routes with session-derived actor data', async () => {
    const { app, calls } = await createHarness()
    const paths = [
      ['/api/v1/admin/orders', 'GET'],
      [`/api/v1/admin/orders/${orderId}`, 'GET'],
      [`/api/v1/admin/orders/${orderId}/fulfillment`, 'POST'],
      [`/api/v1/admin/orders/${orderId}/cancel`, 'POST'],
      [`/api/v1/admin/orders/${orderId}/collect-cod`, 'POST'],
      [`/api/v1/admin/orders/${orderId}/guest-access/reissue`, 'POST'],
      [`/api/v1/admin/orders/${orderId}/guest-access/revoke`, 'POST'],
      ['/api/v1/admin/commerce-settings', 'GET'],
      ['/api/v1/admin/commerce-settings', 'PUT'],
    ] as const
    const responses = await Promise.all(paths.map(([path, method]) => app.handle(request(path, {
      method,
      ...(method === 'POST' ? {
        headers: { 'idempotency-key': 'command-1' },
        body: JSON.stringify(path.endsWith('/fulfillment')
          ? { status: 'processing' }
          : path.endsWith('/collect-cod')
            ? { amountSatang: 3000 }
            : path.endsWith('/guest-access/reissue') || path.endsWith('/guest-access/revoke')
              ? { reasonCode: 'customer_request' }
              : {}),
      } : method === 'PUT' ? {
        body: JSON.stringify({ shippingFeeSatang: 500, checkoutEnabled: false }),
      } : {}),
    }, 'staff'))))

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200])
    expect(calls.map(({ method }) => method).sort()).toEqual([
      'orders.listStaff', 'orders.getForPrincipal', 'orders.advanceFulfillment', 'orders.cancel',
      'orders.collectCod', 'orders.reissueGuestAccess', 'orders.revokeGuestAccess',
      'settings.get', 'settings.update',
    ].sort())
    const listCall = calls.find(({ method }) => method === 'orders.listStaff')
    const fulfillmentCall = calls.find(({ method }) => method === 'orders.advanceFulfillment')
    const cancelCall = calls.find(({ method }) => method === 'orders.cancel')
    const collectCall = calls.find(({ method }) => method === 'orders.collectCod')
    const reissueCall = calls.find(({ method }) => method === 'orders.reissueGuestAccess')
    const revokeCall = calls.find(({ method }) => method === 'orders.revokeGuestAccess')
    const updateCall = calls.find(({ method }) => method === 'settings.update')
    expect(listCall?.args).toEqual([{
      kind: 'staff', userId: 'staff-1',
      auditContext: { requestId: expect.any(String), ipAddress: expect.any(String), userAgent: null },
    }, undefined, 50])
    expect(fulfillmentCall?.args[1]).toBe('processing')
    expect(fulfillmentCall?.args[2]).toMatchObject({ userId: 'staff-1', auditContext: { requestId: expect.any(String) } })
    expect(fulfillmentCall?.args[3]).toBe('command-1')
    expect(cancelCall?.args[1]).toMatchObject({ kind: 'staff', userId: 'staff-1', auditContext: { requestId: expect.any(String) } })
    expect(cancelCall?.args[2]).toBe('command-1')
    expect(collectCall?.args[1]).toBe(3000)
    expect(collectCall?.args[2]).toMatchObject({ kind: 'staff', userId: 'staff-1' })
    expect(collectCall?.args[3]).toBe('command-1')
    expect(reissueCall?.args[1]).toBe('customer_request')
    expect(reissueCall?.args[2]).toMatchObject({ userId: 'staff-1', auditContext: { requestId: expect.any(String) } })
    expect(reissueCall?.args[3]).toBe('command-1')
    expect(revokeCall?.args[1]).toBe('customer_request')
    expect(revokeCall?.args[3]).toBe('command-1')
    expect(await responses[5]?.text()).not.toContain('guest-access-secret')
    expect(updateCall?.args[0]).toEqual({ shippingFeeSatang: 500, checkoutEnabled: false })
    expect(updateCall?.args[1]).toMatchObject({ userId: 'staff-1', auditContext: { requestId: expect.any(String) } })
  })

  it('requires an active staff session and rejects customer, inactive staff, and insufficient roles', async () => {
    const harness = await createHarness()
    for (const [identity, expected] of [
      ['', 401], ['customer', 403], ['inactive-staff', 403],
    ] as const) {
      const response = await harness.app.handle(request('/api/v1/admin/orders', {}, identity))
      expect(response.status).toBe(expected)
    }
    expect(harness.calls).toEqual([])
  })

  it('applies exact per-route permissions to each staff role', async () => {
    const cases = [
      { role: 'owner', allowed: ['read', 'fulfill', 'cancel', 'collect', 'refund', 'manage-access', 'settings-read', 'settings-update'] },
      { role: 'admin', allowed: ['read', 'fulfill', 'cancel', 'collect', 'refund', 'manage-access', 'settings-read', 'settings-update'] },
      { role: 'fulfillment', allowed: ['read', 'fulfill', 'collect'] },
      { role: 'support', allowed: ['read', 'cancel', 'manage-access'] },
      { role: 'catalog_manager', allowed: ['read'] },
    ] as const
    for (const { role, allowed } of cases) {
      const { app } = await createHarness(role)
      const routeRequests = [
        ['read', request('/api/v1/admin/orders', {}, 'staff')],
        ['fulfill', command(`/api/v1/admin/orders/${orderId}/fulfillment`, { status: 'processing' })],
        ['cancel', command(`/api/v1/admin/orders/${orderId}/cancel`, {})],
        ['collect', command(`/api/v1/admin/orders/${orderId}/collect-cod`, { amountSatang: 3000 })],
        ['refund', command(`/api/v1/admin/orders/${orderId}/refund`, {})],
        ['manage-access', command(`/api/v1/admin/orders/${orderId}/guest-access/reissue`, { reasonCode: 'customer_request' })],
        ['settings-read', request('/api/v1/admin/commerce-settings', {}, 'staff')],
        ['settings-update', request('/api/v1/admin/commerce-settings', {
          method: 'PUT', body: JSON.stringify({ shippingFeeSatang: 500, checkoutEnabled: false }),
        })],
      ] as const
      const allowedPermissions = new Set<string>(allowed)
      for (const [permission, req] of routeRequests) {
        const response = await app.handle(req)
        expect(response.status).toBe(allowedPermissions.has(permission) ? 200 : 403)
      }
    }
  })

  it('rejects invalid pagination, unknown body fields, missing idempotency keys, and wrong origins', async () => {
    const { app, calls } = await createHarness()
    expect((await app.handle(request('/api/v1/admin/orders?limit=101'))).status).toBe(422)
    expect((await app.handle(request('/api/v1/admin/orders?unknown=yes'))).status).toBe(422)
    expect((await app.handle(command(`/api/v1/admin/orders/${orderId}/collect-cod`, { amountSatang: 3000 }, 'staff', ''))).status).toBe(422)
    expect((await app.handle(command(`/api/v1/admin/orders/${orderId}/collect-cod`, { amountSatang: 3000, actorId: 'attacker' }))).status).toBe(422)
    expect((await app.handle(command(`/api/v1/admin/orders/${orderId}/refund`, { amountSatang: 3000 }))).status).toBe(422)
    expect((await app.handle(command(`/api/v1/admin/orders/${orderId}/fulfillment`, { status: 'cancelled' }))).status).toBe(422)
    expect((await app.handle(command(`/api/v1/admin/orders/${orderId}/guest-access/reissue`, { reasonCode: 'freeform' }))).status).toBe(422)
    expect((await app.handle(command(`/api/v1/admin/orders/${orderId}/cancel`, {}, 'staff', 'key', 'https://attacker.example'))).status).toBe(403)
    expect((await app.handle(command(`/api/v1/admin/orders/${orderId}/refund`, {}, 'staff', 'key', 'https://attacker.example'))).status).toBe(403)
    expect((await app.handle(command(`/api/v1/admin/orders/${orderId}/refund`, {}, '', 'key'))).status).toBe(401)
    expect((await app.handle(command(`/api/v1/admin/orders/${orderId}/refund`, {}, 'staff', ''))).status).toBe(422)
    expect((await app.handle(request('/api/v1/admin/commerce-settings', {
      method: 'PUT', body: JSON.stringify({ shippingFeeSatang: 500, checkoutEnabled: false }),
    }, 'staff', 'https://attacker.example'))).status).toBe(403)
    expect((await app.handle(request('/api/v1/admin/commerce-settings', {
      method: 'PUT', body: JSON.stringify({ shippingFeeSatang: -1, checkoutEnabled: true }),
    }))).status).toBe(422)
    expect((await app.handle(request('/api/v1/admin/commerce-settings', {
      method: 'PUT', body: JSON.stringify({ shippingFeeSatang: 500, checkoutEnabled: false, actorId: 'attacker' }),
    }))).status).toBe(422)
    expect(calls).toEqual([])
  })

  it('requests an empty-body full refund with the session actor and idempotency key', async () => {
    const { app, calls } = await createHarness()
    const response = await app.handle(command(`/api/v1/admin/orders/${orderId}/refund`, {}))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ payment: { status: 'collected', refund: { status: 'pending' } } })
    expect(calls.find(({ method }) => method === 'stripeRefunds.requestFullRefund')?.args).toMatchObject([
      orderId,
      { kind: 'staff', userId: 'staff-1', auditContext: { requestId: expect.any(String) } },
      'command-1',
    ])
  })

  it('documents every staff route with cookie security and omits guest tokens from recovery responses', async () => {
    const { app } = await createHarness()
    const response = await app.handle(request('/api/v1/openapi.json', {}, ''))
    const openapi = await response.json() as {
      paths: Record<string, Record<string, { security?: Array<Record<string, unknown>>; responses?: Record<string, { content?: Record<string, { schema?: { properties?: Record<string, unknown> } }> }> }>>
    }
    const expected = [
      ['/api/v1/admin/orders', 'get'],
      [`/api/v1/admin/orders/${orderId}`.replace(orderId, '{orderId}'), 'get'],
      ['/api/v1/admin/orders/{orderId}/fulfillment', 'post'],
      ['/api/v1/admin/orders/{orderId}/cancel', 'post'],
      ['/api/v1/admin/orders/{orderId}/collect-cod', 'post'],
      ['/api/v1/admin/orders/{orderId}/refund', 'post'],
      ['/api/v1/admin/orders/{orderId}/guest-access/reissue', 'post'],
      ['/api/v1/admin/orders/{orderId}/guest-access/revoke', 'post'],
      ['/api/v1/admin/commerce-settings', 'get'],
      ['/api/v1/admin/commerce-settings', 'put'],
    ] as const
    for (const [path, method] of expected) {
      expect(openapi.paths[path]?.[method]?.security).toEqual([{ sessionCookie: [] }])
    }
    expect(openapi.paths['/api/v1/admin/orders/{orderId}/guest-access/reissue']?.post?.responses?.['200']
      ?.content?.['application/json']?.schema?.properties).not.toHaveProperty('guestAccessToken')
    expect(openapi.paths).not.toHaveProperty('/api/v1/admin/orders/')
    expect(openapi.paths).not.toHaveProperty('/api/v1/admin/orders/{orderId}/guest-access/recover')
  })
})
