import { afterEach, expect, test } from 'bun:test'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { createRef } from 'react'
import { CartContext } from '../src/components/cart/cart-context'
import type { StoreCartDetail } from '../src/lib/store-cart'
import type { AuthSession } from '../src/lib/auth-client'
import { authSessionQuery } from '../src/lib/auth-session'
import type { CustomerAddress } from '../src/pages/account/account-api'
import { Component as CheckoutPage } from '../src/pages/checkout/checkout-page'

const variantId = '00000000-0000-4000-8000-000000000010'
const addressId = '00000000-0000-4000-8000-000000000020'
const orderId = '00000000-0000-4000-8000-000000000030'
const cart: StoreCartDetail = { cartVersion: 1, lines: [{ variantId, productId: '00000000-0000-4000-8000-000000000001', productSlug: 'fruit-box', productName: 'Fruit box', productImageUrl: null, productImageAlt: null, variantName: 'Small box', unit: 'box', quantity: 1, priceSatang: 1000, canPurchase: true, issues: [] }] }
const quote = { cartVersion: 1, settingsVersion: 2, currency: 'THB' as const, lines: [{ variantId, productId: cart.lines[0]!.productId, productName: 'Fruit box', variantName: 'Small box', unit: 'box', quantity: 1, unitPriceSatang: 1000, lineTotalSatang: 1000 }], subtotalSatang: 1000, shippingSatang: 3500, totalSatang: 4500, expiresAt: new Date(Date.now() + 60_000).toISOString(), quoteToken: 'signed-test-quote' }
const customerSession: AuthSession = { session: { id: 'session-1', expiresAt: '2027-01-01T00:00:00.000Z' }, user: { id: 'customer-1', name: 'Mali Buyer', email: 'mali@example.test', emailVerified: true, image: null, accountType: 'customer' } }
const savedAddress: CustomerAddress = { id: addressId, label: 'Home', recipientName: 'Mali Buyer', phone: '0812345678', addressLine1: '1 Main Road', addressLine2: null, subdistrict: 'Suthep', district: 'Mueang', province: 'Chiang Mai', postalCode: '50200', country: 'TH', isDefaultShipping: true, isDefaultBilling: false, createdAt: new Date(), updatedAt: new Date() }
let previousFetch: typeof fetch
let previousLocationAssign: Location['assign']
let holdSessionRequest = false
const stripeRedirects: string[] = []
let requests: Array<{ path: string; method: string; body: Record<string, unknown> | null }> = []
const stripeCheckoutUrl = 'https://checkout.stripe.com/c/pay/cs_test_checkout'

function responseFor(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null
  const url = new URL(request?.url ?? String(input))
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
  let body: Record<string, unknown> | null = null
  try { body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null } catch { body = null }
  requests.push({ path: url.pathname, method, body })
  if (holdSessionRequest && url.pathname === '/api/v1/auth/get-session') return new Promise<Response>(() => {})
  if (url.pathname === '/api/v1/store/checkout/quote') return Response.json(quote)
  if (url.pathname === '/api/v1/customer/addresses') return Response.json({ items: [savedAddress] })
  if (url.pathname === '/api/v1/store/checkout/orders') {
    const result = { order: { id: orderId } }
    return body?.paymentMethod === 'stripe'
      ? Response.json({ ...result, checkout: { url: stripeCheckoutUrl, expiresAt: new Date(Date.now() + 60_000).toISOString() } })
      : Response.json(result)
  }
  return Response.json(null)
}

function mountCheckout(session: AuthSession | null, details?: Record<string, string>, unresolved = false) {
  holdSessionRequest = unresolved
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false } } })
  if (!unresolved) queryClient.setQueryData(authSessionQuery.queryKey, session)
  const router = createMemoryRouter([{ path: '/checkout', element: <CheckoutPage /> }], { initialEntries: [{ pathname: '/checkout', state: details ? { details } : null }] })
  const cartValue = { cart, pending: false, error: null, setItem: async () => {}, removeItem: async () => {}, mergeNotice: null, open: false, setOpen: () => {}, triggerRef: createRef<HTMLButtonElement>() }
  const view = render(<QueryClientProvider client={queryClient}><CartContext.Provider value={cartValue}><RouterProvider router={router} /></CartContext.Provider></QueryClientProvider>)
  return { view, queryClient }
}

afterEach(() => { cleanup(); globalThis.fetch = previousFetch; Object.getPrototypeOf(window.location).assign = previousLocationAssign; holdSessionRequest = false; requests = []; stripeRedirects.length = 0; sessionStorage.clear() })

function interceptStripeRedirect() {
  previousLocationAssign = Object.getPrototypeOf(window.location).assign
  Object.getPrototypeOf(window.location).assign = (url: string | URL) => { stripeRedirects.push(String(url)) }
}

test('fresh guest sees enabled Stripe checkout and cannot accidentally select COD', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  mountCheckout(null)

  const stripe = await screen.findByRole('radio', { name: /ชำระออนไลน์ด้วยบัตร/ })
  expect((stripe as HTMLInputElement).checked).toBe(true)
  expect(screen.queryByRole('radio', { name: /เก็บเงินปลายทาง/ })).toBeNull()
  const submit = await screen.findByRole('button', { name: 'ไปชำระเงินด้วย Stripe' })
  await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false))
})

test('guest submits Stripe checkout with the manual address and redirects to Stripe', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  interceptStripeRedirect()
  mountCheckout(null, { email: 'guest@example.test', phone: '0812345678', recipientName: 'Nok Guest', addressLine1: '1 Main Road', addressLine2: '', subdistrict: 'Suthep', district: 'Mueang', province: 'Chiang Mai', postalCode: '50200' })

  await screen.findByRole('radio', { name: /ชำระออนไลน์ด้วยบัตร/ })
  await userEvent.setup().click(await screen.findByRole('button', { name: 'ไปชำระเงินด้วย Stripe' }))

  await waitFor(() => expect(stripeRedirects).toEqual([stripeCheckoutUrl]))
  const orderRequest = requests.find(request => request.path === '/api/v1/store/checkout/orders')!
  expect(orderRequest.body).toMatchObject({ paymentMethod: 'stripe', contact: { email: 'guest@example.test', phone: '0812345678' }, address: { recipientName: 'Nok Guest', addressLine1: '1 Main Road', subdistrict: 'Suthep', district: 'Mueang', province: 'Chiang Mai', postalCode: '50200' } })
})

test('customer checkout starts at COD, submits the selected payment method and saved address', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  mountCheckout(customerSession)
  const user = userEvent.setup()

  const cod = await screen.findByRole('radio', { name: /เก็บเงินปลายทาง/ })
  expect((cod as HTMLInputElement).checked).toBe(true)
  await user.type(screen.getByLabelText('เบอร์โทรศัพท์'), '0812345678')
  await user.click(screen.getByRole('button', { name: 'ยืนยันคำสั่งซื้อ' }))

  await waitFor(() => expect(requests.some(request => request.path === '/api/v1/store/checkout/orders')).toBe(true))
  const orderRequest = requests.find(request => request.path === '/api/v1/store/checkout/orders')!
  expect(orderRequest.body).toMatchObject({ paymentMethod: 'cod', address: { addressId } })
})

test('customer can switch to Stripe and submits the saved address', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  interceptStripeRedirect()
  mountCheckout(customerSession)
  const user = userEvent.setup()

  const stripe = await screen.findByRole('radio', { name: /ชำระออนไลน์ด้วยบัตร/ })
  await user.click(stripe)
  expect((stripe as HTMLInputElement).checked).toBe(true)
  await user.type(screen.getByLabelText('เบอร์โทรศัพท์'), '0812345678')
  await user.click(screen.getByRole('button', { name: 'ไปชำระเงินด้วย Stripe' }))

  await waitFor(() => expect(stripeRedirects).toEqual([stripeCheckoutUrl]))
  const orderRequest = requests.find(request => request.path === '/api/v1/store/checkout/orders')!
  expect(orderRequest.body).toMatchObject({ paymentMethod: 'stripe', address: { addressId } })
})

test('guest checkout rejects a manual address with missing required fields', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  mountCheckout(null)
  const user = userEvent.setup()

  await screen.findByRole('radio', { name: /ชำระออนไลน์ด้วยบัตร/ })
  await user.type(screen.getByLabelText('อีเมลสำหรับรับรายละเอียดคำสั่งซื้อ'), 'mali@example.test')
  await user.type(screen.getByLabelText('เบอร์โทรศัพท์'), '0812345678')
  await user.click(screen.getByRole('button', { name: 'ไปชำระเงินด้วย Stripe' }))

  expect(await screen.findByText('กรุณากรอกชื่อผู้รับและที่อยู่จัดส่งให้ครบ')).toBeTruthy()
  expect(screen.getByLabelText('ชื่อผู้รับ').getAttribute('aria-invalid')).toBe('true')
  expect(requests.some(request => request.path === '/api/v1/store/checkout/orders')).toBe(false)
})

test('session expiry switches the rendered checkout selection to Stripe', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  const { queryClient } = mountCheckout(customerSession)

  expect((await screen.findByRole('radio', { name: /เก็บเงินปลายทาง/ }) as HTMLInputElement).checked).toBe(true)
  await act(async () => { queryClient.setQueryData(authSessionQuery.queryKey, null) })
  await waitFor(() => expect((screen.getByRole('radio', { name: /ชำระออนไลน์ด้วยบัตร/ }) as HTMLInputElement).checked).toBe(true))
  expect(screen.queryByRole('radio', { name: /เก็บเงินปลายทาง/ })).toBeNull()
})

test('unresolved session blocks order submission until account status is known', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  mountCheckout(null, undefined, true)

  const submit = await screen.findByRole('button', { name: 'ไปชำระเงินด้วย Stripe' })
  expect((submit as HTMLButtonElement).disabled).toBe(true)
  expect(requests.some(request => request.path === '/api/v1/store/checkout/orders')).toBe(false)
})
