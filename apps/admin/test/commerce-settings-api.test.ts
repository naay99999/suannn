import { expect, test } from 'bun:test'
import { createApiClient } from '../src/lib/api'
import { createCommerceSettingsApi } from '../src/lib/commerce-settings/api'

test('reads and updates commerce settings through the typed admin API with credentials', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = []
  const client = createApiClient('https://api.example.test', async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} })
    return Response.json({ id: 1, shippingFeeSatang: 3550, checkoutEnabled: false, version: 2, updatedAt: '2026-10-05T00:00:00Z' })
  })
  const settings = createCommerceSettingsApi(client)
  await settings.get()
  await settings.update({ shippingFeeSatang: 3550, checkoutEnabled: false })
  expect(requests.map(request => ({ path: new URL(request.url).pathname, method: request.init.method ?? 'GET' }))).toEqual([
    { path: '/api/v1/admin/commerce-settings', method: 'GET' },
    { path: '/api/v1/admin/commerce-settings', method: 'PUT' },
  ])
  expect(requests.every(request => request.init.credentials === 'include')).toBe(true)
  expect(JSON.parse(String(requests[1]!.init.body))).toEqual({ shippingFeeSatang: 3550, checkoutEnabled: false })
})
