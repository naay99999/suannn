import { describe, expect, it } from 'bun:test'
import { createApp, type AppDependencies } from '../../src/app'
import { loadConfig } from '../../src/config/env'
import type { Auth } from '../../src/plugins/auth/auth'
import { DiscountService, deriveDiscountStatus } from '../../src/modules/discounts/service'
import type { DiscountRepository, DiscountRow } from '../../src/modules/discounts/repository'
import { DomainError } from '../../src/shared/domain-error'
import { testEnv } from '../fixtures'

const config = loadConfig(testEnv)

function createStore() {
  const rows = new Map<string, DiscountRow>()
  const calls: string[] = []
  const stats = { uses: 0, locked: false, revenueSatang: 0, discountGivenSatang: 0 }
  const store = {
    list: async () => [...rows.values()].map((row) => ({ row, ...stats })),
    detail: async (id: string) => {
      const row = rows.get(id)
      return row ? { row, ...stats, recentOrders: [] } : null
    },
    create: async (values: Omit<DiscountRow, 'id' | 'version' | 'createdAt' | 'updatedAt'>) => {
      calls.push('create')
      const row: DiscountRow = { ...values, id: crypto.randomUUID(), version: 1, createdAt: new Date(), updatedAt: new Date() }
      rows.set(row.id, row)
      return row.id
    },
    update: async (id: string, version: number, values: Partial<DiscountRow>) => {
      calls.push('update')
      const current = rows.get(id)
      if (!current) throw new DomainError('DISCOUNT_NOT_FOUND')
      if (current.version !== version) throw new DomainError('DISCOUNT_VERSION_CONFLICT')
      rows.set(id, { ...current, ...values, version: current.version + 1 })
      return id
    },
    remove: async (id: string) => {
      calls.push('remove')
      rows.delete(id)
    },
  }
  return { store: store as unknown as DiscountRepository, rows, calls }
}

async function createHarness(role = 'owner') {
  const { store, rows, calls } = createStore()
  const auth = {
    handler: async () => new Response(),
    api: {
      generateOpenAPISchema: async () => ({ components: {}, paths: {} }),
      getSession: async ({ headers }: { headers: Headers }) => {
        if (!headers.get('cookie')?.includes('session=staff')) return null
        return { user: { id: 'staff-1', accountType: 'staff' as const }, staff: { role, permissions: [] }, session: { id: 'session-staff' } }
      },
    },
  } as unknown as Auth
  const dependencies = {
    customerAuth: auth,
    staffAuth: auth,
    discounts: new DiscountService(store),
    staffMfaRequired: async () => true,
    identityReservations: { findState: async () => null },
    limiter: { consume: async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0, resetAt: new Date() }) },
  } as unknown as AppDependencies
  return { app: await createApp(config, dependencies), rows, calls }
}

function request(path: string, init: RequestInit = {}, identity = 'staff') {
  const headers = new Headers(init.headers)
  if (identity) headers.set('cookie', `session=${identity}`)
  if (init.method && init.method !== 'GET') {
    headers.set('content-type', 'application/json')
    headers.set('origin', config.adminUrl)
  }
  return new Request(`http://localhost/api/v1/admin/discounts${path}`, { ...init, headers })
}

const percentBody = { code: 'save10', name: 'Save 10', kind: 'percent', percentOff: 10, allowedEmails: ['  Buyer@Example.TEST '] }
const post = (body: unknown, identity = 'staff') => request('', { method: 'POST', body: JSON.stringify(body) }, identity)

describe('admin discount routes', () => {
  it('requires a session', async () => {
    const { app, calls } = await createHarness()
    expect((await app.handle(request('', {}, ''))).status).toBe(401)
    expect((await app.handle(post(percentBody, ''))).status).toBe(401)
    expect(calls).toEqual([])
  })

  it('forbids staff without marketing permission', async () => {
    const { app, calls } = await createHarness('support')
    expect((await app.handle(request(''))).status).toBe(403)
    expect((await app.handle(post(percentBody))).status).toBe(403)
    expect(calls).toEqual([])
  })

  it('normalises the code to upper case and emails to lower case on create', async () => {
    const { app, rows } = await createHarness()
    const response = await app.handle(post(percentBody))
    expect(response.status).toBe(201)
    const body = await response.json() as { code: string; allowedEmails: string[]; status: string; locked: boolean; uses: number }
    expect(body).toMatchObject({ code: 'SAVE10', allowedEmails: ['buyer@example.test'], status: 'active', locked: false, uses: 0 })
    expect([...rows.values()][0]).toMatchObject({ code: 'SAVE10', allowedEmails: ['buyer@example.test'] })
  })

  it('rejects invalid discounts with 400 INVALID_DISCOUNT', async () => {
    const { app, calls } = await createHarness()
    const bad = [
      { ...percentBody, percentOff: 0 },
      { ...percentBody, percentOff: 101 },
      { ...percentBody, percentOff: null },
      { ...percentBody, code: 'a' },
      { ...percentBody, kind: 'fixed', percentOff: null, amountOffSatang: 100, maxDiscountSatang: 5 },
      { ...percentBody, startsAt: '2026-11-02T00:00:00Z', endsAt: '2026-11-01T00:00:00Z' },
      { ...percentBody, allowedEmails: Array.from({ length: 501 }, (_, index) => `u${index}@example.test`) },
      { ...percentBody, allowedEmails: ['not-an-email'] },
      { ...percentBody, eligibleCategories: ['drinks'] },
      { ...percentBody, eligibleProductIds: ['nope'] },
    ]
    for (const body of bad) {
      const response = await app.handle(post(body))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'INVALID_DISCOUNT' })
    }
    expect(calls).toEqual([])
  })

  it('rejects a stale version with 409 DISCOUNT_VERSION_CONFLICT', async () => {
    const { app } = await createHarness()
    const created = await (await app.handle(post(percentBody))).json() as { id: string }
    const stale = await app.handle(request(`/${created.id}`, { method: 'PUT', body: JSON.stringify({ ...percentBody, percentOff: 15, version: 7 }) }))
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ code: 'DISCOUNT_VERSION_CONFLICT' })
    const ok = await app.handle(request(`/${created.id}`, { method: 'PUT', body: JSON.stringify({ ...percentBody, percentOff: 15, version: 1 }) }))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ percentOff: 15, version: 2 })
  })

  it('answers 404 for an unknown discount and 204 for delete', async () => {
    const { app } = await createHarness()
    const missing = await app.handle(request(`/${crypto.randomUUID()}`))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ code: 'DISCOUNT_NOT_FOUND' })
    const created = await (await app.handle(post(percentBody))).json() as { id: string }
    const removed = await app.handle(request(`/${created.id}`, { method: 'DELETE' }))
    expect(removed.status).toBe(204)
  })
})

describe('deriveDiscountStatus', () => {
  const base = { active: true, startsAt: null, endsAt: null, usageLimit: null, uses: 0 }
  const now = new Date('2026-10-23T00:00:00Z')
  it('applies the precedence paused > scheduled > expired > used_up > active', () => {
    const past = new Date('2026-10-01T00:00:00Z')
    const future = new Date('2026-11-01T00:00:00Z')
    expect(deriveDiscountStatus({ ...base, active: false, startsAt: future }, now)).toBe('paused')
    expect(deriveDiscountStatus({ ...base, startsAt: future }, now)).toBe('scheduled')
    expect(deriveDiscountStatus({ ...base, endsAt: past, usageLimit: 1, uses: 1 }, now)).toBe('expired')
    expect(deriveDiscountStatus({ ...base, usageLimit: 1, uses: 1 }, now)).toBe('used_up')
    expect(deriveDiscountStatus(base, now)).toBe('active')
  })
})
