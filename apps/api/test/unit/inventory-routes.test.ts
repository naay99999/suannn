import { describe, expect, it } from 'bun:test'
import { createApp } from '../../src/app'
import { loadConfig } from '../../src/config/env'
import type { AppDependencies } from '../../src/app'
import type { InventoryService } from '../../src/modules/inventory/service'
import type { Auth } from '../../src/plugins/auth/auth'
import { DomainError } from '../../src/shared/domain-error'
import { testEnv } from '../fixtures'

const config = loadConfig(testEnv)
const warehouseId = '00000000-0000-4000-8000-000000000001'
const variantId = '00000000-0000-4000-8000-000000000002'
const lotId = '00000000-0000-4000-8000-000000000003'
const reservationId = '00000000-0000-4000-8000-000000000004'

const warehouse = {
  id: warehouseId,
  code: 'MAIN',
  name: 'Main warehouse',
  isActive: true,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
}

const lot = {
  id: lotId,
  warehouseId,
  variantId,
  lotCode: 'COCO-001',
  receivedAt: '2026-09-26T00:00:00.000Z',
  expiryDate: '2026-12-31',
  quarantinedAt: null,
  quarantineReason: null,
  onHandQuantity: 8,
  reservedQuantity: 0,
  sellableQuantity: 8,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
}

const reservation = {
  id: reservationId,
  warehouseId,
  externalReference: null,
  status: 'active' as const,
  createdAt: '2026-09-26T00:00:00.000Z',
  expiresAt: '2026-09-26T00:15:00.000Z',
  completedAt: null,
  actorId: 'staff-1',
  allocations: [{ variantId, lotId, quantity: 2 }],
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
        const role = identity === 'support' ? 'support' : identity === 'fulfillment' ? 'fulfillment' : 'owner'
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

function createInventoryService(overrides: Record<string, (...args: never[]) => unknown> = {}) {
  const calls: string[] = []
  const service = {
    getDefaultWarehouse: async () => { calls.push('getDefaultWarehouse'); return warehouse },
    getVariantSummary: async () => { calls.push('getVariantSummary'); return { variantId, warehouseId, onHandQuantity: 8, reservedQuantity: 2, eligibleQuantity: 8, sellableQuantity: 6 } },
    listLots: async () => { calls.push('listLots'); return { items: [lot], nextCursor: null } },
    getLot: async () => { calls.push('getLot'); return lot },
    listMovements: async () => { calls.push('listMovements'); return { items: [], nextCursor: null } },
    receiveLot: async () => { calls.push('receiveLot'); return lot },
    quarantineLot: async () => { calls.push('quarantineLot'); return lot },
    releaseQuarantine: async () => { calls.push('releaseQuarantine'); return lot },
    writeOff: async () => { calls.push('writeOff'); return lot },
    adjustCount: async () => { calls.push('adjustCount'); return lot },
    reserve: async () => { calls.push('reserve'); return reservation },
    getReservation: async () => { calls.push('getReservation'); return reservation },
    confirm: async () => { calls.push('confirm'); return reservation },
    release: async () => { calls.push('release'); return reservation },
    ...overrides,
  }
  return { service: service as unknown as InventoryService, calls }
}

function createTestApp(overrides: Record<string, (...args: never[]) => unknown> = {}) {
  const inventory = createInventoryService(overrides)
  const { auth, calls: authCalls } = createAuth()
  const dependencies = {
    auth,
    audit: {},
    customerSignup: {},
    customerProfile: {},
    customerAddresses: {},
    customerEmailChange: {},
    staffInvitations: {},
    staffMfa: {},
    staff: {},
    systemSettings: {},
    products: {},
    inventory: inventory.service,
    staffMfaRequired: async () => true,
    identityReservations: { findState: async () => null },
    limiter: {},
  } as unknown as AppDependencies

  return createApp(config, dependencies).then((app) => ({ app, ...inventory, authCalls }))
}

function request(path: string, options: {
  method?: string
  body?: unknown
  cookie?: string
  idempotencyKey?: string
  origin?: string
} = {}) {
  const headers = new Headers()
  if (options.cookie) headers.set('cookie', `session=${options.cookie}`)
  if (options.method && options.method !== 'GET') {
    headers.set('content-type', 'application/json')
    headers.set('origin', options.origin ?? 'http://localhost:5184')
  }
  if (options.idempotencyKey !== undefined) headers.set('idempotency-key', options.idempotencyKey)
  return new Request(`http://localhost${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
}

describe('inventory HTTP contracts', () => {
  it('mounts every staff inventory route with typed request and response documentation', async () => {
    const { app } = await createTestApp()
    const response = await app.handle(request('/api/v1/openapi.json'))
    const document = await response.json() as {
      paths: Record<string, Record<string, {
        parameters?: Array<{ name?: string; in?: string; required?: boolean }>
        requestBody?: unknown
        security?: Array<Record<string, string[]>>
        responses?: Record<string, unknown>
      }>>
      components: { schemas: Record<string, unknown> }
      tags: Array<{ name: string }>
    }
    const routes: Array<[string, string, number]> = [
      ['/api/v1/admin/inventory/warehouses', 'get', 200],
      ['/api/v1/admin/inventory/variants/{variantId}/summary', 'get', 200],
      ['/api/v1/admin/inventory/lots', 'get', 200],
      ['/api/v1/admin/inventory/lots/{lotId}', 'get', 200],
      ['/api/v1/admin/inventory/movements', 'get', 200],
      ['/api/v1/admin/inventory/lots', 'post', 201],
      ['/api/v1/admin/inventory/lots/{lotId}/quarantine', 'post', 200],
      ['/api/v1/admin/inventory/lots/{lotId}/release-quarantine', 'post', 200],
      ['/api/v1/admin/inventory/lots/{lotId}/write-offs', 'post', 200],
      ['/api/v1/admin/inventory/lots/{lotId}/count-adjustments', 'post', 200],
      ['/api/v1/admin/inventory/reservations', 'post', 201],
      ['/api/v1/admin/inventory/reservations/{reservationId}', 'get', 200],
      ['/api/v1/admin/inventory/reservations/{reservationId}/confirm', 'post', 200],
      ['/api/v1/admin/inventory/reservations/{reservationId}/release', 'post', 200],
    ]

    expect(response.status).toBe(200)
    expect(document.tags.map(({ name }) => name)).toContain('Admin Inventory')
    for (const [path, method, successStatus] of routes) {
      const operation = document.paths[path]?.[method]
      expect(operation).toBeDefined()
      expect(operation?.security).toEqual([{ sessionCookie: [] }])
      expect(operation?.responses?.[String(successStatus)]).toBeDefined()
      expect(operation?.responses?.['401']).toBeDefined()
      expect(operation?.responses?.['403']).toBeDefined()
      expect(operation?.responses?.['422']).toBeDefined()
      if (method === 'post') {
        expect(operation?.requestBody).toBeDefined()
        expect(operation?.parameters).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'idempotency-key', in: 'header', required: true }),
        ]))
      }
    }
    expect(document.paths['/api/v1/admin/inventory/lots'].post.responses?.['201']).toBeDefined()
    expect(document.paths['/api/v1/admin/inventory/reservations'].post.responses?.['201']).toBeDefined()
    expect(JSON.stringify(document.components.schemas)).toContain('sellableQuantity')
    expect(document.paths['/api/v1/admin/inventory/lots'].post.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'idempotency-key', in: 'header', required: true }),
    ]))
    expect(document.paths['/api/v1/admin/inventory/lots'].post.responses?.['201']).toMatchObject({
      content: { 'application/json': { schema: { $ref: '#/components/schemas/inventory.lot' } } },
    })
    expect(document.paths['/api/v1/admin/inventory/reservations'].post.responses?.['201']).toMatchObject({
      content: { 'application/json': { schema: { $ref: '#/components/schemas/inventory.reservation' } } },
    })
  })

  it('returns the warehouse and reservation detail projections from their read routes', async () => {
    const { app, calls } = await createTestApp()
    const warehouseResponse = await app.handle(request('/api/v1/admin/inventory/warehouses', { cookie: 'owner' }))
    const reservationResponse = await app.handle(request(
      `/api/v1/admin/inventory/reservations/${reservationId}`,
      { cookie: 'owner' },
    ))

    expect(warehouseResponse.status).toBe(200)
    expect(await warehouseResponse.json()).toEqual(warehouse)
    expect(reservationResponse.status).toBe(200)
    expect(await reservationResponse.json()).toEqual(reservation)
    expect(calls).toEqual(['getDefaultWarehouse', 'getReservation'])
  })

  it('requires a staff session and inventory permission for reads', async () => {
    const { app, calls } = await createTestApp()
    const missing = await app.handle(request('/api/v1/admin/inventory/warehouses'))
    const customer = await app.handle(request('/api/v1/admin/inventory/warehouses', { cookie: 'customer' }))
    const support = await app.handle(request('/api/v1/admin/inventory/warehouses', { cookie: 'support' }))
    const fulfillment = await app.handle(request('/api/v1/admin/inventory/warehouses', { cookie: 'fulfillment' }))

    expect(missing.status).toBe(401)
    expect(customer.status).toBe(403)
    expect(support.status).toBe(403)
    expect(fulfillment.status).toBe(200)
    expect(calls).toEqual(['getDefaultWarehouse'])
  })

  it('requires a key and trusted admin origin before a mutation reaches inventory service', async () => {
    const { app, calls } = await createTestApp()
    const body = {
      warehouseId,
      variantId,
      lotCode: 'coco-001',
      quantity: 8,
      expiryDate: '2026-12-31',
    }
    const missingKey = await app.handle(request('/api/v1/admin/inventory/lots', {
      method: 'POST', body, cookie: 'owner',
    }))
    const invalidKey = await app.handle(request('/api/v1/admin/inventory/lots', {
      method: 'POST', body, cookie: 'owner', idempotencyKey: 'with whitespace',
    }))
    const insufficientStaff = await app.handle(request('/api/v1/admin/inventory/lots', {
      method: 'POST', body, cookie: 'support', idempotencyKey: 'receipt-support',
    }))
    const wrongOrigin = await app.handle(request('/api/v1/admin/inventory/lots', {
      method: 'POST', body, cookie: 'owner', idempotencyKey: 'receipt-1', origin: 'https://evil.example',
    }))

    expect(missingKey.status).toBe(422)
    expect(invalidKey.status).toBe(422)
    expect(insufficientStaff.status).toBe(403)
    expect(wrongOrigin.status).toBe(403)
    expect(calls).toEqual([])
  })

  it('returns 201 for receipt and reservation creation and passes the authenticated actor and key', async () => {
    const received: unknown[] = []
    const reserved: unknown[] = []
    const { app } = await createTestApp({
      receiveLot: async (...args: never[]) => { received.push(...args); return lot },
      reserve: async (...args: never[]) => { reserved.push(...args); return reservation },
    })
    const receiveBody = {
      warehouseId,
      variantId,
      lotCode: 'coco-001',
      quantity: 8,
      expiryDate: '2026-12-31',
    }
    const reserveBody = { warehouseId, lines: [{ variantId, quantity: 2 }] }
    const receipt = await app.handle(request('/api/v1/admin/inventory/lots', {
      method: 'POST', body: receiveBody, cookie: 'owner', idempotencyKey: 'receipt-1',
    }))
    const reserve = await app.handle(request('/api/v1/admin/inventory/reservations', {
      method: 'POST', body: reserveBody, cookie: 'owner', idempotencyKey: 'reserve-1',
    }))

    expect(receipt.status).toBe(201)
    expect(await receipt.json()).toEqual(lot)
    expect(reserve.status).toBe(201)
    expect(await reserve.json()).toEqual(reservation)
    expect(received[0]).toEqual(receiveBody)
    expect(received[1]).toMatchObject({ actor: { userId: 'staff-1' }, idempotencyKey: 'receipt-1' })
    expect(reserved[0]).toEqual(reserveBody)
    expect(reserved[1]).toMatchObject({ actor: { userId: 'staff-1' }, idempotencyKey: 'reserve-1' })
  })

  it('rejects unknown body/query fields, empty filters, and invalid UUIDs before service calls', async () => {
    const { app, calls } = await createTestApp()
    const unknownBody = await app.handle(request('/api/v1/admin/inventory/lots', {
      method: 'POST', body: { warehouseId, variantId, lotCode: 'COCO-001', quantity: 8, expiryDate: '2026-12-31', actorId: 'client' },
      cookie: 'owner', idempotencyKey: 'receipt-2',
    }))
    const unknownAllocationField = await app.handle(request('/api/v1/admin/inventory/reservations', {
      method: 'POST', body: { warehouseId, lines: [{ variantId, quantity: 2, actorId: 'client' }] },
      cookie: 'owner', idempotencyKey: 'reserve-unknown-field',
    }))
    const unknownQuery = await app.handle(request('/api/v1/admin/inventory/lots?unexpected=field', { cookie: 'owner' }))
    const emptyFilter = await app.handle(request('/api/v1/admin/inventory/lots?variantId=', { cookie: 'owner' }))
    const emptyMovementFilter = await app.handle(request('/api/v1/admin/inventory/movements?lotId=', { cookie: 'owner' }))
    const invalidVariantId = await app.handle(request('/api/v1/admin/inventory/variants/not-a-uuid/summary', { cookie: 'owner' }))
    const invalidLotId = await app.handle(request('/api/v1/admin/inventory/lots/not-a-uuid', { cookie: 'owner' }))
    const invalidReservationId = await app.handle(request('/api/v1/admin/inventory/reservations/not-a-uuid', { cookie: 'owner' }))

    expect(unknownBody.status).toBe(422)
    expect(unknownAllocationField.status).toBe(422)
    expect(unknownQuery.status).toBe(422)
    expect(emptyFilter.status).toBe(422)
    expect(emptyMovementFilter.status).toBe(422)
    expect(invalidVariantId.status).toBe(422)
    expect(invalidLotId.status).toBe(422)
    expect(invalidReservationId.status).toBe(422)
    expect(calls).toEqual([])
  })

  it('maps inventory domain errors to the public error envelope', async () => {
    const { app, calls } = await createTestApp({
      getLot: async () => { calls.push('getLot-error'); throw new DomainError('LOT_NOT_FOUND') },
    })
    const response = await app.handle(request(`/api/v1/admin/inventory/lots/${lotId}`, { cookie: 'owner' }))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ code: 'LOT_NOT_FOUND', message: 'Inventory lot not found' })
    expect(calls).toEqual(['getLot-error'])
  })

  it('maps a reservation invalidated by catalog or lot changes to a precise conflict', async () => {
    const { app } = await createTestApp({
      confirm: async () => { throw new DomainError('RESERVATION_NOT_CONFIRMABLE') },
    })
    const response = await app.handle(request(`/api/v1/admin/inventory/reservations/${reservationId}/confirm`, {
      method: 'POST', body: {}, cookie: 'owner', idempotencyKey: 'confirm-invalidated',
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      code: 'RESERVATION_NOT_CONFIRMABLE',
      message: 'Inventory reservation is no longer eligible for confirmation',
    })
  })
})
