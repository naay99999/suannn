import { expect, test } from 'bun:test'
import { createApiClient } from '../src/lib/api'
import { ApiRequestError } from '../src/lib/api-result'
import { createOrdersApi } from '../src/lib/orders/api'

const orderId = '00000000-0000-4000-8000-000000000010'

test('loads typed staff orders with query cursor, limit and session credentials', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = []
  const client = createApiClient('https://api.example.test', async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} })
    return Response.json({ items: [], nextCursor: 'next-page' })
  })
  const orders = createOrdersApi(client)

  await orders.list({ cursor: 'opaque cursor', limit: 50 })
  await orders.get(orderId)

  expect(new URL(requests[0]!.url).pathname).toBe('/api/v1/admin/orders')
  expect(new URL(requests[0]!.url).searchParams).toEqual(new URLSearchParams({ cursor: 'opaque cursor', limit: '50' }))
  expect(new URL(requests[1]!.url).pathname).toBe(`/api/v1/admin/orders/${orderId}`)
  expect(requests.every(({ init }) => init.credentials === 'include')).toBe(true)
})

test('propagates safe order domain errors and network failures', async () => {
  const missingClient = createApiClient('https://api.example.test', async () => Response.json({ code: 'ORDER_NOT_FOUND' }, { status: 404 }))
  await expect(createOrdersApi(missingClient).get(orderId)).rejects.toBeInstanceOf(ApiRequestError)

  const networkClient = createApiClient('https://api.example.test', async () => { throw new Error('private transport detail') })
  await expect(createOrdersApi(networkClient).list()).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
})
