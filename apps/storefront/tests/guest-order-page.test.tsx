import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Component } from '../src/pages/orders/guest-order-page'
import { CartProvider } from '../src/components/cart/cart-provider'

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

function renderPage() {
  const tokens: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes(`/store/orders/${orderId}`)) {
      tokens.push(new Headers(init?.headers).get('X-Order-Access-Token') ?? '')
      return new Response(JSON.stringify(order), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  const router = createMemoryRouter([{ path: '/orders/guest/:orderId', Component }], { initialEntries: [`/orders/guest/${orderId}`] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><CartProvider><RouterProvider router={router} /></CartProvider></QueryClientProvider>)
  return { tokens, user: userEvent.setup() }
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
