import { afterEach, describe, expect, test } from 'bun:test'
import {
  getStoreFarm,
  getStoreFarmProducts,
  getStoreFarms,
  StoreFarmRequestError,
  storeFarmDetailQueryKey,
  storeFarmListQueryKey,
  storeFarmProductsQueryKey,
} from '../src/lib/store-farms'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

describe('store farm query helpers', () => {
  test('keeps list filters and farm slugs isolated in their query keys', () => {
    expect(storeFarmListQueryKey({ limit: 12 })).toEqual(['store-farms', { limit: 12 }])
    expect(storeFarmDetailQueryKey('mae-rim')).toEqual(['store-farm', 'mae-rim'])
    expect(storeFarmProductsQueryKey('mae-rim', { limit: 8 })).toEqual(['store-farm-products', 'mae-rim', { limit: 8 }])
    expect(storeFarmDetailQueryKey('lamphun')).not.toEqual(storeFarmDetailQueryKey('mae-rim'))
  })

  test('calls public farm endpoints and preserves cursor parameters', async () => {
    const requests: URL[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input.url : String(input)
      const url = new URL(request)
      requests.push(url)
      return Response.json({ items: [], nextCursor: null })
    }) as typeof fetch

    await getStoreFarms({ limit: 12 })
    await getStoreFarm('mae-rim')
    await getStoreFarmProducts('mae-rim', { limit: 8, cursor: 'next-page' })

    expect(requests.map(url => url.pathname)).toEqual([
      '/api/v1/store/farms',
      '/api/v1/store/farms/mae-rim',
      '/api/v1/store/farms/mae-rim/products',
    ])
    expect(requests[2]?.searchParams.get('cursor')).toBe('next-page')
  })

  test('maps private profile responses to a farm-specific request error', async () => {
    globalThis.fetch = (async () => Response.json({ code: 'FARM_NOT_FOUND' }, { status: 404 })) as typeof fetch
    await expect(getStoreFarm('private')).rejects.toMatchObject({
      name: 'StoreFarmRequestError', status: 404, code: 'FARM_NOT_FOUND',
    } satisfies Partial<StoreFarmRequestError>)
  })
})
