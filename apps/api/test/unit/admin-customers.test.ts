import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { AdminCustomerService, createAdminCustomersModule, type AdminCustomerRepository } from '../../src/modules/customers'
import type { Auth } from '../../src/plugins/auth/auth'
import { createErrorHandlingPlugin } from '../../src/plugins/error-handling'

const customerId = 'cus_Abc123'
const orderId = '00000000-0000-4000-8000-000000000010'

function fakeRepository(calls: Array<{ method: string; args: unknown[] }> = []) {
  return {
    findCustomer: async (id: string) => {
      calls.push({ method: 'findCustomer', args: [id] })
      return id === customerId
        ? { id, name: 'Somchai Jaidee', email: 'somchai@example.test', emailVerified: true, banned: null, createdAt: new Date('2026-01-02T03:04:05.000Z') }
        : null
    },
    orderStats: async () => ({ orderCount: 3, spentSatang: 45_900, lastOrderAt: new Date('2026-10-18T03:00:00.000Z') }),
    addresses: async () => [{
      id: 'addr-1', label: 'บ้าน', recipientName: 'Somchai Jaidee', phone: '0812345678', addressLine1: '1 Main', addressLine2: null,
      subdistrict: 'Suthep', district: 'Mueang', province: 'Chiang Mai', postalCode: '50200', isDefaultShipping: true, isDefaultBilling: false,
    }],
    recentOrders: async (id: string, limit: number) => {
      calls.push({ method: 'recentOrders', args: [id, limit] })
      return [{ id: orderId, orderNumber: 'SN-20261018-0001', status: 'placed' as const, paymentMethod: 'cod', totalSatang: 1_500, createdAt: new Date('2026-10-18T03:00:00.000Z') }]
    },
  } satisfies Pick<AdminCustomerRepository, 'findCustomer' | 'orderStats' | 'addresses' | 'recentOrders'>
}

describe('AdminCustomerService', () => {
  it('serializes the customer, stats, and recent orders', async () => {
    const calls: Array<{ method: string; args: unknown[] }> = []
    const detail = await new AdminCustomerService(fakeRepository(calls)).detail(customerId)

    expect(detail.banned).toBe(false)
    expect(detail.createdAt).toBe('2026-01-02T03:04:05.000Z')
    expect(detail.stats).toEqual({ orderCount: 3, spentSatang: 45_900, lastOrderAt: '2026-10-18T03:00:00.000Z' })
    expect(detail.recentOrders[0]?.createdAt).toBe('2026-10-18T03:00:00.000Z')
    expect(calls).toContainEqual({ method: 'recentOrders', args: [customerId, 10] })
  })

  it('reports a customer without orders', async () => {
    const repository = { ...fakeRepository(), orderStats: async () => ({ orderCount: 0, spentSatang: 0, lastOrderAt: null }), recentOrders: async () => [] }
    const detail = await new AdminCustomerService(repository).detail(customerId)
    expect(detail.stats.lastOrderAt).toBeNull()
    expect(detail.recentOrders).toEqual([])
  })

  it('rejects unknown customers before loading related data', async () => {
    const calls: Array<{ method: string; args: unknown[] }> = []
    await expect(new AdminCustomerService(fakeRepository(calls)).detail('missing')).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND' })
    expect(calls.map((call) => call.method)).toEqual(['findCustomer'])
  })
})

describe('admin customers route', () => {
  const auth = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const identity = headers.get('cookie')?.match(/(?:^|;\s*)session=([^;]+)/)?.[1]
        if (!identity) return null
        if (identity === 'customer') {
          return { user: { id: 'customer-1', accountType: 'customer' as const }, session: { id: 'session-customer' } }
        }
        return {
          user: { id: 'staff-1', accountType: 'staff' as const },
          staff: { role: identity, permissions: [] },
          session: { id: 'session-staff' },
        }
      },
    },
  } as unknown as Auth

  const app = new Elysia().use(createErrorHandlingPlugin()).use(createAdminCustomersModule(auth, new AdminCustomerService(fakeRepository())))
  const get = (path: string, identity?: string) => new Request(`http://localhost${path}`, {
    headers: identity ? { cookie: `session=${identity}` } : {},
  })

  it('returns the customer for staff with customer:read', async () => {
    const response = await app.handle(get(`/api/v1/admin/customers/${customerId}`, 'support'))
    expect(response.status).toBe(200)
    expect(((await response.json()) as { email: string }).email).toBe('somchai@example.test')
  })

  it('rejects anonymous users, customers, staff without customer:read, unknown IDs, and malformed IDs', async () => {
    expect((await app.handle(get(`/api/v1/admin/customers/${customerId}`))).status).toBe(401)
    expect((await app.handle(get(`/api/v1/admin/customers/${customerId}`, 'customer'))).status).toBe(403)
    expect((await app.handle(get(`/api/v1/admin/customers/${customerId}`, 'catalog_manager'))).status).toBe(403)
    expect((await app.handle(get('/api/v1/admin/customers/missing', 'owner'))).status).toBe(404)
    expect((await app.handle(get('/api/v1/admin/customers/bad%20id', 'owner'))).status).toBe(422)
  })
})
