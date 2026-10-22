import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { createRef, type ReactNode } from 'react'
import * as tracker from '../src/lib/tracking/tracker'
import * as posthog from '../src/lib/tracking/posthog'
import type { BrowserEvent } from '../src/lib/tracking/events'
import { CartProvider } from '../src/components/cart/cart-provider'
import { CartContext, useCart } from '../src/components/cart/cart-context'
import { ConsentContext, type ConsentContextValue } from '../src/components/consent/consent-context'
import { authSessionQuery } from '../src/lib/auth-session'
import { storeProductDetailQueryKey, type StoreProductDetail } from '../src/lib/store-products'
import type { StoreCartDetail } from '../src/lib/store-cart'
import { buildCheckoutTracking } from '../src/lib/tracking/checkout-context'
import { useExperimentVariant } from '../src/lib/tracking/use-experiment'
import { Component as DetailPage } from '../src/pages/products/product-detail-page'
import { Component as CheckoutPage } from '../src/pages/checkout/checkout-page'

const productId = '00000000-0000-4000-8000-000000000001'
const variantId = '00000000-0000-4000-8000-000000000011'
const mango: StoreProductDetail = {
  id: productId, slug: 'mango', name: 'Test mango', englishName: null,
  category: 'fresh', coverImage: null, images: [], minPriceSatang: 1000, canPurchase: true,
  description: null, originStory: null, storageInstructions: null, farms: [],
  variants: [{ id: variantId, name: 'Small', unit: 'box', priceSatang: 1000, displayOrder: 0, canPurchase: true }],
}
const line = (quantity: number) => ({ variantId, productId, productSlug: 'mango', productName: 'Test mango', productImageUrl: null, productImageAlt: null, variantName: 'Small', unit: 'box', quantity, priceSatang: 1000, canPurchase: true, issues: [] })
const cartOf = (quantity: number, version = 1): StoreCartDetail => ({ cartVersion: version, lines: [line(quantity)] })
const quote = { cartVersion: 1, settingsVersion: 2, currency: 'THB' as const, lines: [{ variantId, productId, productName: 'Test mango', variantName: 'Small', unit: 'box', quantity: 1, unitPriceSatang: 1000, lineTotalSatang: 1000 }], subtotalSatang: 1000, shippingSatang: 3500, totalSatang: 4500, expiresAt: new Date(Date.now() + 60_000).toISOString(), quoteToken: 'signed-test-quote' }

let events: BrowserEvent[] = []
let previousFetch: typeof fetch
let requests: Array<{ path: string; method: string; body: Record<string, unknown> | null }> = []
let serverCart: StoreCartDetail = cartOf(1)
const spies: Array<{ mockRestore: () => void }> = []

const consentValue = (choice: ConsentContextValue['choice']): ConsentContextValue => ({
  choice, policyVersion: 'v1', decided: Boolean(choice), acceptAll: async () => {}, rejectAll: async () => {}, save: async () => {}, openSettings: () => {},
})
const stored = (analytics: boolean, marketing: boolean) => ({ analytics, marketing, policyVersion: 'v1', consentId: 'consent-1', decidedAt: '2026-10-22T00:00:00.000Z' })

beforeEach(() => {
  events = []
  requests = []
  serverCart = cartOf(1)
  spies.push(spyOn(tracker, 'track').mockImplementation((e: BrowserEvent) => { events.push(e) }))
  previousFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null
    const url = new URL(request?.url ?? String(input))
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    let body: Record<string, unknown> | null = null
    try { body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null } catch { body = null }
    requests.push({ path: url.pathname, method, body })
    if (url.pathname === '/api/v1/store/cart' && method === 'GET') return Response.json(serverCart)
    if (url.pathname.startsWith('/api/v1/store/cart/items/') && method === 'PUT') {
      serverCart = cartOf(Number(body?.quantity), serverCart.cartVersion + 1)
      return Response.json(serverCart)
    }
    if (url.pathname === '/api/v1/store/checkout/quote') return Response.json(quote)
    if (url.pathname === '/api/v1/store/checkout/orders') return Response.json({ order: { id: '00000000-0000-4000-8000-000000000030' } })
    return Response.json(null)
  }) as typeof fetch
})

afterEach(() => {
  cleanup()
  globalThis.fetch = previousFetch
  for (const spy of spies.splice(0)) spy.mockRestore()
  localStorage.clear()
  sessionStorage.clear()
})

function newClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } } })
  client.setQueryData(authSessionQuery.queryKey, null)
  return client
}

test('product page fires view_item once across re-renders', async () => {
  const client = newClient()
  client.setQueryData(storeProductDetailQueryKey('mango'), mango)
  const router = createMemoryRouter([{ path: '/products/:slug', element: <DetailPage /> }], { initialEntries: ['/products/mango'] })
  const tree = <QueryClientProvider client={client}><CartProvider><RouterProvider router={router} /></CartProvider></QueryClientProvider>
  const view = render(tree)
  await screen.findByRole('heading', { name: 'Test mango' })
  view.rerender(tree)
  await act(async () => { await client.invalidateQueries({ queryKey: ['unrelated'] }) })
  expect(events.filter(e => e.name === 'view_item')).toEqual([{ name: 'view_item', item: { productId, variantId, name: 'Test mango', price: 10, quantity: 1 } }])
})

function CartHarness({ onCart }: { onCart: (cart: ReturnType<typeof useCart>) => void }) {
  onCart(useCart())
  return null
}

async function mountCart(initialQuantity: number) {
  const client = newClient()
  let latest!: ReturnType<typeof useCart>
  render(<QueryClientProvider client={client}><CartProvider><CartHarness onCart={cart => { latest = cart }} /></CartProvider></QueryClientProvider>)
  await waitFor(() => expect(latest.cart?.lines[0]?.quantity).toBe(initialQuantity))
  return () => latest
}

test('raising a cart line from 1 to 3 fires add_to_cart with the delta', async () => {
  const cart = await mountCart(1)
  await act(async () => { await cart().setItem(variantId, 3) })
  expect(events).toEqual([{ name: 'add_to_cart', item: { productId, variantId, name: 'Test mango', price: 10, quantity: 2 } }])
})

test('lowering a cart line fires nothing', async () => {
  serverCart = cartOf(3)
  const cart = await mountCart(3)
  await act(async () => { await cart().setItem(variantId, 1) })
  expect(events).toEqual([])
})

const prefill = { email: 'mali@example.test', recipientName: 'Mali Buyer', phone: '0812345678', addressLine1: '1 Main Road', subdistrict: 'Suthep', district: 'Mueang', province: 'Chiang Mai', postalCode: '50200' }

function mountCheckout() {
  const client = newClient()
  const router = createMemoryRouter([{ path: '/checkout', element: <CheckoutPage /> }], { initialEntries: [{ pathname: '/checkout', state: { details: prefill } }] })
  const cartValue = { cart: cartOf(1), pending: false, error: null, setItem: async () => {}, removeItem: async () => {}, mergeNotice: null, open: false, setOpen: () => {}, triggerRef: createRef<HTMLButtonElement>() }
  render(<QueryClientProvider client={client}><CartContext.Provider value={cartValue}><RouterProvider router={router} /></CartContext.Provider></QueryClientProvider>)
}

async function submitCheckout() {
  const user = userEvent.setup()
  await screen.findByRole('radio', { name: /บัตรเครดิต/ })
  const submit = await screen.findByRole('button', { name: /ไปชำระเงิน/ })
  await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false))
  await user.click(submit)
  await waitFor(() => expect(requests.some(r => r.path === '/api/v1/store/checkout/orders')).toBe(true))
  return requests.find(r => r.path === '/api/v1/store/checkout/orders')!.body!
}

test('checkout page fires begin_checkout once with the quote subtotal', async () => {
  mountCheckout()
  await screen.findByRole('button', { name: /ไปชำระเงิน/ })
  await waitFor(() => expect(events.filter(e => e.name === 'begin_checkout').length).toBe(1))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(events.filter(e => e.name === 'begin_checkout')).toEqual([{ name: 'begin_checkout', items: [{ productId, variantId, name: 'Test mango', price: 10, quantity: 1 }], value: 10 }])
})

test('place-order body carries stored attribution, without ad ids or distinct id when consent is off', async () => {
  localStorage.setItem('suannn.consent', JSON.stringify(stored(false, false)))
  localStorage.setItem('suannn.attribution', JSON.stringify({
    lastTouch: { utmCampaign: 'summer', capturedAt: new Date().toISOString() },
    firstTouch: { utmCampaign: 'summer', capturedAt: new Date().toISOString() },
  }))
  document.cookie = '_fbp=fb.1.1.123'
  spies.push(spyOn(posthog, 'getDistinctId').mockReturnValue('distinct-1'))
  mountCheckout()
  const body = await submitCheckout()
  const tracking = body.tracking as Record<string, any>
  expect(tracking.lastTouch.utmCampaign).toBe('summer')
  expect(typeof tracking.lastTouch.capturedAt).toBe('string')
  expect(tracking.consentId).toBe('consent-1')
  expect(tracking.fbp).toBeUndefined()
  expect(tracking.posthogDistinctId).toBeUndefined()
  document.cookie = '_fbp=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

test('buildCheckoutTracking adds distinct id and ad cookies when consented, deriving _fbc from fbclid', () => {
  localStorage.setItem('suannn.consent', JSON.stringify(stored(true, true)))
  localStorage.setItem('suannn.attribution', JSON.stringify({ lastTouch: { fbclid: 'abc', capturedAt: '2026-10-20T00:00:00.000Z' } }))
  document.cookie = '_fbp=fb.1.1.123'
  document.cookie = '_ttp=ttp-1'
  spies.push(spyOn(posthog, 'getDistinctId').mockReturnValue('distinct-1'))
  spies.push(spyOn(Date, 'now').mockReturnValue(1_700_000_000_000))
  expect(buildCheckoutTracking()).toMatchObject({ consentId: 'consent-1', posthogDistinctId: 'distinct-1', fbp: 'fb.1.1.123', fbc: `fb.1.${Date.parse('2026-10-20T00:00:00.000Z')}.abc`, ttp: 'ttp-1' })
  document.cookie = '_fbp=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  document.cookie = '_ttp=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

test('checkout still submits when storage throws', async () => {
  mountCheckout()
  spies.push(spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') }))
  const body = await submitCheckout()
  expect(body.quoteToken).toBe('signed-test-quote')
})

test('useExperimentVariant is control without analytics consent even when the flag has a variant', () => {
  spies.push(spyOn(posthog, 'getVariant').mockReturnValue('test'))
  const wrapper = (choice: ConsentContextValue['choice']) => ({ children }: { children: ReactNode }) => <ConsentContext.Provider value={consentValue(choice)}>{children}</ConsentContext.Provider>
  expect(renderHook(() => useExperimentVariant('hero'), { wrapper: wrapper(stored(false, false)) }).result.current).toBe('control')
  expect(renderHook(() => useExperimentVariant('hero'), { wrapper: wrapper(null) }).result.current).toBe('control')
  expect(renderHook(() => useExperimentVariant('hero'), { wrapper: wrapper(stored(true, false)) }).result.current).toBe('test')
})
