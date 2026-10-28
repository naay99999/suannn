import { describe, expect, it } from 'bun:test'
import { createApp, type AppDependencies } from '../../src/app'
import { loadConfig } from '../../src/config/env'
import { DomainError } from '../../src/shared/domain-error'
import type { Auth } from '../../src/plugins/auth/auth'
import { MarketingSettingsService, assertCatalogBrandInput } from '../../src/modules/marketing/settings'
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
const settings = { marginPercent: 35, catalogBrandName: 'suannn', version: 1, updatedAt: '2026-10-01T00:00:00.000Z' }

async function createHarness(role = 'owner', allowSync = true, settingsOverride?: AppDependencies['marketing']['settings'], posthog: AppDependencies['marketing']['posthog'] = null) {
  const calls: Array<{ method: string, args: unknown[] }> = []
  const marketing = {
    metrics: { overview: async (...args: unknown[]) => { calls.push({ method: 'overview', args }); return overview } },
    settings: settingsOverride ?? {
      get: async () => { calls.push({ method: 'get', args: [] }); return settings },
      update: async (...args: unknown[]) => { calls.push({ method: 'update', args }); return settings },
      updateCatalogBrand: async (...args: unknown[]) => { calls.push({ method: 'updateCatalogBrand', args }); return settings },
    },
    posthog,
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
    customerAuth: auth,
    staffAuth: auth,
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
      ['GET', '/funnel?from=2026-10-01&to=2026-10-02'], ['GET', '/experiments'],
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
      ['GET', '/funnel?from=2026-10-01&to=2026-10-02'], ['GET', '/experiments'],
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

  it('rejects out-of-range and over-precise margins with INVALID_MARKETING_SETTINGS', async () => {
    // Range and precision checks run before the service touches the database.
    const { app } = await createHarness('owner', true, new MarketingSettingsService(null as never, null as never))
    for (const marginPercent of [0, 0.9, 100.5, -5, 35.55]) {
      const response = await app.handle(put({ marginPercent, version: 1 }))
      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({ code: 'INVALID_MARKETING_SETTINGS' })
    }
  })

  it('rejects wrong shapes with VALIDATION_ERROR', async () => {
    const { app, calls } = await createHarness()
    for (const body of [
      { marginPercent: 'abc', version: 1 }, { marginPercent: 40, version: 0 },
      { marginPercent: 40 },
    ]) {
      const response = await app.handle(put(body))
      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
    }
    expect(calls).toEqual([])
  })

  it('checks authentication, permission and origin before the body', async () => {
    // Elysia validates the body schema before auth guards, so use a schema-valid body that the service would reject.
    const bad = { marginPercent: 0, version: 1 }
    const owner = await createHarness()
    const anonymous = await owner.app.handle(request('/api/v1/admin/marketing/settings', { method: 'PUT', body: JSON.stringify(bad) }, ''))
    expect(anonymous.status).toBe(401)
    const foreign = await owner.app.handle(put(bad, 'https://attacker.example'))
    expect(foreign.status).toBe(403)
    const support = await createHarness('support')
    expect((await support.app.handle(put(bad))).status).toBe(403)
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

  describe('PostHog reports', () => {
    const steps = [{ event: '$pageview', label: 'เข้าเว็บ', count: 10, conversionFromPrevious: null, dropOffFromPrevious: null }]
    const experiments = [{
      id: 1, name: 'Hero', status: 'running' as const, startDate: '2026-10-01T00:00:00Z', endDate: null, flagKey: 'hero',
      url: 'https://us.posthog.com/project/1/experiments/1', variants: null, winner: null, readable: false,
    }]
    const posthog = () => {
      const funnelCalls: unknown[][] = []
      return {
        funnelCalls,
        client: {
          funnel: async (...args: unknown[]) => { funnelCalls.push(args); return { steps } },
          experiments: async () => ({ experiments }),
        },
      }
    }

    it('returns 503 POSTHOG_READ_NOT_CONFIGURED without PostHog config', async () => {
      const { app } = await createHarness()
      for (const path of ['/funnel?from=2026-10-01&to=2026-10-02', '/experiments']) {
        const response = await app.handle(request(`/api/v1/admin/marketing${path}`))
        expect(response.status).toBe(503)
        expect(await response.json()).toMatchObject({ code: 'POSTHOG_READ_NOT_CONFIGURED' })
      }
    })

    it('serves the funnel with parsed range and filters', async () => {
      const { client, funnelCalls } = posthog()
      const { app } = await createHarness('owner', true, undefined, client)
      const response = await app.handle(request('/api/v1/admin/marketing/funnel?from=2026-10-01&to=2026-10-07&platform=meta&campaign=c1'))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ steps })
      expect(funnelCalls[0]).toEqual([{ from: '2026-10-01', to: '2026-10-07' }, { platform: 'meta', campaign: 'c1' }])
    })

    it('rejects a bad range or platform with 422', async () => {
      const { app } = await createHarness('owner', true, undefined, posthog().client)
      const range = await app.handle(request('/api/v1/admin/marketing/funnel?from=2026-10-09&to=2026-10-07'))
      expect(range.status).toBe(422)
      expect(await range.json()).toMatchObject({ code: 'INVALID_MARKETING_RANGE' })
      const filter = await app.handle(request('/api/v1/admin/marketing/funnel?from=2026-10-01&to=2026-10-07&platform=bing'))
      expect(filter.status).toBe(422)
      expect(await filter.json()).toMatchObject({ code: 'INVALID_MARKETING_FILTER' })
    })

    it('serves experiments and maps client failures to 503 with the client code', async () => {
      const ok = await createHarness('owner', true, undefined, posthog().client)
      expect(await (await ok.app.handle(request('/api/v1/admin/marketing/experiments'))).json()).toEqual({ experiments })
      const failing = await createHarness('admin', true, undefined, {
        funnel: async () => { throw new DomainError('POSTHOG_READ_AUTH') },
        experiments: async () => { throw new DomainError('POSTHOG_READ_UNAVAILABLE') },
      })
      const funnel = await failing.app.handle(request('/api/v1/admin/marketing/funnel?from=2026-10-01&to=2026-10-02'))
      expect(funnel.status).toBe(503)
      expect(await funnel.json()).toMatchObject({ code: 'POSTHOG_READ_AUTH' })
      const list = await failing.app.handle(request('/api/v1/admin/marketing/experiments'))
      expect(list.status).toBe(503)
      expect(await list.json()).toMatchObject({ code: 'POSTHOG_READ_UNAVAILABLE' })
    })

    it('forbids the support role', async () => {
      const { app } = await createHarness('support', true, undefined, posthog().client)
      for (const path of ['/funnel?from=2026-10-01&to=2026-10-02', '/experiments']) {
        expect((await app.handle(request(`/api/v1/admin/marketing${path}`))).status).toBe(403)
      }
    })
  })
})

const putBrand = (body: unknown, origin = config.adminUrl) =>
  request('/api/v1/admin/marketing/settings/catalog-brand', { method: 'PUT', body: JSON.stringify(body) }, 'staff', origin)

describe('catalog brand route', () => {
  it('forbids support staff', async () => {
    const { app, calls } = await createHarness('support')
    expect((await app.handle(putBrand({ catalogBrandName: 'x', version: 1 }))).status).toBe(403)
    expect(calls).toEqual([])
  })

  it('maps invalid names to INVALID_MARKETING_SETTINGS', async () => {
    const { app } = await createHarness('owner', true, new MarketingSettingsService(null as never, null as never))
    const response = await app.handle(putBrand({ catalogBrandName: '   ', version: 1 }))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'INVALID_MARKETING_SETTINGS' })
  })

  it('updates the brand name', async () => {
    const { app, calls } = await createHarness()
    const response = await app.handle(putBrand({ catalogBrandName: 'สวนบ้านเรา', version: 1 }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ catalogBrandName: 'suannn' })
    expect(calls.find((call) => call.method === 'updateCatalogBrand')?.args[0]).toEqual({ catalogBrandName: 'สวนบ้านเรา', version: 1 })
  })
})

describe('assertCatalogBrandInput', () => {
  it('accepts 70 characters', () => {
    expect(() => assertCatalogBrandInput({ catalogBrandName: 'x'.repeat(70), version: 1 })).not.toThrow()
  })

  it('rejects unusable input', () => {
    for (const input of [
      { catalogBrandName: '', version: 1 },
      { catalogBrandName: '   ', version: 1 },
      { catalogBrandName: 'x'.repeat(71), version: 1 },
      { catalogBrandName: 'a\u0000b', version: 1 },
      { catalogBrandName: 'ok', version: 1, extra: true },
      { catalogBrandName: 'ok', version: 1.5 },
    ]) {
      expect(() => assertCatalogBrandInput(input)).toThrow(expect.objectContaining({ code: 'INVALID_MARKETING_SETTINGS' }))
    }
  })
})
