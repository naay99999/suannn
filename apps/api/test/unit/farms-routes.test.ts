import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { createStoreFarmsModule } from '../../src/modules/farms'
import type { FarmService } from '../../src/modules/farms/service'
import { DomainError } from '../../src/shared/domain-error'
import { createErrorHandlingPlugin } from '../../src/plugins/error-handling'

const farmDetail = {
  id: '00000000-0000-4000-8000-000000000001', slug: 'suan-som', name: 'สวนส้ม', farmerName: 'คุณสม',
  province: 'เชียงใหม่', district: null, summary: 'สวนผลไม้', coverImageUrl: 'https://example.test/farm.jpg',
  coverImageAlt: 'สวนผลไม้', isDemo: true, story: 'เรื่องราวสวน', growingPractices: 'วิธีปลูก',
  portraitImageUrl: null, portraitImageAlt: null,
}
const page = { items: [{
  id: farmDetail.id, slug: farmDetail.slug, name: farmDetail.name, farmerName: farmDetail.farmerName,
  province: farmDetail.province, district: null, summary: farmDetail.summary,
  coverImageUrl: farmDetail.coverImageUrl, coverImageAlt: farmDetail.coverImageAlt, isDemo: true,
}], nextCursor: null }

function createApp(overrides: Record<string, (...args: never[]) => unknown> = {}) {
  const service = {
    listStore: async () => page,
    getStoreBySlug: async (slug: string) => {
      if (slug !== 'suan-som') throw new DomainError('FARM_NOT_FOUND')
      return farmDetail
    },
    listProducts: async () => ({ items: [], nextCursor: null }),
    ...overrides,
  } as unknown as FarmService
  return new Elysia().use(createErrorHandlingPlugin()).use(createStoreFarmsModule(service))
}

describe('store farm HTTP contracts', () => {
  it('returns public farm summaries and profiles without private status fields', async () => {
    const app = createApp()
    const list = await app.handle(new Request('http://localhost/api/v1/store/farms'))
    const detail = await app.handle(new Request('http://localhost/api/v1/store/farms/suan-som'))
    expect(list.status).toBe(200)
    expect(await list.json()).toMatchObject({ items: [{ id: farmDetail.id, isDemo: true }], nextCursor: null })
    expect(detail.status).toBe(200)
    expect(await detail.json()).toMatchObject({ slug: farmDetail.slug, story: farmDetail.story })
  })

  it('hides unpublished farms and validates pagination query parameters', async () => {
    const app = createApp()
    const missing = await app.handle(new Request('http://localhost/api/v1/store/farms/private-farm'))
    const invalid = await app.handle(new Request('http://localhost/api/v1/store/farms?limit=101'))
    const unknown = await app.handle(new Request('http://localhost/api/v1/store/farms?debug=true'))
    expect(missing.status).toBe(404)
    expect(invalid.status).toBe(422)
    expect(unknown.status).toBe(422)
  })

  it('serves farm product pagination at the farm-scoped route', async () => {
    const app = createApp({ listProducts: async () => ({ items: [], nextCursor: null }) })
    const response = await app.handle(new Request('http://localhost/api/v1/store/farms/suan-som/products?limit=5'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [], nextCursor: null })
  })
})
