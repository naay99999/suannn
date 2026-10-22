import { describe, expect, it } from 'bun:test'
import { createCachedPostHog, TtlCache } from '../../src/modules/marketing/posthog/cache'
import { createPostHogReadClient } from '../../src/modules/marketing/posthog/client'
import { getExperiments } from '../../src/modules/marketing/posthog/experiments'
import { getFunnel } from '../../src/modules/marketing/posthog/funnel'

const config = { personalApiKey: 'phx_secret', projectId: '42', host: 'https://us.posthog.com' }
const range = { from: '2026-10-01', to: '2026-10-07' }

interface Seen { url: string, init?: RequestInit }

function fakeFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const seen: Seen[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init })
    return respond(String(url), init)
  }) as typeof fetch
  return { impl, seen }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function funnelFixture(counts: number[]) {
  return { results: counts.map((count, order) => ({ order, count, name: 'x' })) }
}

describe('PostHog read client', () => {
  it('maps ingestion hosts to app hosts and leaves others unchanged', async () => {
    for (const [host, expected] of [
      ['https://us.i.posthog.com', 'https://us.posthog.com'],
      ['https://eu.i.posthog.com', 'https://eu.posthog.com'],
      ['https://ap.i.posthog.com', 'https://ap.posthog.com'],
      ['https://us.posthog.com', 'https://us.posthog.com'],
      ['https://ph.example.com', 'https://ph.example.com'],
    ] as const) {
      const { impl, seen } = fakeFetch(() => json({ results: [] }))
      await createPostHogReadClient({ ...config, host }, impl).listExperiments()
      expect(seen[0]?.url).toBe(`${expected}/api/projects/42/experiments/`)
    }
  })

  it('sends the bearer key and posts queries', async () => {
    const { impl, seen } = fakeFetch(() => json({ results: [] }))
    await createPostHogReadClient(config, impl).query({ kind: 'x' })
    expect(seen[0]?.url).toBe('https://us.posthog.com/api/projects/42/query/')
    expect(seen[0]?.init?.method).toBe('POST')
    expect(new Headers(seen[0]?.init?.headers).get('authorization')).toBe('Bearer phx_secret')
  })

  it('maps failures to codes without leaking the key', async () => {
    const cases: Array<[() => Response, string]> = [
      [() => json({}, 401), 'POSTHOG_READ_AUTH'],
      [() => json({}, 403), 'POSTHOG_READ_AUTH'],
      [() => json({}, 429), 'POSTHOG_READ_UNAVAILABLE'],
      [() => json({}, 502), 'POSTHOG_READ_UNAVAILABLE'],
      [() => json({}, 400), 'POSTHOG_READ_REJECTED'],
      [() => new Response('not json'), 'POSTHOG_READ_UNAVAILABLE'],
    ]
    for (const [respond, code] of cases) {
      const client = createPostHogReadClient(config, fakeFetch(respond).impl)
      await expect(client.listExperiments()).rejects.toMatchObject({ code })
    }
    const down = createPostHogReadClient(config, (async () => { throw new Error('boom phx_secret') }) as unknown as typeof fetch)
    const error = await down.listExperiments().catch((caught: unknown) => caught as Error)
    expect(error).toMatchObject({ code: 'POSTHOG_READ_UNAVAILABLE' })
    expect(String((error as Error).message)).not.toContain('phx_secret')
  })
})

describe('getFunnel', () => {
  it('maps five steps with conversion and drop-off', async () => {
    const { impl, seen } = fakeFetch(() => json(funnelFixture([1000, 600, 120, 60, 18])))
    const result = await getFunnel(createPostHogReadClient(config, impl), range, {})
    expect(result.steps.map(step => step.count)).toEqual([1000, 600, 120, 60, 18])
    expect(result.steps.map(step => step.conversionFromPrevious)).toEqual([null, 0.6, 0.2, 0.5, 0.3])
    expect(result.steps.map(step => step.dropOffFromPrevious)).toEqual([null, 0.4, 0.8, 0.5, 0.7])
    expect(result.steps.map(step => step.event)).toEqual(['$pageview', 'view_item', 'add_to_cart', 'begin_checkout', 'purchase'])
    expect(result.steps[0]?.label).toBe('เข้าเว็บ')
    expect(result.steps[4]?.label).toBe('ซื้อสำเร็จ')
    const body = JSON.parse(String(seen[0]?.init?.body))
    expect(body.query.kind).toBe('FunnelsQuery')
    expect(body.query.funnelsFilter).toMatchObject({ funnelWindowInterval: 1, funnelWindowIntervalUnit: 'day' })
    expect(body.query.dateRange).toEqual({ date_from: '2026-10-01T00:00:00+07:00', date_to: '2026-10-07T23:59:59+07:00' })
    expect(body.query.series).toHaveLength(5)
  })

  it('filters by platform aliases and campaign', async () => {
    const { impl, seen } = fakeFetch(() => json(funnelFixture([5, 4, 3, 2, 1])))
    await getFunnel(createPostHogReadClient(config, impl), range, { platform: 'meta', campaign: 'c1' })
    const properties = JSON.parse(String(seen[0]?.init?.body)).query.properties
    const source = properties.find((property: { key: string }) => property.key === 'utm_source')
    expect(source).toMatchObject({ operator: 'regex' })
    expect(source.value).toBe('(?i)^(meta|facebook|fb|instagram|ig)$')
    expect(properties.find((property: { key: string }) => property.key === 'utm_campaign')).toMatchObject({ operator: 'exact', value: ['c1'] })
  })

  it('has no zero division when a step is empty', async () => {
    const { impl } = fakeFetch(() => json(funnelFixture([0, 0, 0, 0, 0])))
    const result = await getFunnel(createPostHogReadClient(config, impl), range, {})
    expect(result.steps[1]).toMatchObject({ conversionFromPrevious: null, dropOffFromPrevious: null })
  })

  it('rejects an unreadable response', async () => {
    const { impl } = fakeFetch(() => json({ results: 'nope' }))
    await expect(getFunnel(createPostHogReadClient(config, impl), range, {})).rejects.toMatchObject({ code: 'POSTHOG_READ_REJECTED' })
  })
})

describe('TtlCache', () => {
  it('caches for the ttl, refetches after, and never caches failures', async () => {
    let now = 0
    let loads = 0
    const cache = new TtlCache<number>(600_000, () => now)
    const load = async () => ++loads
    expect(await cache.get('a', load)).toBe(1)
    now = 599_999
    expect(await cache.get('a', load)).toBe(1)
    now = 600_000
    expect(await cache.get('a', load)).toBe(2)
    await expect(cache.get('b', async () => { throw new Error('x') })).rejects.toThrow('x')
    expect(await cache.get('b', load)).toBe(3)
  })

  it('caps entries, evicting the oldest', async () => {
    const cache = new TtlCache<number>(600_000, () => 0, 2)
    let loads = 0
    const load = async () => ++loads
    await cache.get('a', load)
    await cache.get('b', load)
    await cache.get('c', load)
    expect(loads).toBe(3)
    await cache.get('b', load)
    await cache.get('c', load)
    expect(loads).toBe(3)
    await cache.get('a', load)
    expect(loads).toBe(4)
  })

  it('drops expired entries when storing', async () => {
    let now = 0
    const cache = new TtlCache<number>(10, () => now, 2)
    let loads = 0
    const load = async () => ++loads
    await cache.get('a', load)
    await cache.get('b', load)
    now = 20
    await cache.get('c', load)
    // Expired a and b were dropped, so c did not evict a live entry; d fits beside c.
    await cache.get('d', load)
    await cache.get('c', load)
    expect(loads).toBe(4)
  })

  it('shares one load between concurrent gets', async () => {
    const cache = new TtlCache<number>(600_000)
    let loads = 0
    const load = async () => { loads += 1; await Promise.resolve(); return loads }
    const [first, second] = await Promise.all([cache.get('a', load), cache.get('a', load)])
    expect(loads).toBe(1)
    expect(first).toBe(second)
  })

  it('serves repeated funnel calls from one fetch for ten minutes', async () => {
    let now = 0
    const { impl, seen } = fakeFetch(() => json(funnelFixture([5, 4, 3, 2, 1])))
    const posthog = createCachedPostHog(config, { fetchImpl: impl, now: () => now })
    await posthog.funnel(range, {})
    await posthog.funnel(range, {})
    expect(seen).toHaveLength(1)
    await posthog.funnel(range, { platform: 'meta' })
    expect(seen).toHaveLength(2)
    now = 10 * 60_000
    await posthog.funnel(range, {})
    expect(seen).toHaveLength(3)
  })
})

const experimentsList = {
  results: [
    { id: 1, name: 'Hero copy', start_date: '2026-10-01T00:00:00Z', end_date: null, feature_flag_key: 'hero-copy' },
    { id: 2, name: 'Draft one', start_date: null, end_date: null, feature_flag_key: 'draft-one' },
    { id: 3, name: 'Odd one', start_date: '2026-09-01T00:00:00Z', end_date: '2026-09-20T00:00:00Z', feature_flag_key: 'odd' },
  ],
}

// Shape follows PostHog's experiment results endpoint (probability, significant, per-variant funnel counts).
const significantResults = {
  significant: true,
  probability: { control: 0.04, test: 0.96 },
  insight: [[
    { order: 0, count: 500, breakdown_value: ['control'] },
    { order: 1, count: 25, breakdown_value: ['control'] },
  ], [
    { order: 0, count: 480, breakdown_value: ['test'] },
    { order: 1, count: 48, breakdown_value: ['test'] },
  ]],
}

describe('getExperiments', () => {
  it('maps a significant experiment, omits drafts, and flags unknown shapes', async () => {
    const { impl } = fakeFetch((url) => {
      if (url.endsWith('/experiments/')) return json(experimentsList)
      if (url.endsWith('/experiments/1/results')) return json(significantResults)
      return json({ something: 'else' })
    })
    const { experiments } = await getExperiments(createPostHogReadClient(config, impl))
    expect(experiments.map(experiment => experiment.id)).toEqual([1, 3])
    expect(experiments[0]).toMatchObject({
      name: 'Hero copy', status: 'running', flagKey: 'hero-copy', winner: 'test', readable: true,
      url: 'https://us.posthog.com/project/42/experiments/1',
      variants: [
        { key: 'control', exposures: 500, conversions: 25, conversionRate: 0.05 },
        { key: 'test', exposures: 480, conversions: 48, conversionRate: 0.1 },
      ],
    })
    expect(experiments[1]).toMatchObject({ status: 'complete', readable: false, variants: null, winner: null })
  })

  it('propagates transient results failures so nothing is cached', async () => {
    for (const status of [500, 401, 429]) {
      const { impl } = fakeFetch((url) => url.endsWith('/experiments/') ? json(experimentsList) : json({}, status))
      await expect(getExperiments(createPostHogReadClient(config, impl))).rejects.toMatchObject({
        code: status === 401 ? 'POSTHOG_READ_AUTH' : 'POSTHOG_READ_UNAVAILABLE',
      })
    }
  })

  it('has no winner when not significant, and degrades a rejected results call', async () => {
    const { impl } = fakeFetch((url) => {
      if (url.endsWith('/experiments/')) return json(experimentsList)
      if (url.endsWith('/experiments/1/results')) return json({ ...significantResults, significant: false })
      return json({}, 400)
    })
    const { experiments } = await getExperiments(createPostHogReadClient(config, impl))
    expect(experiments[0]).toMatchObject({ winner: null, readable: true })
    expect(experiments[1]).toMatchObject({ readable: false })
  })
})
