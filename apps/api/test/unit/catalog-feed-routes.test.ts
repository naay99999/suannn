import { describe, expect, it } from 'bun:test'
import { createApp, type AppDependencies } from '../../src/app'
import { loadConfig } from '../../src/config/env'
import { CatalogFeedService } from '../../src/modules/catalog-feed/service'
import type { CatalogVariantRow } from '../../src/modules/catalog-feed/types'
import type { Auth } from '../../src/plugins/auth/auth'
import { DomainError } from '../../src/shared/domain-error'
import { testEnv } from '../fixtures'

const config = loadConfig(testEnv)
const row: CatalogVariantRow = {
  productId: 'p1', slug: 'durian', productName: 'Durian', description: 'Tasty', category: 'fresh',
  variantId: 'v1', variantName: '1 kg', priceSatang: 12900, salesEnabled: true, sellable: true,
  images: [{ url: 'https://cdn.example.test/a.webp', alt: 'a' }],
}
const summary = {
  problems: [], warnings: [] as never[], brandName: 'suannn',
  counts: { total: 1, inFeed: 1, inStock: 1, outOfStock: 0, excluded: 0 },
}

function createService(options: { fail?: () => boolean, now?: () => number } = {}) {
  let calls = 0
  const repository = {
    listVariantRows: async () => {
      calls += 1
      if (options.fail?.()) throw new Error('database down')
      return [row]
    },
  }
  const service = new CatalogFeedService(
    repository,
    { get: async () => ({ marginPercent: 35, catalogBrandName: 'suannn', version: 1, updatedAt: '' }) },
    { get: async () => ({ shippingFeeSatang: 5000, checkoutEnabled: true }) as never },
    'https://shop.example.test',
    options.now,
  )
  return { service, calls: () => calls }
}

async function createHarness(feed: AppDependencies['catalogFeed'], role = 'owner') {
  const auth = {
    handler: async () => new Response(),
    api: {
      generateOpenAPISchema: async () => ({ components: {}, paths: {} }),
      getSession: async ({ headers }: { headers: Headers }) => {
        if (!headers.get('cookie')?.includes('session=')) return null
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
    catalogFeed: feed,
    limiter: {
      consume: async (input: unknown) => {
        limiterCalls.push(input)
        return { allowed: true, remaining: 1, retryAfterSeconds: 1, resetAt: new Date() }
      },
    },
    staffMfaRequired: async () => true,
    identityReservations: { findState: async () => null },
  } as unknown as AppDependencies
  return { app: await createApp(config, dependencies), limiterCalls }
}

describe('catalog feed service', () => {
  it('serves the cached feed within five minutes and rebuilds after', async () => {
    let time = 1_000
    const { service, calls } = createService({ now: () => time })
    const first = await service.xml()
    expect(first.startsWith('<?xml')).toBe(true)
    time += 4 * 60_000
    expect(await service.xml()).toBe(first)
    expect(calls()).toBe(1)
    time += 61_000
    await service.xml()
    expect(calls()).toBe(2)
  })

  it('dedupes concurrent builds', async () => {
    const { service, calls } = createService()
    await Promise.all([service.xml(), service.xml(), service.xml()])
    expect(calls()).toBe(1)
  })

  it('wraps a repository failure and retries instead of caching it', async () => {
    let failing = true
    const { service, calls } = createService({ fail: () => failing })
    const error = await service.xml().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DomainError)
    expect((error as DomainError).code).toBe('CATALOG_FEED_UNAVAILABLE')
    failing = false
    expect((await service.xml()).startsWith('<?xml')).toBe(true)
    expect(calls()).toBe(2)
  })

  it('does not cache the admin summary', async () => {
    const { service, calls } = createService()
    const first = await service.summary()
    await service.summary()
    expect(calls()).toBe(2)
    expect(first.counts.total).toBe(1)
    expect(first.brandName).toBe('suannn')
  })
})

describe('catalog feed routes', () => {
  it('serves the XML feed publicly', async () => {
    const { app, limiterCalls } = await createHarness({ xml: async () => '<?xml version="1.0"?><rss/>', summary: async () => summary })
    const response = await app.handle(new Request('http://localhost/api/v1/store/catalog/feed.xml'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toStartWith('application/xml')
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    expect((await response.text()).startsWith('<?xml')).toBe(true)
    expect(limiterCalls[0]).toMatchObject({ namespace: 'catalog-feed', subjectHash: 'catalog-feed', limit: 120, windowSeconds: 600 })
  })

  it('returns 503 JSON when the feed is unavailable', async () => {
    const { app } = await createHarness({
      xml: async () => { throw new DomainError('CATALOG_FEED_UNAVAILABLE') },
      summary: async () => summary,
    })
    const response = await app.handle(new Request('http://localhost/api/v1/store/catalog/feed.xml'))
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBeNull()
    const text = await response.text()
    expect(text.startsWith('<?xml')).toBe(false)
    expect(JSON.parse(text).code).toBe('CATALOG_FEED_UNAVAILABLE')
  })

  it('guards the admin summary', async () => {
    const feed = { xml: async () => '', summary: async () => summary }
    const { app } = await createHarness(feed)
    const url = 'http://localhost/api/v1/admin/marketing/catalog-feed'
    expect((await app.handle(new Request(url))).status).toBe(401)
    const { app: staffApp } = await createHarness(feed, 'support')
    const denied = await staffApp.handle(new Request(url, { headers: { cookie: 'session=x' } }))
    expect(denied.status).toBe(403)
    const ok = await app.handle(new Request(url, { headers: { cookie: 'session=x' } }))
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as typeof summary).counts).toEqual(summary.counts)
  })
})
