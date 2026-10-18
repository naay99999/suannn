import { expect, test } from 'bun:test'
import { downloadCustomerReceipt, downloadGuestReceipt, StoreOrderRequestError } from '../src/lib/store-orders'
import { orderQueryKey } from '../src/pages/account/account-queries'
import { findOrderInPages, formatDeadline, formatSatang, fulfilmentProgress, isActiveOrder, isSameContactAddress, latestOrder, mergeOrderPages, orderQuantity, orderStatusLabels, previewOrderItems, replaceOrderInPages } from '../src/pages/account/order-display'

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

test('treats only delivered and cancelled orders as settled', () => {
  expect(isActiveOrder({ status: 'pending_payment' })).toBe(true)
  expect(isActiveOrder({ status: 'shipped' })).toBe(true)
  expect(isActiveOrder({ status: 'delivered' })).toBe(false)
  expect(isActiveOrder({ status: 'cancelled' })).toBe(false)
})

test('maps fulfilment progress and leaves unpaid orders before the first step', () => {
  expect(fulfilmentProgress('pending_payment')).toBe(-1)
  expect(fulfilmentProgress('placed')).toBe(0)
  expect(fulfilmentProgress('shipped')).toBe(3)
})

test('previews long order item lists without hiding a single leftover line', () => {
  expect(previewOrderItems([1, 2, 3, 4], 3)).toEqual({ shown: [1, 2, 3, 4], hidden: [] })
  expect(previewOrderItems([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2, 3], hidden: [4, 5] })
  expect(orderQuantity({ items: [{ quantity: 2 }, { quantity: 3 }] } as Parameters<typeof orderQuantity>[0])).toBe(5)
})

test('payment deadlines include the date unless they fall today', () => {
  const now = new Date('2026-10-18T09:00:00+07:00')
  expect(formatDeadline('2026-10-18T14:30:00+07:00', now)).toStartWith('วันนี้')
  expect(formatDeadline('2026-10-19T14:30:00+07:00', now)).not.toStartWith('วันนี้')
})

test('finds and replaces one order inside cached cursor pages', () => {
  const data = { pages: [{ items: [{ id: 'a', status: 'placed' }] }, { items: [{ id: 'b', status: 'placed' }] }], pageParams: [undefined, 'c1'] }
  expect(findOrderInPages(data, 'b')).toEqual({ id: 'b', status: 'placed' })
  expect(findOrderInPages(data, 'missing')).toBeUndefined()
  const next = replaceOrderInPages(data, { id: 'b', status: 'cancelled' })
  expect(next?.pages[1]?.items[0]).toEqual({ id: 'b', status: 'cancelled' })
  expect(next?.pages[0]).toEqual(data.pages[0])
  expect(next?.pageParams).toBe(data.pageParams)
})

test('treats a billing address as the shipping one only when every field matches', () => {
  const address = { name: 'มะลิ', phone: '0812345678', addressLine1: '1', addressLine2: null, subdistrict: 'a', district: 'b', province: 'c', postalCode: '10110' }
  expect(isSameContactAddress(address, { ...address, addressLine2: '' })).toBe(true)
  expect(isSameContactAddress(address, { ...address, phone: '0899999999' })).toBe(false)
})
