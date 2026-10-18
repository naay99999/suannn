import { expect, test } from 'bun:test'
import { createApiClient } from '../src/lib/api'
import { createStoreAnnouncementApi } from '../src/lib/store-announcement/api'
import { fromStoreAnnouncement, storeAnnouncementSchema, toStoreAnnouncementInput } from '../src/lib/store-announcement/forms'

const saved = {
  id: 1,
  enabled: true,
  message: 'ลด 25% ทุเรียนหมอนทอง',
  linkLabel: 'ดูสินค้า',
  linkUrl: '/products',
  details: null,
  startsAt: '2026-10-01T03:00:00.000Z',
  endsAt: null,
  version: 2,
  updatedAt: '2026-10-05T00:00:00.000Z',
}

test('reads and updates the announcement through the typed admin API with credentials', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = []
  const client = createApiClient('https://api.example.test', async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} })
    return Response.json(saved)
  })
  const announcements = createStoreAnnouncementApi(client)
  await announcements.get()
  const input = { enabled: true, message: 'ลด 25%', linkLabel: null, linkUrl: null, details: null, startsAt: null, endsAt: null }
  await announcements.update(input)
  expect(requests.map(request => ({ path: new URL(request.url).pathname, method: request.init.method ?? 'GET' }))).toEqual([
    { path: '/api/v1/admin/store-announcement', method: 'GET' },
    { path: '/api/v1/admin/store-announcement', method: 'PUT' },
  ])
  expect(requests.every(request => request.init.credentials === 'include')).toBe(true)
  expect(JSON.parse(String(requests[1]!.init.body))).toEqual(input)
})

test('round-trips saved values through the form and sends nulls for blank fields', () => {
  const values = fromStoreAnnouncement(saved as never)
  expect(values).toMatchObject({ message: saved.message, details: '', endsAt: '' })
  expect(toStoreAnnouncementInput({ ...values, details: '  ' })).toEqual({
    enabled: true,
    message: saved.message,
    linkLabel: 'ดูสินค้า',
    linkUrl: '/products',
    details: null,
    startsAt: '2026-10-01T03:00:00.000Z',
    endsAt: null,
  })
})

test('validates message, link pair, safe URLs, and schedule order', () => {
  const base = { enabled: false, message: '', linkLabel: '', linkUrl: '', details: '', startsAt: '', endsAt: '' }
  const issues = (values: Partial<typeof base>) => {
    const result = storeAnnouncementSchema.safeParse({ ...base, ...values })
    return result.success ? [] : result.error.issues.map(issue => issue.path.join('.'))
  }
  expect(issues({})).toEqual([])
  expect(issues({ enabled: true })).toEqual(['message'])
  expect(issues({ linkLabel: 'ดูสินค้า' })).toEqual(['linkUrl'])
  expect(issues({ linkLabel: 'x', linkUrl: 'javascript:alert(1)' })).toEqual(['linkUrl'])
  expect(issues({ linkLabel: 'x', linkUrl: '//attacker.example' })).toEqual(['linkUrl'])
  expect(issues({ linkLabel: 'x', linkUrl: 'https://example.com/promo' })).toEqual([])
  expect(issues({ startsAt: '2026-10-02T00:00', endsAt: '2026-10-01T00:00' })).toEqual(['endsAt'])
})
