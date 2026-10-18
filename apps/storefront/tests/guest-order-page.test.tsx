import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Component } from '../src/pages/orders/guest-order-page'
import { CartProvider } from '../src/components/cart/cart-provider'
import { guestOrderTokenFromHash, readGuestOrderToken, savePendingCheckout } from '../src/lib/store-orders'

const orderId = '00000000-0000-4000-8000-0000000000aa'
const order = {
  id: orderId,
  orderNumber: 'PAY-20261016-000000AA',
  status: 'placed',
  paymentMethod: 'stripe',
  subtotalSatang: 14000,
  shippingSatang: 5000,
  totalSatang: 19000,
  items: [{ id: 'item-1', productName: 'แยมส้ม', variantName: 'ขนาดมาตรฐาน', quantity: 1, lineTotalSatang: 14000 }],
  payment: { status: 'collected', refund: null },
  shipment: null,
}
const originalFetch = globalThis.fetch

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
  sessionStorage.clear()
})

function renderPage(entry = `/orders/guest/${orderId}`, validToken?: string, body: Record<string, unknown> = order) {
  const tokens: string[] = []
  const pdfTokens: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes(`/store/orders/${orderId}/receipt.pdf`)) {
      pdfTokens.push(new Headers(init?.headers).get('X-Order-Access-Token') ?? '')
      return new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } })
    }
    if (String(input).includes(`/store/orders/${orderId}`)) {
      const token = new Headers(init?.headers).get('X-Order-Access-Token') ?? ''
      tokens.push(token)
      if (validToken && token !== validToken) return new Response('{"code":"ORDER_NOT_FOUND"}', { status: 404, headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  const router = createMemoryRouter([{ path: '/orders/guest/:orderId', Component }], { initialEntries: [entry] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><CartProvider><RouterProvider router={router} /></CartProvider></QueryClientProvider>)
  return { tokens, pdfTokens, router, user: userEvent.setup() }
}

test('looks up a guest order with a browser-autofilled token React state never saw', async () => {
  const { tokens, user } = renderPage()
  const input = screen.getByLabelText('รหัสเข้าดูคำสั่งซื้อ') as HTMLInputElement
  input.value = 'autofilled-token'

  await user.click(screen.getByRole('button', { name: 'ดูคำสั่งซื้อ' }))

  expect(await screen.findByText(`คำสั่งซื้อ ${order.orderNumber}`)).toBeTruthy()
  expect(tokens).toEqual(['autofilled-token'])
})

test('explains a missing token instead of ignoring the click', async () => {
  const { tokens, user } = renderPage()

  await user.click(screen.getByRole('button', { name: 'ดูคำสั่งซื้อ' }))

  expect(await screen.findByText('กรอกรหัสเข้าดูคำสั่งซื้อจากอีเมลยืนยันคำสั่งซื้อ')).toBeTruthy()
  expect(screen.getByLabelText('รหัสเข้าดูคำสั่งซื้อ').getAttribute('aria-invalid')).toBe('true')
  expect(tokens).toEqual([])
})

test('opens an emailed link straight to the order and strips the token from the URL', async () => {
  const { tokens, router } = renderPage(`/orders/guest/${orderId}#token=emailed%2Ftoken`)

  expect(await screen.findByText(`คำสั่งซื้อ ${order.orderNumber}`)).toBeTruthy()
  expect(screen.queryByLabelText('รหัสเข้าดูคำสั่งซื้อ')).toBeNull()
  expect(tokens).toEqual(['emailed/token'])
  expect(router.state.location.hash).toBe('')
  expect(readGuestOrderToken(orderId)).toBe('emailed/token')
})

test('opens the order without a form after returning from Stripe', async () => {
  savePendingCheckout({ orderId, paymentMethod: 'stripe', guestAccessToken: 'checkout-token', expiresAt: new Date(Date.now() + 60_000).toISOString() })
  const { tokens } = renderPage()

  expect(await screen.findByText(`คำสั่งซื้อ ${order.orderNumber}`)).toBeTruthy()
  expect(screen.queryByLabelText('รหัสเข้าดูคำสั่งซื้อ')).toBeNull()
  expect(tokens).toEqual(['checkout-token'])
})

test('falls back to the token form when a link token is rejected', async () => {
  const { tokens, user } = renderPage(`/orders/guest/${orderId}#token=stale`, 'fresh')

  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(readGuestOrderToken(orderId)).toBe('')
  await user.type(screen.getByLabelText('รหัสเข้าดูคำสั่งซื้อ'), 'fresh')
  await user.click(screen.getByRole('button', { name: 'ดูคำสั่งซื้อ' }))

  expect(await screen.findByText(`คำสั่งซื้อ ${order.orderNumber}`)).toBeTruthy()
  expect(tokens).toEqual(['stale', 'fresh'])
})

test('reads only the token parameter from a link fragment', () => {
  expect(guestOrderTokenFromHash('#token=a%2Bb')).toBe('a+b')
  expect(guestOrderTokenFromHash('#other=1')).toBe('')
  expect(guestOrderTokenFromHash('')).toBe('')
})

const billing = { name: 'สมชาย ใจดี', phone: '0812345678', addressLine1: '99 ถนนสุขุมวิท', addressLine2: null, subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' }
const receipt = { number: 'RC-20261018-0001', kind: 'receipt', status: 'issued', issuedAt: '2026-10-18T00:00:00.000Z' }

test('billing card renders billing name and phone', async () => {
  renderPage(`/orders/guest/${orderId}#token=t`, undefined, { ...order, billing })

  expect(await screen.findByText('ที่อยู่ออกใบเสร็จ')).toBeTruthy()
  expect(screen.getByText('สมชาย ใจดี')).toBeTruthy()
  expect(screen.getByText('0812345678')).toBeTruthy()
})

test('download button hidden without receipt', async () => {
  renderPage(`/orders/guest/${orderId}#token=t`, undefined, { ...order, billing, receipt: null })

  await screen.findByText('ที่อยู่ออกใบเสร็จ')
  expect(screen.queryByRole('button', { name: /ดาวน์โหลดใบเสร็จ/ })).toBeNull()
})

test('guest receipt download sends X-Order-Access-Token', async () => {
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  const revoked: string[] = []
  URL.createObjectURL = () => 'blob:receipt'
  URL.revokeObjectURL = url => { revoked.push(url) }
  try {
    const { pdfTokens, user } = renderPage(`/orders/guest/${orderId}#token=guest-secret`, undefined, { ...order, billing, receipt })

    expect(await screen.findByText('RC-20261018-0001')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /ดาวน์โหลดใบเสร็จ/ }))

    await waitFor(() => expect(pdfTokens).toEqual(['guest-secret']))
    await waitFor(() => expect(revoked).toEqual(['blob:receipt']))
  } finally {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
})

test('shows the cancelled badge but keeps download available', async () => {
  renderPage(`/orders/guest/${orderId}#token=t`, undefined, { ...order, billing, receipt: { ...receipt, status: 'cancelled' } })

  expect(await screen.findByText('ใบเสร็จถูกยกเลิก')).toBeTruthy()
  expect(screen.getByRole('button', { name: /ดาวน์โหลดใบเสร็จ/ })).toBeTruthy()
})

test('shows an inline error when the receipt download fails', async () => {
  const { user } = renderPage(`/orders/guest/${orderId}#token=t`, undefined, { ...order, billing, receipt })
  const base = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes('receipt.pdf') ? new Response('{}', { status: 404 }) : base(input, init)) as typeof fetch

  await user.click(await screen.findByRole('button', { name: /ดาวน์โหลดใบเสร็จ/ }))

  expect((await screen.findByRole('alert')).textContent).toContain('ดาวน์โหลดใบเสร็จไม่สำเร็จ')
})
