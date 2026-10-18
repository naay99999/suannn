import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { CartProvider } from '../src/components/cart/cart-provider'
import { Component } from '../src/pages/account/order-detail-page'
import { authSessionQuery } from '../src/lib/auth-session'
import { receiptDownloadConfig } from '../src/lib/store-orders'
import { orderQueryKey, ordersQueryKey } from '../src/pages/account/account-queries'

const orderId = '00000000-0000-4000-8000-0000000000bb'
const userId = 'user-1'
const order = {
  id: orderId, orderNumber: 'SN-1', status: 'placed', paymentMethod: 'cod', createdAt: '2026-10-18T00:00:00.000Z',
  subtotalSatang: 100, shippingSatang: 0, totalSatang: 100, items: [], payment: { status: 'awaiting_collection', refund: null }, shipment: null,
  recipientName: 'ผู้รับ', contactPhone: '0800000000', addressLine1: '1', addressLine2: null, subdistrict: 'a', district: 'b', province: 'c', postalCode: '10110',
  billing: { name: 'สมชาย ใจดี', phone: '0812345678', addressLine1: '99', addressLine2: null, subdistrict: 'a', district: 'b', province: 'c', postalCode: '10110' },
  receipt: { number: 'RC-20261018-0002', kind: 'receipt', status: 'issued', issuedAt: '2026-10-18T00:00:00.000Z' },
}
const originalFetch = globalThis.fetch
const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL
const originalClick = HTMLAnchorElement.prototype.click
const originalDelay = receiptDownloadConfig.revokeDelayMs

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
  HTMLAnchorElement.prototype.click = originalClick
  receiptDownloadConfig.revokeDelayMs = originalDelay
})

test('customer receipt download sends credentials and triggers the anchor download', async () => {
  const pdfCalls: RequestInit[] = []
  const clicks: { download: string; href: string }[] = []
  const revoked: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.includes('receipt.pdf')) { pdfCalls.push(init ?? {}); return new Response('%PDF', { status: 200 }) }
    return new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  URL.createObjectURL = () => 'blob:customer'
  URL.revokeObjectURL = url => { revoked.push(url) }
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { clicks.push({ download: this.download, href: this.getAttribute('href') ?? '' }) }
  receiptDownloadConfig.revokeDelayMs = 50

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  queryClient.setQueryData(authSessionQuery.queryKey, { session: { id: 's', expiresAt: '' }, user: { id: userId, name: 'n', email: 'e', emailVerified: true, image: null, accountType: 'customer' } })
  queryClient.setQueryData(orderQueryKey(userId, orderId), order)
  const router = createMemoryRouter([{ path: '/account/orders/:orderId', Component }], { initialEntries: [`/account/orders/${orderId}`] })
  render(<QueryClientProvider client={queryClient}><CartProvider><RouterProvider router={router} /></CartProvider></QueryClientProvider>)
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: /ดาวน์โหลดใบเสร็จ/ }))

  await waitFor(() => expect(clicks).toEqual([{ download: 'RC-20261018-0002.pdf', href: 'blob:customer' }]))
  expect(pdfCalls[0]?.credentials).toBe('include')
  expect(revoked).toEqual([])
  await waitFor(() => expect(revoked).toEqual(['blob:customer']))
})

function renderDetail(seed: (queryClient: QueryClient) => void) {
  // Keep the detail request in flight so the page shows what it had before the response.
  globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  queryClient.setQueryData(authSessionQuery.queryKey, { session: { id: 's', expiresAt: '' }, user: { id: userId, name: 'n', email: 'e', emailVerified: true, image: null, accountType: 'customer' } })
  seed(queryClient)
  const router = createMemoryRouter([{ path: '/account/orders/:orderId', Component }], { initialEntries: [`/account/orders/${orderId}`] })
  render(<QueryClientProvider client={queryClient}><CartProvider><RouterProvider router={router} /></CartProvider></QueryClientProvider>)
}

test('delivered orders offer reorder and show the shipment up front', async () => {
  const shipment = { carrier: 'thailand_post', carrierName: null, trackingNumber: 'EF123456789TH', shippedAt: '2026-10-19T00:00:00.000Z' }
  renderDetail(queryClient => queryClient.setQueryData(orderQueryKey(userId, orderId), { ...order, status: 'delivered', payment: { status: 'collected' }, shipment }))

  expect(await screen.findByRole('button', { name: 'สั่งซื้ออีกครั้ง' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'การจัดส่ง' })).toBeTruthy()
  expect(screen.getByText('EF123456789TH')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'ยกเลิกคำสั่งซื้อ' })).toBeNull()
})

test('renders the orders-list copy immediately while the detail loads', async () => {
  renderDetail(queryClient => queryClient.setQueryData(ordersQueryKey(userId), { pages: [{ items: [order], nextCursor: null }], pageParams: [undefined] }))

  expect(await screen.findByRole('heading', { name: 'SN-1' })).toBeTruthy()
  expect(screen.queryByRole('status', { name: 'กำลังโหลดคำสั่งซื้อ' })).toBeNull()
})
