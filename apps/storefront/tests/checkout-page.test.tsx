import { afterEach, expect, test } from 'bun:test'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
const savedAddress: CustomerAddress = { id: addressId, label: 'Home', recipientName: 'Mali Buyer', phone: '0812345678', addressLine1: '1 Main Road', addressLine2: null, subdistrict: 'Suthep', district: 'Mueang', province: 'Chiang Mai', postalCode: '50200', country: 'TH', isDefaultShipping: true, isDefaultBilling: true, createdAt: new Date(), updatedAt: new Date() }
const officeAddressId = '00000000-0000-4000-8000-000000000021'
const officeAddress: CustomerAddress = { ...savedAddress, id: officeAddressId, label: 'Office', recipientName: 'Mali Office', phone: '0898765432', addressLine1: '9 Office Road', isDefaultShipping: false, isDefaultBilling: false }
let addressItems: CustomerAddress[] = [savedAddress]
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
  if (url.pathname === '/api/v1/customer/addresses') return Response.json({ items: addressItems })
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

afterEach(() => { cleanup(); globalThis.fetch = previousFetch; Object.getPrototypeOf(window.location).assign = previousLocationAssign; holdSessionRequest = false; addressItems = [savedAddress]; requests = []; stripeRedirects.length = 0; sessionStorage.clear() })

function interceptStripeRedirect() {
  previousLocationAssign = Object.getPrototypeOf(window.location).assign
  Object.getPrototypeOf(window.location).assign = (url: string | URL) => { stripeRedirects.push(String(url)) }
}

test('fresh guest sees enabled Stripe checkout and cannot accidentally select COD', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  mountCheckout(null)

  const stripe = await screen.findByRole('radio', { name: /บัตรเครดิต/ })
  expect((stripe as HTMLInputElement).checked).toBe(true)
  expect(screen.queryByRole('radio', { name: /เก็บเงินปลายทาง/ })).toBeNull()
  const submit = await screen.findByRole('button', { name: /ไปชำระเงิน/ })
  await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false))
})

test('unverified customer cannot select COD and is pointed to email verification', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  mountCheckout({ ...customerSession, user: { ...customerSession.user, emailVerified: false } })

  const stripe = await screen.findByRole('radio', { name: /บัตรเครดิต/ })
  expect((stripe as HTMLInputElement).checked).toBe(true)
  expect(screen.queryByRole('radio', { name: /เก็บเงินปลายทาง/ })).toBeNull()
  expect(screen.getByRole('link', { name: 'ส่งอีเมลยืนยัน' }).getAttribute('href')).toBe('/account/profile')
})

test('contact section only asks for email', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  mountCheckout(null)

  await screen.findByRole('radio', { name: /บัตรเครดิต/ })
  const contact = screen.getByRole('region', { name: 'ข้อมูลติดต่อ' })
  expect(within(contact).getByLabelText('อีเมลสำหรับรับรายละเอียดคำสั่งซื้อ')).toBeTruthy()
  expect(within(contact).queryByLabelText(/โทร/)).toBeNull()
  expect(screen.getByRole('heading', { name: 'ที่อยู่ออกใบเสร็จ' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'ที่อยู่จัดส่ง' })).toBeNull()
  expect((screen.getByRole('checkbox', { name: 'จัดส่งไปที่อยู่อื่น' }) as HTMLInputElement).getAttribute('aria-checked')).not.toBe('true')
})

test('guest fills billing with phone; phone 081-234-5678 is sent as 0812345678', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  interceptStripeRedirect()
  mountCheckout(null, { email: 'guest@example.test', phone: '081-234-5678', recipientName: 'Nok Guest', addressLine1: '1 Main Road', addressLine2: '', subdistrict: 'Suthep', district: 'Mueang', province: 'Chiang Mai', postalCode: '50200' })

  const card = await screen.findByRole('radio', { name: /บัตรเครดิต/ })
  expect((card as HTMLInputElement).checked).toBe(true)
  await userEvent.setup().click(await screen.findByRole('button', { name: /ไปชำระเงิน/ }))

  await waitFor(() => expect(stripeRedirects).toEqual([stripeCheckoutUrl]))
  const orderRequest = requests.find(request => request.path === '/api/v1/store/checkout/orders')!
  expect(orderRequest.body).toMatchObject({ paymentMethod: 'stripe', stripePaymentMethod: 'card', contact: { email: 'guest@example.test' }, billingAddress: { recipientName: 'Nok Guest', phone: '0812345678', addressLine1: '1 Main Road', subdistrict: 'Suthep', district: 'Mueang', province: 'Chiang Mai', postalCode: '50200' } })
  expect(orderRequest.body).not.toHaveProperty('shippingAddress')
  expect(orderRequest.body?.contact).not.toHaveProperty('phone')
})

test('guest billing rejects a phone that is not 9-10 digits', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  mountCheckout(null, { email: 'guest@example.test', phone: '12345', recipientName: 'Nok Guest', addressLine1: '1 Main Road', addressLine2: '', subdistrict: 'Suthep', district: 'Mueang', province: 'Chiang Mai', postalCode: '50200' })

  await userEvent.setup().click(await screen.findByRole('button', { name: /ไปชำระเงิน/ }))
  expect(await screen.findByText('กรุณากรอกเบอร์โทรศัพท์ 9–10 หลัก')).toBeTruthy()
  expect(screen.getByLabelText('เบอร์โทรศัพท์').getAttribute('aria-invalid')).toBe('true')
  expect(requests.some(request => request.path === '/api/v1/store/checkout/orders')).toBe(false)
})

test('signed-in customer sees billing default preselected and sends billingAddress addressId without shippingAddress', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  mountCheckout(customerSession)
  const user = userEvent.setup()

  const cod = await screen.findByRole('radio', { name: /เก็บเงินปลายทาง/ })
  expect((cod as HTMLInputElement).checked).toBe(true)
  expect(await screen.findByText('1 Main Road Suthep Mueang Chiang Mai 50200')).toBeTruthy()
  expect(screen.queryByLabelText('บ้านเลขที่ ถนน และรายละเอียดที่อยู่')).toBeNull()
  await user.click(screen.getByRole('button', { name: /ยืนยันสั่งซื้อ/ }))

  await waitFor(() => expect(requests.some(request => request.path === '/api/v1/store/checkout/orders')).toBe(true))
  const orderRequest = requests.find(request => request.path === '/api/v1/store/checkout/orders')!
  expect(orderRequest.body).toMatchObject({ paymentMethod: 'cod', contact: { email: 'mali@example.test' }, billingAddress: { addressId } })
  expect(orderRequest.body).not.toHaveProperty('shippingAddress')
})

test('customer can switch to card and submits the saved address', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  interceptStripeRedirect()
  mountCheckout(customerSession)
  const user = userEvent.setup()

  const card = await screen.findByRole('radio', { name: /บัตรเครดิต/ })
  await user.click(card)
  expect((card as HTMLInputElement).checked).toBe(true)
  await user.click(screen.getByRole('button', { name: /ไปชำระเงิน/ }))

  await waitFor(() => expect(stripeRedirects).toEqual([stripeCheckoutUrl]))
  const orderRequest = requests.find(request => request.path === '/api/v1/store/checkout/orders')!
  expect(orderRequest.body).toMatchObject({ paymentMethod: 'stripe', stripePaymentMethod: 'card', billingAddress: { addressId } })
})

test('customer can choose PromptPay QR and submits it as a Stripe order', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  interceptStripeRedirect()
  mountCheckout(customerSession)
  const user = userEvent.setup()

  const promptpay = await screen.findByRole('radio', { name: /QR พร้อมเพย์/ })
  await user.click(promptpay)
  expect((promptpay as HTMLInputElement).checked).toBe(true)
  expect(screen.getByText('ระบบจะพาไปหน้า Stripe เพื่อสแกน QR พร้อมเพย์ ชำระภายใน 30 นาที')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: /ไปชำระเงิน/ }))

  await waitFor(() => expect(stripeRedirects).toEqual([stripeCheckoutUrl]))
  const orderRequest = requests.find(request => request.path === '/api/v1/store/checkout/orders')!
  expect(orderRequest.body).toMatchObject({ paymentMethod: 'stripe', stripePaymentMethod: 'promptpay', billingAddress: { addressId } })
})

test('edited saved address is sent as full fields with phone', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  mountCheckout(customerSession)
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: 'แก้ไขที่อยู่ Home' }))
  expect((await screen.findByLabelText('เบอร์โทรศัพท์') as HTMLInputElement).value).toBe('0812345678')
  const addressLine = await screen.findByLabelText('บ้านเลขที่ ถนน และรายละเอียดที่อยู่') as HTMLInputElement
  await waitFor(() => expect(addressLine.value).toBe('1 Main Road'))
  await user.clear(addressLine)
  await user.type(addressLine, '2 River Road')
  await user.click(screen.getByRole('button', { name: /ยืนยันสั่งซื้อ/ }))

  await waitFor(() => expect(requests.some(request => request.path === '/api/v1/store/checkout/orders')).toBe(true))
  const orderRequest = requests.find(request => request.path === '/api/v1/store/checkout/orders')!
  expect(orderRequest.body).toMatchObject({ paymentMethod: 'cod', billingAddress: { recipientName: 'Mali Buyer', phone: '0812345678', addressLine1: '2 River Road', subdistrict: 'Suthep', district: 'Mueang', province: 'Chiang Mai', postalCode: '50200' } })
  expect(orderRequest.body?.billingAddress).not.toHaveProperty('addressId')
})

test('ship-to-different checkbox is pre-checked when defaults differ and sends both addressIds', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  addressItems = [{ ...savedAddress, isDefaultShipping: false }, { ...officeAddress, isDefaultShipping: true }]
  mountCheckout(customerSession)
  const user = userEvent.setup()

  const checkbox = await screen.findByRole('checkbox', { name: 'จัดส่งไปที่อยู่อื่น' })
  await waitFor(() => expect(checkbox.getAttribute('aria-checked')).toBe('true'))
  expect(await screen.findByRole('heading', { name: 'ที่อยู่จัดส่ง' })).toBeTruthy()
  expect(screen.getByText('9 Office Road Suthep Mueang Chiang Mai 50200')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: /ยืนยันสั่งซื้อ/ }))

  await waitFor(() => expect(requests.some(request => request.path === '/api/v1/store/checkout/orders')).toBe(true))
  const orderRequest = requests.find(request => request.path === '/api/v1/store/checkout/orders')!
  expect(orderRequest.body).toMatchObject({ billingAddress: { addressId }, shippingAddress: { addressId: officeAddressId } })
})

test('switching the billing address switches its phone', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  addressItems = [savedAddress, officeAddress]
  mountCheckout(customerSession)
  const user = userEvent.setup()

  await screen.findByText('1 Main Road Suthep Mueang Chiang Mai 50200')
  await user.click(screen.getByRole('combobox', { name: 'เลือกที่อยู่ออกใบเสร็จ' }))
  await user.click(await screen.findByRole('option', { name: 'Office · Mali Office' }))
  await user.click(await screen.findByRole('button', { name: 'แก้ไขที่อยู่ Office' }))
  expect((await screen.findByLabelText('เบอร์โทรศัพท์') as HTMLInputElement).value).toBe('0898765432')
})

test('guest checkout rejects a manual address with missing required fields', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  mountCheckout(null)
  const user = userEvent.setup()

  await screen.findByRole('radio', { name: /บัตรเครดิต/ })
  await user.type(screen.getByLabelText('อีเมลสำหรับรับรายละเอียดคำสั่งซื้อ'), 'mali@example.test')
  await user.type(screen.getByLabelText('เบอร์โทรศัพท์'), '0812345678')
  await user.click(screen.getByRole('button', { name: /ไปชำระเงิน/ }))

  expect(await screen.findByText('กรุณากรอกข้อมูลติดต่อและที่อยู่ให้ครบถ้วน')).toBeTruthy()
  expect(screen.getByLabelText('ชื่อผู้รับ').getAttribute('aria-invalid')).toBe('true')
  expect(requests.some(request => request.path === '/api/v1/store/checkout/orders')).toBe(false)
})

test('session expiry switches the rendered checkout selection to Stripe', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  const { queryClient } = mountCheckout(customerSession)

  expect((await screen.findByRole('radio', { name: /เก็บเงินปลายทาง/ }) as HTMLInputElement).checked).toBe(true)
  await act(async () => { queryClient.setQueryData(authSessionQuery.queryKey, null) })
  await waitFor(() => expect((screen.getByRole('radio', { name: /บัตรเครดิต/ }) as HTMLInputElement).checked).toBe(true))
  expect(screen.queryByRole('radio', { name: /เก็บเงินปลายทาง/ })).toBeNull()
})

test('unresolved session blocks order submission until account status is known', async () => {
  previousFetch = globalThis.fetch
  globalThis.fetch = responseFor as typeof fetch
  mountCheckout(null, undefined, true)

  const submit = await screen.findByRole('button', { name: /ไปชำระเงิน/ })
  expect((submit as HTMLButtonElement).disabled).toBe(true)
  expect(requests.some(request => request.path === '/api/v1/store/checkout/orders')).toBe(false)
})
