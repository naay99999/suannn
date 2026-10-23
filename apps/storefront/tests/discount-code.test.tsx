import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { useEffect } from 'react'
import { CartProvider } from '../src/components/cart/cart-provider'
import { SideCart } from '../src/components/cart/side-cart'
import { useCart } from '../src/components/cart/cart-context'
import { authSessionQuery } from '../src/lib/auth-session'
import { discountReasonText } from '../src/lib/store-discount'
import { formatStorePrice } from '../src/lib/store-products'
import type { StoreCartDetail } from '../src/lib/store-cart'
import type { CheckoutQuote } from '../src/lib/store-checkout'
import { OrderSummary } from '../src/pages/checkout/order-summary'
import { Component as ConfirmationPage } from '../src/pages/checkout/confirmation-page'

const variantId = '00000000-0000-4000-8000-000000000101'
const line = { variantId, productId: '00000000-0000-4000-8000-000000000001', productSlug: 'mango', productName: 'มะม่วง', productImageUrl: null, productImageAlt: null, variantName: 'กล่องเล็ก', unit: 'กล่อง', quantity: 2, priceSatang: 10000, canPurchase: true, issues: [], productCategory: 'fresh' as const }
const plainCart: StoreCartDetail = { cartVersion: 1, lines: [line], discount: null }
const originalFetch = globalThis.fetch
let sessionRequest: ReturnType<typeof spyOn<typeof authSessionQuery, 'queryFn'>>
let requests: Array<{ path: string; method: string; body: unknown }> = []
let handlers: Record<string, (body: unknown) => Response> = {}

beforeEach(() => {
  sessionRequest = spyOn(authSessionQuery, 'queryFn').mockResolvedValue(null)
  requests = []
  handlers = {}
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null
    const url = new URL(request?.url ?? String(input))
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    const text = typeof init?.body === 'string' ? init.body : request ? await request.text() : ''
    const body = text ? JSON.parse(text) : null
    requests.push({ path: url.pathname, method, body })
    const handler = handlers[`${method} ${url.pathname}`]
    if (handler) return handler(body)
    if (url.pathname.endsWith('/store/cart')) return Response.json(plainCart)
    throw new Error(`Unexpected request: ${method} ${url.pathname}`)
  }) as typeof fetch
})

afterEach(() => { cleanup(); sessionRequest.mockRestore(); globalThis.fetch = originalFetch })

function OpenCart() {
  const { setOpen } = useCart()
  useEffect(() => { setOpen(true) }, [setOpen])
  return null
}

function mountSideCart() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '/', element: <><OpenCart /><SideCart /></> }])
  render(<QueryClientProvider client={client}><CartProvider><RouterProvider router={router} /></CartProvider></QueryClientProvider>)
  return userEvent.setup()
}

const appliedCart: StoreCartDetail = { ...plainCart, cartVersion: 2, discount: { code: 'MANGO10', status: 'applied', reason: null, shortfallSatang: null, itemDiscountSatang: 2000, freeShipping: false } }

test('applying a code sends it to the API and renders the discount line', async () => {
  handlers['PUT /api/v1/store/cart/discount'] = () => Response.json(appliedCart)
  const user = mountSideCart()

  await user.click(await screen.findByRole('button', { name: 'มีโค้ดส่วนลด?' }))
  await user.type(screen.getByLabelText('โค้ดส่วนลด'), 'mango10')
  await user.click(screen.getByRole('button', { name: 'ใช้โค้ด' }))

  expect(await screen.findByText('ส่วนลด (MANGO10)')).toBeTruthy()
  expect(screen.getByText(`−${formatStorePrice(2000)}`)).toBeTruthy()
  expect(requests.find(request => request.method === 'PUT')?.body).toEqual({ code: 'mango10' })
  expect(screen.getByRole('button', { name: 'ลบโค้ด MANGO10' })).toBeTruthy()
})

test('a code that does not reach the minimum spend is attached with the shortfall explained', async () => {
  handlers['PUT /api/v1/store/cart/discount'] = () => Response.json({ ...plainCart, discount: { code: 'BIG', status: 'not_applicable', reason: 'min_subtotal', shortfallSatang: 8000, itemDiscountSatang: 0, freeShipping: false } })
  const user = mountSideCart()

  await user.click(await screen.findByRole('button', { name: 'มีโค้ดส่วนลด?' }))
  await user.type(screen.getByLabelText('โค้ดส่วนลด'), 'big')
  await user.click(screen.getByRole('button', { name: 'ใช้โค้ด' }))

  expect(await screen.findByText(`ซื้อเพิ่มอีก ${formatStorePrice(8000)} เพื่อใช้โค้ดนี้`)).toBeTruthy()
})

test('a rejected code shows the reason and attaches nothing', async () => {
  handlers['PUT /api/v1/store/cart/discount'] = () => Response.json({ code: 'DISCOUNT_CODE_REJECTED', message: 'x', reason: 'expired' }, { status: 422 })
  const user = mountSideCart()

  await user.click(await screen.findByRole('button', { name: 'มีโค้ดส่วนลด?' }))
  await user.type(screen.getByLabelText('โค้ดส่วนลด'), 'old')
  await user.click(screen.getByRole('button', { name: 'ใช้โค้ด' }))

  expect(await screen.findByText('โค้ดนี้หมดอายุแล้ว')).toBeTruthy()
  expect(screen.getByLabelText('โค้ดส่วนลด').getAttribute('aria-invalid')).toBe('true')
})

test('a rate-limited attempt asks the customer to retry later', async () => {
  handlers['PUT /api/v1/store/cart/discount'] = () => Response.json({ code: 'RATE_LIMITED', message: 'x' }, { status: 429 })
  const user = mountSideCart()

  await user.click(await screen.findByRole('button', { name: 'มีโค้ดส่วนลด?' }))
  await user.type(screen.getByLabelText('โค้ดส่วนลด'), 'spam')
  await user.click(screen.getByRole('button', { name: 'ใช้โค้ด' }))

  expect(await screen.findByText('ลองใหม่อีกครั้งในภายหลัง')).toBeTruthy()
})

test('removing an applied code sends DELETE and drops the discount line', async () => {
  handlers['GET /api/v1/store/cart'] = () => Response.json(appliedCart)
  handlers['DELETE /api/v1/store/cart/discount'] = () => Response.json(plainCart)
  const user = mountSideCart()

  await user.click(await screen.findByRole('button', { name: 'ลบโค้ด MANGO10' }))

  await waitFor(() => expect(screen.queryByText('ส่วนลด (MANGO10)')).toBeNull())
  expect(requests.some(request => request.method === 'DELETE' && request.path === '/api/v1/store/cart/discount')).toBe(true)
})

test('free shipping codes are announced in the cart', async () => {
  handlers['GET /api/v1/store/cart'] = () => Response.json({ ...plainCart, discount: { code: 'SHIPFREE', status: 'applied', reason: null, shortfallSatang: null, itemDiscountSatang: 0, freeShipping: true } })
  mountSideCart()
  expect(await screen.findByText('ส่งฟรี')).toBeTruthy()
})

test('a pending-email code says eligibility is rechecked at checkout', async () => {
  handlers['GET /api/v1/store/cart'] = () => Response.json({ ...plainCart, discount: { code: 'WELCOME', status: 'pending_email', reason: null, shortfallSatang: null, itemDiscountSatang: 0, freeShipping: false } })
  mountSideCart()
  expect(await screen.findByText('ตรวจสอบสิทธิ์อีกครั้งตอนชำระเงิน')).toBeTruthy()
})

test('reason text covers every discount reason in Thai', () => {
  expect(discountReasonText('unknown', null)).toBe('ใช้โค้ดนี้ไม่ได้')
  expect(discountReasonText('not_started', null)).toBe('โค้ดนี้ยังไม่เริ่มใช้')
  expect(discountReasonText('used_up', null)).toBe('โค้ดนี้ถูกใช้ครบแล้ว')
  expect(discountReasonText('already_used', null)).toBe('คุณใช้โค้ดนี้ครบแล้ว')
  expect(discountReasonText('min_quantity', null)).toBe('ยังไม่ถึงจำนวนชิ้นขั้นต่ำของโค้ดนี้')
  expect(discountReasonText('no_eligible_items', null)).toBe('ไม่มีสินค้าในตะกร้าที่ร่วมรายการ')
  expect(discountReasonText('first_order_only', null)).toBe('โค้ดนี้ใช้ได้เฉพาะคำสั่งซื้อแรก')
})

const quoteDiscount = { code: 'MANGO10', status: 'applied' as const, reason: null, shortfallSatang: null, itemDiscountSatang: 2000, freeShipping: false }
const baseQuote = {
  cartVersion: 1, settingsVersion: 1, currency: 'THB' as const,
  lines: [{ variantId, productId: line.productId, productName: 'มะม่วง', variantName: 'กล่องเล็ก', unit: 'กล่อง', quantity: 2, unitPriceSatang: 10000, lineTotalSatang: 20000, discountSatang: 2000 }],
  subtotalSatang: 20000, discountSatang: 2000, shippingDiscountSatang: 0, shippingSatang: 3500, totalSatang: 21500, discount: quoteDiscount,
  expiresAt: new Date(Date.now() + 60_000).toISOString(), quoteToken: 'tok',
} as unknown as CheckoutQuote

test('order summary lists the discount before shipping', () => {
  render(<OrderSummary quote={baseQuote} />)
  expect(screen.getByText('ส่วนลด (MANGO10)')).toBeTruthy()
  expect(screen.getByText(`−${formatStorePrice(2000)}`)).toBeTruthy()
})

test('order summary strikes through the original shipping fee when shipping is free', () => {
  const free = { ...baseQuote, shippingSatang: 0, shippingDiscountSatang: 3500, totalSatang: 18000, discount: { ...quoteDiscount, freeShipping: true } } as CheckoutQuote
  render(<OrderSummary quote={free} />)
  const original = screen.getByText(formatStorePrice(3500))
  expect(original.tagName).toBe('S')
  expect(screen.getByText('ฟรี')).toBeTruthy()
})

test('confirmation page shows the discount row', async () => {
  const orderId = '00000000-0000-4000-8000-000000000030'
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const customer = { session: { id: 's', expiresAt: '2099-01-01T00:00:00.000Z' }, user: { id: 'customer-1', name: 'A', email: 'a@example.test', emailVerified: true, image: null, accountType: 'customer' as const } }
  sessionRequest.mockResolvedValue(customer as never)
  handlers[`GET /api/v1/store/orders/${orderId}`] = () => Response.json({
    id: orderId, orderNumber: 'SU-1', status: 'placed', paymentMethod: 'cod', subtotalSatang: 20000, shippingSatang: 0, totalSatang: 18000,
    discount: { code: 'MANGO10', kind: 'percent', itemDiscountSatang: 2000, shippingDiscountSatang: 0 },
    items: [{ id: 'i1', productName: 'มะม่วง', variantName: 'กล่องเล็ก', quantity: 2, lineTotalSatang: 20000, discountSatang: 2000 }],
  })
  const router = createMemoryRouter([{ path: '/checkout/confirmation/:orderId', Component: ConfirmationPage }], { initialEntries: [`/checkout/confirmation/${orderId}`] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)

  expect(await screen.findByText('ส่วนลด (MANGO10)')).toBeTruthy()
  expect(screen.getByText(`−${formatStorePrice(2000)}`)).toBeTruthy()
})

test('a free-shipping-only code is named on the shipping row', () => {
  const freeOnly = { ...baseQuote, discountSatang: 0, shippingSatang: 0, shippingDiscountSatang: 3500, totalSatang: 20000, discount: { ...quoteDiscount, code: 'SHIPFREE', itemDiscountSatang: 0, freeShipping: true } } as CheckoutQuote
  render(<OrderSummary quote={freeOnly} />)
  expect(screen.getByText('ค่าจัดส่ง (ส่งฟรี SHIPFREE)')).toBeTruthy()
  expect(screen.getByText('ราคาเดิม')).toBeTruthy()
})
