import { expect, spyOn, test } from 'bun:test'
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

test('cancel receipt requires a reason and sends idempotency key', async () => {
  const requests: Array<{ url: string; key: string | null; body: unknown }> = []
  const client = createApiClient('https://api.example.test', async (input, init) => {
    const request = input instanceof Request ? input : null
    const headers = new Headers(init?.headers ?? request?.headers)
    requests.push({ url: String(input), key: headers.get('idempotency-key'), body: typeof init?.body === 'string' ? JSON.parse(init.body) : null })
    return Response.json({ id: orderId })
  })
  const orders = createOrdersApi(client)
  const key = '00000000-0000-4000-8000-000000000099'
  await orders.execute(orderId, { kind: 'issueReceipt' }, key)
  await orders.execute(orderId, { kind: 'cancelReceipt', reason: 'ออกผิดชื่อ' }, key)
  expect(new URL(requests[0]!.url).pathname).toBe(`/api/v1/admin/orders/${orderId}/receipt`)
  expect(new URL(requests[1]!.url).pathname).toBe(`/api/v1/admin/orders/${orderId}/receipt/cancel`)
  expect(requests.map(r => r.key)).toEqual([key, key])
  expect(requests[1]!.body).toEqual({ reason: 'ออกผิดชื่อ' })
})

test('download triggers an anchor click with the receipt filename and defers revoke', async () => {
  const client = createApiClient('https://api.example.test', async () => new Response('pdf'))
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const orders = createOrdersApi(client, { baseUrl: 'https://api.example.test', fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(input), init }); return new Response('pdf') }) as typeof fetch })
  const created = spyOn(URL, 'createObjectURL').mockReturnValue('blob:receipt')
  const revoked = spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const timers: Array<() => void> = []
  const timeout = spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => { timers.push(fn); return 0 }) as never)
  const names: string[] = []
  const click = spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); expect(this.href).toContain('blob:receipt') })
  try {
    await orders.downloadReceipt(orderId, 'RC261018-00001')
    expect(calls[0]!.url).toBe(`https://api.example.test/api/v1/admin/orders/${orderId}/receipt.pdf`)
    expect(calls[0]!.init?.credentials).toBe('include')
    expect(names).toEqual(['RC261018-00001.pdf'])
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revoked).not.toHaveBeenCalled()
    timers[0]!()
    expect(revoked).toHaveBeenCalledWith('blob:receipt')
  } finally { created.mockRestore(); revoked.mockRestore(); timeout.mockRestore(); click.mockRestore() }
})
