import { expect, test } from 'bun:test'
import { downloadCustomerReceipt, downloadGuestReceipt, StoreOrderRequestError } from '../src/lib/store-orders'
import { orderQueryKey } from '../src/pages/account/account-queries'
import { formatSatang, latestOrder, mergeOrderPages, orderStatusLabels } from '../src/pages/account/order-display'

test('labels every API order status', () => {
  expect(Object.keys(orderStatusLabels).sort()).toEqual([
    'cancelled', 'delivered', 'packed', 'pending_payment', 'placed', 'processing', 'shipped',
  ])
})

test('formats satang as Thai baht without dropping cents', () => {
  expect(formatSatang(12950)).toContain('129.50')
  expect(formatSatang(0)).toContain('0.00')
})

test('selects the newest order from a page even when API order changes', () => {
  const first = { id: 'old', createdAt: '2026-09-01T00:00:00Z' }
  const second = { id: 'new', createdAt: '2026-09-20T00:00:00Z' }
  expect(latestOrder([first, second])?.id).toBe('new')
  expect(latestOrder([])).toBeUndefined()
})

test('appends cursor pages without duplicate order cards', () => {
  expect(mergeOrderPages([
    { items: [{ id: 'a' }, { id: 'b' }] },
    { items: [{ id: 'b' }, { id: 'c' }] },
  ])).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
})

test('scopes order details to the signed-in customer', () => {
  expect(orderQueryKey('customer-a', 'order-1')).not.toEqual(orderQueryKey('customer-b', 'order-1'))
})

test('customer receipt download includes the session cookie and rejects non-OK responses', async () => {
  const calls: RequestInit[] = []
  const fetcher = (async (_url: unknown, init?: RequestInit) => { calls.push(init ?? {}); return new Response('{"code":"RECEIPT_NOT_FOUND"}', { status: 404 }) }) as typeof fetch
  const error = await downloadCustomerReceipt('order-1', fetcher).catch(e => e)

  expect(error).toBeInstanceOf(StoreOrderRequestError)
  expect(error.status).toBe(404)
  expect(calls[0]?.credentials).toBe('include')
})

test('guest receipt download rejects when the token is missing', async () => {
  const error = await downloadGuestReceipt('order-1', ' ', (async () => new Response('')) as typeof fetch).catch(e => e)

  expect(error).toBeInstanceOf(StoreOrderRequestError)
})
