import { describe, expect, it } from 'bun:test'
import { createApp, type AppDependencies } from '../../src/app'
import { loadConfig } from '../../src/config/env'
import type { Auth } from '../../src/plugins/auth/auth'
import { MarketingSettingsService } from '../../src/modules/marketing/settings'
import { testEnv } from '../fixtures'

const config = loadConfig(testEnv)
const overview = {
  range: { from: '2026-10-01', to: '2026-10-07' },
  previousRange: { from: '2026-09-24', to: '2026-09-30' },
  breakEvenRoas: 100 / 35,
  summary: {
    spendSatang: 100000, revenueSatang: 400000, orders: 4, roas: 4, costPerOrderSatang: 25000,
    previous: { spendSatang: 0, revenueSatang: 0, orders: 0, roas: null },
    unmatched: { revenueSatang: 0, orders: 0 },
    nonAdOrders: 1,
  },
  campaigns: [{
    platform: 'meta' as const, utmSource: 'meta', campaignId: '1', campaignName: null, spendSatang: 100000,
    orders: 4, revenueSatang: 400000, roas: 4, costPerOrderSatang: 25000, verdict: 'profit' as const,
  }],
  warnings: [{ code: 'NON_THB_CURRENCY' as const, platform: 'meta' as const }],
}
const settings = { marginPercent: 35, version: 1, updatedAt: '2026-10-01T00:00:00.000Z' }

async function createHarness(role = 'owner', allowSync = true, settingsOverride?: AppDependencies['marketing']['settings']) {
  const calls: Array<{ method: string, args: unknown[] }> = []
  const marketing = {
    metrics: { overview: async (...args: unknown[]) => { calls.push({ method: 'overview', args }); return overview } },
    settings: settingsOverride ?? {
      get: async () => { calls.push({ method: 'get', args: [] }); return settings },
      update: async (...args: unknown[]) => { calls.push({ method: 'update', args }); return settings },
    },
    sync: { run: async () => { calls.push({ method: 'run', args: [] }); return [{ platform: 'meta' as const, status: 'succeeded' as const }] } },
  }
  const auth = {
    handler: async () => new Response(),
    api: {
      generateOpenAPISchema: async () => ({ components: {}, paths: {} }),
      getSession: async ({ headers }: { headers: Headers }) => {
        const identity = headers.get('cookie')?.match(/(?:^|;\s*)session=([^;]+)/)?.[1]
        if (!identity) return null
        return {
          user: { id: 'staff-1', accountType: 'staff' as const },
          staff: { role, permissions: [] },
          session: { id: 'session-staff' },
        }
      },
    },
  } as unknown as Auth
  const limiterCalls: unknown[] = []
  const dependencies = {
    auth,
    marketing,
    limiter: {
      consume: async (input: unknown) => {
        limiterCalls.push(input)
        return { allowed: allowSync, remaining: 0, retryAfterSeconds: 30, resetAt: new Date() }
      },
    },
    staffMfaRequired: async () => true,
    identityReservations: { findState: async () => null },
  } as unknown as AppDependencies
  return { app: await createApp(config, dependencies), calls, limiterCalls }
}

function request(path: string, init: RequestInit = {}, identity = 'staff', origin = config.adminUrl) {
  const headers = new Headers(init.headers)
  if (identity) headers.set('cookie', `session=${identity}`)
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  if (init.method && init.method !== 'GET') headers.set('origin', origin)
  return new Request(`http://localhost${path}`, { ...init, headers })
}

const put = (body: unknown, origin = config.adminUrl) =>
  request('/api/v1/admin/marketing/settings', { method: 'PUT', body: JSON.stringify(body) }, 'staff', origin)

describe('admin marketing routes', () => {
  it('requires a session', async () => {
    const { app, calls } = await createHarness()
    for (const [method, path] of [
      ['GET', '/overview?from=2026-10-01&to=2026-10-02'], ['GET', '/settings'], ['GET', '/templates'],
      ['PUT', '/settings'], ['POST', '/sync'],
    ]) {
      const init: RequestInit = method === 'PUT' ? { method, body: JSON.stringify({ marginPercent: 40, version: 1 }) }
        : method === 'POST' ? { method, body: '{}' } : { method }
      const response = await app.handle(request(`/api/v1/admin/marketing${path}`, init, ''))
      expect(response.status).toBe(401)
    }
    expect(calls).toEqual([])
  })

  it('forbids support staff on every route', async () => {
    const { app, calls } = await createHarness('support')
    for (const [method, path] of [
      ['GET', '/overview?from=2026-10-01&to=2026-10-02'], ['GET', '/settings'], ['GET', '/templates'],
      ['PUT', '/settings'], ['POST', '/sync'],
    ]) {
      const init: RequestInit = method === 'PUT' ? { method, body: JSON.stringify({ marginPercent: 40, version: 1 }) }
        : method === 'POST' ? { method, body: '{}' } : { method }
      const response = await app.handle(request(`/api/v1/admin/marketing${path}`, init))
      expect(response.status).toBe(403)
    }
    expect(calls).toEqual([])
  })

  it('returns the overview using the saved margin', async () => {
    const { app, calls } = await createHarness()
    const response = await app.handle(request('/api/v1/admin/marketing/overview?from=2026-10-01&to=2026-10-07'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(overview)
    expect(calls.find((call) => call.method === 'overview')?.args).toEqual([{ from: '2026-10-01', to: '2026-10-07' }, 35])
  })

  it('rejects invalid ranges before any query', async () => {
    const { app, calls } = await createHarness()
    for (const query of [
      'from=2026-10-02&to=2026-10-01',
      'from=2025-01-01&to=2026-01-02',
      'from=2026-02-30&to=2026-03-01',
      'from=2026-10-01',
      '',
    ]) {
      const response = await app.handle(request(`/api/v1/admin/marketing/overview?${query}`))
      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({ code: 'INVALID_MARKETING_RANGE' })
    }
    expect(calls).toEqual([])
  })

  it('returns settings and updates them', async () => {
    const { app, calls } = await createHarness()
    expect(await (await app.handle(request('/api/v1/admin/marketing/settings'))).json()).toEqual(settings)
    const response = await app.handle(put({ marginPercent: 40, version: 1 }))
    expect(response.status).toBe(200)
    expect(calls.find((call) => call.method === 'update')?.args[0]).toEqual({ marginPercent: 40, version: 1 })
  })

  it('rejects invalid margins and extra keys with INVALID_MARKETING_SETTINGS', async () => {
    // Input validation runs before the service touches the database.
    const { app } = await createHarness('owner', true, new MarketingSettingsService(null as never, null as never))
    for (const body of [
      { marginPercent: 0, version: 1 }, { marginPercent: 100.5, version: 1 }, { marginPercent: -5, version: 1 },
      { marginPercent: 'abc', version: 1 }, { marginPercent: 35.55, version: 1 }, { marginPercent: 40, version: 0 },
      { marginPercent: 40, version: 1, extra: true }, { marginPercent: 40 },
    ]) {
      const response = await app.handle(put(body))
      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({ code: 'INVALID_MARKETING_SETTINGS' })
    }
  })

  it('rejects settings updates from a foreign origin', async () => {
    const { app, calls } = await createHarness()
    const response = await app.handle(put({ marginPercent: 40, version: 1 }, 'https://attacker.example'))
    expect(response.status).toBe(403)
    expect(calls).toEqual([])
  })

  it('runs and rate limits the sync trigger', async () => {
    const allowed = await createHarness()
    const response = await allowed.app.handle(request('/api/v1/admin/marketing/sync', { method: 'POST', body: '{}' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ results: [{ platform: 'meta', status: 'succeeded' }] })
    expect(allowed.limiterCalls[0]).toMatchObject({ namespace: 'marketing-sync', limit: 6, windowSeconds: 600 })

    const limited = await createHarness('owner', false)
    const rejected = await limited.app.handle(request('/api/v1/admin/marketing/sync', { method: 'POST', body: '{}' }))
    expect(rejected.status).toBe(429)
    expect(limited.calls).toEqual([])
  })

  it('lists the three UTM templates', async () => {
    const { app } = await createHarness()
    const response = await app.handle(request('/api/v1/admin/marketing/templates'))
    expect(response.status).toBe(200)
    const { templates } = await response.json() as { templates: Array<{ platform: string, template: string }> }
    expect(templates.map((item) => item.platform)).toEqual(['meta', 'tiktok', 'google'])
    expect(templates[0]?.template).toContain('{{campaign.id}}')
    expect(templates[1]?.template).toContain('__CAMPAIGN_ID__')
    expect(templates[2]?.template).toContain('{campaignid}')
  })
})
