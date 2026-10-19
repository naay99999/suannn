import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { loadConfig } from '../../src/config/env'
import { createAdminMediaModule } from '../../src/modules/media'
import { normalizeAlt, normalizeFilename } from '../../src/modules/media/policy'
import { mapMediaDeleteError } from '../../src/modules/media/repository'
import type { MediaService } from '../../src/modules/media/service'
import type { StaffMediaItem } from '../../src/modules/media/types'
import type { RateLimiter } from '../../src/modules/rate-limit/service'
import type { Auth } from '../../src/plugins/auth/auth'
import { createErrorHandlingPlugin } from '../../src/plugins/error-handling'
import { DomainError } from '../../src/shared/domain-error'
import { testEnv } from '../fixtures'

const config = loadConfig(testEnv)
const mediaId = '00000000-0000-4000-8000-000000000010'
const item: StaffMediaItem = {
  id: mediaId, url: `https://pub.test/media/${mediaId}/display.webp`,
  thumbUrl: `https://pub.test/media/${mediaId}/thumb.webp`, alt: null, width: 800, height: 600,
  byteSize: 1234, originalFilename: 'tomato.jpg', createdAt: new Date('2026-01-01T00:00:00Z'),
  usage: { products: 0, farms: 0 },
}

function createApp(limiterAllowed = true) {
  const calls: string[] = []
  let uploads = 0
  const service = {
    list: async () => { calls.push('list'); return { items: [item], nextCursor: null } },
    get: async () => { calls.push('get'); return { ...item, usedBy: { products: [], farms: [] } } },
    upload: async () => { calls.push('upload'); return { item, created: uploads++ === 0 } },
    updateAlt: async () => { calls.push('updateAlt'); return item },
    delete: async () => { calls.push('delete') },
  } as unknown as MediaService
  const auth = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const identity = headers.get('cookie')?.replace('session=', '')
        if (!identity) return null
        if (identity === 'customer') return { user: { id: 'customer-1', accountType: 'customer' }, session: { id: 's' } }
        return { user: { id: 'staff-1', accountType: 'staff' }, staff: { role: identity, permissions: [] }, session: { id: 's' } }
      },
      generateOpenAPISchema: async () => ({ components: {}, paths: {} }),
    },
    handler: async () => new Response(),
  } as unknown as Auth
  const limiter = {
    consume: async () => ({ allowed: limiterAllowed, remaining: 0, retryAfterSeconds: 30, resetAt: new Date() }),
  } as unknown as RateLimiter
  const app = new Elysia().use(createErrorHandlingPlugin()).use(createAdminMediaModule(config, auth, service, limiter))
  return { app, calls }
}

function json(path: string, method: string, role?: string, body?: unknown) {
  const headers = new Headers({ origin: testEnv.ADMIN_URL, 'content-type': 'application/json' })
  if (role) headers.set('cookie', `session=${role}`)
  return new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}

function upload(role?: string, extra: Record<string, string> = {}) {
  const form = new FormData()
  form.set('file', new File([new Uint8Array([1, 2, 3])], 'tomato.jpg', { type: 'image/jpeg' }))
  for (const [key, value] of Object.entries(extra)) form.set(key, value)
  const headers = new Headers({ origin: testEnv.ADMIN_URL })
  if (role) headers.set('cookie', `session=${role}`)
  return new Request('http://localhost/api/v1/admin/media', { method: 'POST', headers, body: form })
}

describe('admin media HTTP contracts', () => {
  it('rejects unauthenticated requests', async () => {
    const { app, calls } = createApp()
    expect((await app.handle(json('/api/v1/admin/media', 'GET'))).status).toBe(401)
    expect((await app.handle(upload())).status).toBe(401)
    expect(calls).toEqual([])
  })

  it('lets a catalog:read role read but not write', async () => {
    const { app, calls } = createApp()
    expect((await app.handle(json('/api/v1/admin/media', 'GET', 'fulfillment'))).status).toBe(200)
    expect((await app.handle(json(`/api/v1/admin/media/${mediaId}`, 'GET', 'fulfillment'))).status).toBe(200)
    const writes = await Promise.all([
      app.handle(upload('fulfillment')),
      app.handle(json(`/api/v1/admin/media/${mediaId}`, 'PATCH', 'fulfillment', { alt: 'x' })),
      app.handle(json(`/api/v1/admin/media/${mediaId}`, 'DELETE', 'fulfillment')),
    ])
    expect(writes.map(({ status }) => status)).toEqual([403, 403, 403])
    expect(calls).toEqual(['list', 'get'])
  })

  it('returns 201 for a new upload and 200 for a duplicate', async () => {
    const { app } = createApp()
    const first = await app.handle(upload('catalog_manager', { alt: 'Tomatoes' }))
    const second = await app.handle(upload('catalog_manager'))
    expect(first.status).toBe(201)
    expect(await first.json()).toMatchObject({ id: mediaId, url: item.url, usage: { products: 0, farms: 0 } })
    expect(second.status).toBe(200)
  })

  it('rejects multipart uploads from an untrusted origin', async () => {
    const { app, calls } = createApp()
    const request = upload('catalog_manager')
    request.headers.set('origin', 'https://evil.example')
    expect((await app.handle(request)).status).toBe(403)
    expect(calls).toEqual([])
  })

  it('returns 429 when the upload rate limit is exhausted', async () => {
    const { app, calls } = createApp(false)
    const response = await app.handle(upload('catalog_manager'))
    expect(response.status).toBe(429)
    expect(calls).toEqual([])
  })

  it('rejects unknown query fields and out-of-range limits', async () => {
    const { app } = createApp()
    expect((await app.handle(json('/api/v1/admin/media?debug=1', 'GET', 'catalog_manager'))).status).toBe(422)
    expect((await app.handle(json('/api/v1/admin/media?limit=61', 'GET', 'catalog_manager'))).status).toBe(422)
    expect((await app.handle(json('/api/v1/admin/media?limit=0', 'GET', 'catalog_manager'))).status).toBe(422)
    expect((await app.handle(json(`/api/v1/admin/media?q=${'a'.repeat(201)}`, 'GET', 'catalog_manager'))).status).toBe(422)
    expect((await app.handle(json('/api/v1/admin/media?limit=60&q=tom', 'GET', 'catalog_manager'))).status).toBe(200)
  })

  it('updates alt and deletes with 204', async () => {
    const { app, calls } = createApp()
    expect((await app.handle(json(`/api/v1/admin/media/${mediaId}`, 'PATCH', 'catalog_manager', { alt: null }))).status).toBe(200)
    expect((await app.handle(json(`/api/v1/admin/media/${mediaId}`, 'PATCH', 'catalog_manager', { alt: 'a', extra: 1 }))).status).toBe(422)
    const removed = await app.handle(json(`/api/v1/admin/media/${mediaId}`, 'DELETE', 'catalog_manager'))
    expect(removed.status).toBe(204)
    expect(calls).toEqual(['updateAlt', 'delete'])
  })
})

describe('media policy and error mapping', () => {
  it('normalizes alt text', () => {
    expect(normalizeAlt('  Tomatoes ')).toBe('Tomatoes')
    expect(normalizeAlt('   ')).toBeNull()
    expect(normalizeAlt(null)).toBeNull()
    expect(() => normalizeAlt('a'.repeat(201))).toThrow(DomainError)
    expect(() => normalizeAlt(5)).toThrow(DomainError)
  })

  it('normalizes filenames to a trimmed basename', () => {
    expect(normalizeFilename('  C:\\photos\\tomato.jpg ')).toBe('tomato.jpg')
    expect(normalizeFilename('/tmp/a/b.png')).toBe('b.png')
    expect(normalizeFilename('   ')).toBe('image')
    expect(normalizeFilename('x'.repeat(300))).toHaveLength(255)
  })

  it('maps a foreign key violation on delete to MEDIA_IN_USE', () => {
    const mapped = mapMediaDeleteError(new Error('query failed', { cause: { code: '23503' } }))
    expect(mapped).toBeInstanceOf(DomainError)
    expect((mapped as DomainError).code).toBe('MEDIA_IN_USE')
    const other = new Error('boom')
    expect(mapMediaDeleteError(other)).toBe(other)
  })
})
