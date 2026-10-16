import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
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

function renderPage(entry = `/orders/guest/${orderId}`, validToken?: string) {
  const tokens: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes(`/store/orders/${orderId}`)) {
      const token = new Headers(init?.headers).get('X-Order-Access-Token') ?? ''
      tokens.push(token)
      if (validToken && token !== validToken) return new Response('{"code":"ORDER_NOT_FOUND"}', { status: 404, headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify(order), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  const router = createMemoryRouter([{ path: '/orders/guest/:orderId', Component }], { initialEntries: [entry] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><CartProvider><RouterProvider router={router} /></CartProvider></QueryClientProvider>)
  return { tokens, router, user: userEvent.setup() }
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
