import { expect, test } from 'bun:test'
import { createApiClient } from '../src/lib/api'
import { createDashboardApi } from '../src/lib/dashboard/api'

test('loads the dashboard overview for a range with session credentials', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = []
  const client = createApiClient('https://api.example.test', async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} })
    return Response.json({ range: '7d', daily: [], recentOrders: [] })
  })

  await createDashboardApi(client).overview('7d')

  const url = new URL(requests[0]!.url)
  expect(url.pathname).toBe('/api/v1/admin/dashboard')
  expect(url.searchParams).toEqual(new URLSearchParams({ range: '7d' }))
  expect(requests[0]!.init.credentials).toBe('include')
})

test('maps forbidden responses to an API request error', async () => {
  const client = createApiClient('https://api.example.test', async () => Response.json({ code: 'FORBIDDEN', message: 'Forbidden' }, { status: 403 }))
  await expect(createDashboardApi(client).overview('30d')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
})
