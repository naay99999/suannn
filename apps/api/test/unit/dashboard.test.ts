import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { createAdminDashboardModule, DashboardService, type DashboardRepository } from '../../src/modules/dashboard'
import type { Auth } from '../../src/plugins/auth/auth'
import { createErrorHandlingPlugin } from '../../src/plugins/error-handling'

const orderId = '00000000-0000-4000-8000-000000000010'

function fakeRepository(calls: Array<{ method: string; args: unknown[] }> = []) {
  return {
    dailySales: async (...args: [Date, Date]) => {
      calls.push({ method: 'dailySales', args })
      return [
        { date: '2026-10-08', orderCount: 9, revenueSatang: 90_000 },
        { date: '2026-10-12', orderCount: 1, revenueSatang: 5_000 },
        { date: '2026-10-18', orderCount: 2, revenueSatang: 3_001 },
      ]
    },
    backlogCounts: async () => [{ status: 'placed' as const, count: 3 }, { status: 'packed' as const, count: 1 }],
    recentOrders: async (limit: number) => {
      calls.push({ method: 'recentOrders', args: [limit] })
      return [{
        id: orderId,
        orderNumber: 'SN-20261018-0001',
        recipientName: 'Somchai',
        status: 'placed' as const,
        paymentMethod: 'cod',
        totalSatang: 1_500,
        createdAt: new Date('2026-10-18T03:00:00.000Z'),
      }]
    },
  } satisfies Pick<DashboardRepository, 'dailySales' | 'backlogCounts' | 'recentOrders'>
}

describe('DashboardService', () => {
  // 2026-10-18 01:30 in Asia/Bangkok.
  const now = () => new Date('2026-10-17T18:30:00.000Z')

  it('aligns the window to Bangkok days and compares it with the previous window', async () => {
    const calls: Array<{ method: string; args: unknown[] }> = []
    const overview = await new DashboardService(fakeRepository(calls), now).overview('7d')

    expect(overview.from).toBe('2026-10-11T17:00:00.000Z')
    expect(overview.to).toBe('2026-10-18T17:00:00.000Z')
    expect(calls[0]).toEqual({
      method: 'dailySales',
      args: [new Date('2026-10-04T17:00:00.000Z'), new Date('2026-10-18T17:00:00.000Z')],
    })
    expect(overview.daily.map((day) => day.date)).toEqual([
      '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18',
    ])
    expect(overview.daily[0]).toEqual({ date: '2026-10-12', orderCount: 1, revenueSatang: 5_000 })
    expect(overview.daily[1]).toEqual({ date: '2026-10-13', orderCount: 0, revenueSatang: 0 })
    expect(overview.summary).toEqual({
      revenueSatang: 8_001,
      previousRevenueSatang: 90_000,
      orderCount: 3,
      previousOrderCount: 9,
      averageOrderValueSatang: 2_667,
    })
  })

  it('fills missing backlog statuses and serializes recent orders', async () => {
    const calls: Array<{ method: string; args: unknown[] }> = []
    const overview = await new DashboardService(fakeRepository(calls), now).overview('90d')

    expect(overview.daily).toHaveLength(90)
    expect(overview.backlog).toEqual({ pendingPayment: 0, placed: 3, processing: 0, packed: 1 })
    expect(overview.recentOrders[0]?.createdAt).toBe('2026-10-18T03:00:00.000Z')
    expect(calls).toContainEqual({ method: 'recentOrders', args: [8] })
  })

  it('reports a zero average when there are no sales', async () => {
    const repository = { ...fakeRepository(), dailySales: async () => [] }
    const overview = await new DashboardService(repository, now).overview('30d')
    expect(overview.summary.averageOrderValueSatang).toBe(0)
    expect(overview.summary.orderCount).toBe(0)
  })
})

describe('admin dashboard route', () => {
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

  function createHarness() {
    const ranges: string[] = []
    const service = {
      overview: async (range: '7d' | '30d' | '90d') => {
        ranges.push(range)
        return new DashboardService(fakeRepository(), () => new Date('2026-10-17T18:30:00.000Z')).overview(range)
      },
    }
    const app = new Elysia().use(createErrorHandlingPlugin()).use(createAdminDashboardModule(auth, service))
    return { app, ranges }
  }

  const get = (path: string, identity?: string) => new Request(`http://localhost${path}`, {
    headers: identity ? { cookie: `session=${identity}` } : {},
  })

  it('returns the overview for staff with order:read and defaults to 30 days', async () => {
    const { app, ranges } = createHarness()
    const response = await app.handle(get('/api/v1/admin/dashboard', 'support'))
    expect(response.status).toBe(200)
    expect(((await response.json()) as { daily: unknown[] }).daily).toHaveLength(30)

    expect((await app.handle(get('/api/v1/admin/dashboard?range=7d', 'fulfillment'))).status).toBe(200)
    expect(ranges).toEqual(['30d', '7d'])
  })

  it('rejects anonymous users, customers, and unknown ranges', async () => {
    const { app, ranges } = createHarness()
    expect((await app.handle(get('/api/v1/admin/dashboard'))).status).toBe(401)
    expect((await app.handle(get('/api/v1/admin/dashboard', 'customer'))).status).toBe(403)
    expect((await app.handle(get('/api/v1/admin/dashboard?range=1y', 'owner'))).status).toBe(422)
    expect(ranges).toEqual([])
  })
})
