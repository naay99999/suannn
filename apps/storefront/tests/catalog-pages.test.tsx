import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { ReactNode } from 'react'
import { authSessionQuery } from '../src/lib/auth-session'
import { storeProductDetailQueryKey, type StoreProductDetail, type StoreProductPage } from '../src/lib/store-products'
import type { StoreCartDetail } from '../src/lib/store-cart'
import { CartProvider } from '../src/components/cart/cart-provider'
import { CartTrigger, SideCart } from '../src/components/cart/side-cart'
import { QuickAddToCart } from '../src/components/quick-add-to-cart'
import { Component as CatalogPage } from '../src/pages/products/product-list-page'
import { Component as DetailPage } from '../src/pages/products/product-detail-page'
import { Component as HomePage } from '../src/pages/home/home-page'

const mango: StoreProductDetail = {
  id: '00000000-0000-4000-8000-000000000001', slug: 'mango', name: 'Test mango', englishName: null,
  category: 'fresh', imageUrl: null, imageAlt: null, minPriceSatang: 1000, canPurchase: true,
  description: null, originStory: null, storageInstructions: null,
  farms: [],
  variants: [
    { id: '00000000-0000-4000-8000-000000000011', name: 'Small', unit: 'box', priceSatang: 1000, displayOrder: 0, canPurchase: true },
    { id: '00000000-0000-4000-8000-000000000012', name: 'Large', unit: 'box', priceSatang: 2000, displayOrder: 1, canPurchase: true },
    { id: '00000000-0000-4000-8000-000000000013', name: 'Unavailable', unit: 'box', priceSatang: 3000, displayOrder: 2, canPurchase: false },
  ],
}
const jam: StoreProductDetail = { ...mango, id: '00000000-0000-4000-8000-000000000002', slug: 'jam', name: 'Test jam', category: 'processed',
  variants: [{ ...mango.variants[0]!, id: '00000000-0000-4000-8000-000000000021', name: 'Jar' }],
}
const originalFetch = globalThis.fetch
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
let requests: Array<{ url: URL; method: string; body: unknown }>
let cart: StoreCartDetail
let productResponse: (url: URL) => Response | Promise<Response>
let clients: QueryClient[] = []

beforeEach(() => {
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
  requests = []
  cart = { cartVersion: 0, lines: [] }
  productResponse = url => url.pathname.endsWith('/mango') ? Response.json(mango) : url.pathname.endsWith('/jam') ? Response.json(jam)
    : Response.json({ items: [mango, jam], nextCursor: null } satisfies StoreProductPage)
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null
    const url = new URL(request?.url ?? String(input))
    const method = init?.method ?? request?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : null
    requests.push({ url, method, body })
    if (url.pathname.includes('/store/products')) return productResponse(url)
    if (url.pathname.includes('/store/farms')) return Response.json({ items: [], nextCursor: null })
    if (url.pathname.includes('/store/cart/items/') && method === 'PUT') {
      const variantId = url.pathname.split('/').at(-1)!
      const item = [mango, jam].find(product => product.variants.some(variant => variant.id === variantId))!
      const variant = item.variants.find(variant => variant.id === variantId)!
      cart = { cartVersion: cart.cartVersion + 1, lines: [{ variantId, productId: item.id, productSlug: item.slug, productName: item.name,
        productImageUrl: null, productImageAlt: null, variantName: variant.name, unit: variant.unit, quantity: (body as { quantity: number }).quantity,
        priceSatang: variant.priceSatang, canPurchase: true, issues: [] }] }
      return Response.json(cart)
    }
    if (url.pathname.includes('/store/cart/items/') && method === 'DELETE') {
      const variantId = url.pathname.split('/').at(-1)!
      cart = { cartVersion: cart.cartVersion + 1, lines: cart.lines.filter(line => line.variantId !== variantId) }
      return Response.json(cart)
    }
    if (url.pathname.endsWith('/store/cart')) return Response.json(cart)
    if (url.pathname.endsWith('/auth/get-session')) return Response.json(null)
    throw new Error(`Unexpected test request: ${method} ${url.pathname}`)
  }) as typeof fetch
})

afterEach(() => {
  cleanup()
  clients.forEach(client => client.clear())
  clients = []
  globalThis.fetch = originalFetch
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
  else Reflect.deleteProperty(document, 'fonts')
})

function mount(element: ReactNode, path = '/products', cached: StoreProductDetail[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } } })
  clients.push(client)
  // Catalog/cart behavior is independent of session fetching, covered separately
  // by the auth suites. Keep the real cart provider and its HTTP mutations.
  client.setQueryDefaults(authSessionQuery.queryKey, { enabled: false })
  for (const product of cached) client.setQueryData(storeProductDetailQueryKey(product.slug), product)
  const router = createMemoryRouter([
    { path: '/products', element }, { path: '/cart-test', element },
    { path: '/products/:slug', element: <DetailPage /> }, { path: '/', element: <HomePage /> },
  ], { initialEntries: [path] })
  render(<QueryClientProvider client={client}><CartProvider><RouterProvider router={router} /></CartProvider></QueryClientProvider>)
  return router
}

test('quick detail link preserves keyboard navigation without Base UI warnings', async () => {
  const errors = spyOn(console, 'error').mockImplementation(() => {})
  try {
    const router = mount(<QuickAddToCart product={mango} />)
    const link = await screen.findByRole('link', { name: 'ดูรายละเอียดและสั่งซื้อ' })
    expect(link.getAttribute('href')).toBe('/products/mango')
    link.focus()
    await userEvent.setup().keyboard('{Enter}')
    await screen.findByRole('heading', { level: 1, name: mango.name })
    expect(router.state.location.pathname).toBe('/products/mango')
    expect(errors.mock.calls.filter(call => String(call[0]).includes('Base UI'))).toEqual([])
  } finally { errors.mockRestore() }
})

test('catalog category disclosure supports keyboard filtering and clears the paging cursor', async () => {
  const router = mount(<CatalogPage />, '/products?cursor=old')
  await screen.findByRole('heading', { name: mango.name })
  const user = userEvent.setup()
  const disclosure = screen.getByRole('button', { name: 'หมวดหมู่: ทั้งหมด' })
  expect(disclosure.getAttribute('aria-expanded')).toBe('false')
  disclosure.focus()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('button', { name: 'ซ่อนหมวดหมู่' }).getAttribute('aria-expanded')).toBe('true')
  const category = within(screen.getByRole('group', { name: 'หมวดหมู่สินค้า' })).getByRole('button', { name: 'แปรรูป' })
  category.focus()
  await user.keyboard('{Enter}')
  await waitFor(() => expect(router.state.location.search).toBe('?category=processed'))
  expect(category.getAttribute('aria-pressed')).toBe('true')
})

test('catalog adds directly and adjusts server cart quantity without navigating', async () => {
  const router = mount(<CatalogPage />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: `เพิ่ม ${mango.name} ลงตะกร้า` }))
  const control = await screen.findByRole('group', { name: `จำนวน ${mango.name}` })
  expect(within(control).getByText('1')).toBeTruthy()
  expect(requests.filter(request => request.method === 'PUT').map(request => ({ path: request.url.pathname, body: request.body }))).toEqual([
    { path: `/api/v1/store/cart/items/${mango.variants[0]!.id}`, body: { quantity: 1 } },
  ])
  expect(router.state.location.pathname).toBe('/products')
  expect(screen.getByText('Small · box')).toBeTruthy()
  await user.click(within(control).getByRole('button', { name: `เพิ่มจำนวน ${mango.name}` }))
  await waitFor(() => expect(within(control).getByText('2')).toBeTruthy())
  await user.click(within(control).getByRole('button', { name: `ลดจำนวน ${mango.name}` }))
  await waitFor(() => expect(within(control).getByText('1')).toBeTruthy())
  await user.click(within(control).getByRole('button', { name: `ลดจำนวน ${mango.name}` }))
  await screen.findByRole('button', { name: `เพิ่ม ${mango.name} ลงตะกร้า` })
  expect(requests.filter(request => request.method === 'PUT').map(request => request.body)).toEqual([{ quantity: 1 }, { quantity: 2 }, { quantity: 1 }])
  expect(requests.some(request => request.method === 'DELETE' && request.url.pathname.endsWith(mango.variants[0]!.id))).toBe(true)
})

test('catalog uses the existing cart variant and stops at the quantity limit', async () => {
  cart = { cartVersion: 1, lines: [{ variantId: mango.variants[1]!.id, productId: mango.id, productSlug: mango.slug, productName: mango.name,
    productImageUrl: null, productImageAlt: null, variantName: 'Large', unit: 'box', quantity: 99, priceSatang: 2000, canPurchase: true, issues: [] }] }
  mount(<CatalogPage />)
  const control = await screen.findByRole('group', { name: `จำนวน ${mango.name}` })
  expect(within(control).getByText('99')).toBeTruthy()
  expect((within(control).getByRole('button', { name: `เพิ่มจำนวน ${mango.name}` }) as HTMLButtonElement).disabled).toBe(true)
  await userEvent.setup().click(within(control).getByRole('button', { name: `ลดจำนวน ${mango.name}` }))
  await waitFor(() => expect(within(control).getByText('98')).toBeTruthy())
  expect(requests.find(request => request.method === 'PUT')?.url.pathname).toBe(`/api/v1/store/cart/items/${mango.variants[1]!.id}`)
})

test('catalog keeps cart quantity on a failed update and allows retry', async () => {
  const handle = globalThis.fetch
  let fail = true
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT' && fail) return Response.json({ code: 'OUT_OF_STOCK' }, { status: 409 })
    return handle(input, init)
  }) as typeof fetch
  mount(<CatalogPage />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: `เพิ่ม ${mango.name} ลงตะกร้า` }))
  expect((await screen.findByRole('alert')).textContent).toContain('สินค้าไม่พอ')
  expect(screen.queryByRole('group', { name: `จำนวน ${mango.name}` })).toBeNull()
  fail = false
  await user.click(screen.getByRole('button', { name: `เพิ่ม ${mango.name} ลงตะกร้า` }))
  expect(within(await screen.findByRole('group', { name: `จำนวน ${mango.name}` })).getByText('1')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

test('catalog reports unavailable product details without writing to the cart', async () => {
  productResponse = url => url.pathname.endsWith('/mango')
    ? Response.json({ code: 'INTERNAL_ERROR' }, { status: 500 })
    : Response.json({ items: [mango], nextCursor: null })
  mount(<CatalogPage />)
  await userEvent.setup().click(await screen.findByRole('button', { name: `เพิ่ม ${mango.name} ลงตะกร้า` }))
  expect((await screen.findByRole('alert')).textContent).toContain('โหลดตัวเลือกสินค้าไม่ได้')
  expect(requests.some(request => request.method === 'PUT')).toBe(false)
})

test('empty cart link closes the sheet without Base UI warnings', async () => {
  const errors = spyOn(console, 'error').mockImplementation(() => {})
  try {
    const router = mount(<><CartTrigger /><SideCart /></>, '/cart-test')
    await userEvent.setup().click(screen.getByRole('button', { name: 'เปิดตะกร้า 0 ชิ้น' }))
    const link = await screen.findByRole('link', { name: 'ไปเลือกสินค้า' })
    expect(link.getAttribute('href')).toBe('/products')
    link.focus()
    await userEvent.setup().keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(router.state.location.pathname).toBe('/products')
    expect(errors.mock.calls.filter(call => String(call[0]).includes('Base UI'))).toEqual([])
  } finally { errors.mockRestore() }
})

test('catalog shows loading, retries failure and clears filters from an empty result', async () => {
  let finish: ((response: Response) => void) | undefined
  productResponse = () => new Promise(resolve => { finish = resolve })
  const router = mount(<CatalogPage />, '/products?q=missing&cursor=old')
  expect(screen.getByText('กำลังโหลดสินค้า...')).toBeTruthy()
  await waitFor(() => expect(finish).toBeDefined())
  await act(async () => { finish!(Response.json({ code: 'UNAVAILABLE' }, { status: 503 })) })
  await screen.findByRole('alert')
  productResponse = async () => Response.json({ items: [], nextCursor: null })
  await userEvent.setup().click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }))
  await screen.findByText('ไม่พบสินค้า')
  await userEvent.setup().click(screen.getAllByRole('button', { name: 'ล้างตัวกรอง' }).at(-1)!)
  await waitFor(() => expect(router.state.location.search).toBe(''))
})

test('catalog paginates and resets cursor when category or search changes', async () => {
  productResponse = async url => Response.json({ items: url.searchParams.has('cursor') ? [jam] : [mango], nextCursor: url.searchParams.has('cursor') ? null : 'page-two' })
  const router = mount(<CatalogPage />)
  await screen.findByRole('heading', { name: mango.name })
  await userEvent.setup().click(screen.getByRole('button', { name: 'ดูสินค้าเพิ่มเติม' }))
  await screen.findByRole('heading', { name: jam.name })
  expect(requests.some(request => request.url.searchParams.get('cursor') === 'page-two')).toBe(true)
  await userEvent.setup().click(screen.getByRole('button', { name: 'ผลไม้สด' }))
  await waitFor(() => expect(router.state.location.search).toBe('?category=fresh'))
  await userEvent.setup().type(screen.getByLabelText('ค้นหาของอร่อย'), 'mango')
  await waitFor(() => expect(new URLSearchParams(router.state.location.search).get('q')).toBe('mango'))
  await waitFor(() => expect(requests.some(request => request.url.searchParams.get('q') === 'mango' && request.url.searchParams.get('category') === 'fresh' && !request.url.searchParams.has('cursor'))).toBe(true))
  expect((await screen.findByRole('link', { name: /Test mango/ })).getAttribute('href')).toBe('/products/mango')
})

test('detail sends selected variant and accumulated quantity to cart', async () => {
  cart = { cartVersion: 1, lines: [{ variantId: mango.variants[1]!.id, productId: mango.id, productSlug: 'mango', productName: mango.name,
    productImageUrl: null, productImageAlt: null, variantName: 'Large', unit: 'box', quantity: 2, priceSatang: 2000, canPurchase: true, issues: [] }] }
  mount(<CatalogPage />, '/products/mango')
  await screen.findByRole('heading', { level: 1, name: mango.name })
  expect((screen.getByLabelText('ตัวเลือกสินค้า') as HTMLSelectElement).value).toBe(mango.variants[0]!.id)
  const user = userEvent.setup()
  await user.selectOptions(screen.getByLabelText('ตัวเลือกสินค้า'), mango.variants[1]!.id)
  await user.click(screen.getByRole('button', { name: `เพิ่มจำนวน ${mango.name}` }))
  await user.click(screen.getByRole('button', { name: 'เพิ่มลงตะกร้า' }))
  await waitFor(() => expect(requests.filter(request => request.method === 'PUT').map(request => ({ path: request.url.pathname, body: request.body }))).toEqual([
    { path: `/api/v1/store/cart/items/${mango.variants[1]!.id}`, body: { quantity: 4 } },
  ]))
  await waitFor(() => expect(within(screen.getByRole('group', { name: `จำนวน ${mango.name}` })).getByText('1')).toBeTruthy())
})

test('unavailable variant prevents cart writes and cached slug navigation uses the new variant', async () => {
  const router = mount(<CatalogPage />, '/products/mango', [mango, jam])
  await screen.findByRole('heading', { level: 1, name: mango.name })
  await userEvent.setup().selectOptions(screen.getByLabelText('ตัวเลือกสินค้า'), mango.variants[2]!.id)
  expect((screen.getByRole('button', { name: 'ยังไม่พร้อมสั่งซื้อ' }) as HTMLButtonElement).disabled).toBe(true)
  expect(requests.some(request => request.method === 'PUT')).toBe(false)
  await act(async () => { await router.navigate('/products/jam') })
  await screen.findByRole('heading', { level: 1, name: jam.name })
  expect(screen.queryByLabelText('ตัวเลือกสินค้า')).toBeNull()
  await userEvent.setup().click(screen.getByRole('button', { name: 'เพิ่มลงตะกร้า' }))
  await waitFor(() => expect(requests.some(request => request.method === 'PUT' && request.url.pathname.endsWith(jam.variants[0]!.id) && (request.body as { quantity: number }).quantity === 1)).toBe(true))
})

test('detail distinguishes missing product from transient failure and retries', async () => {
  productResponse = async () => Response.json({ code: 'PRODUCT_NOT_FOUND' }, { status: 404 })
  const router = mount(<CatalogPage />, '/products/missing')
  await screen.findByRole('heading', { name: 'ไม่พบสินค้าที่คุณกำลังมองหา' })
  expect(screen.getByRole('link', { name: 'กลับไปดูสินค้าทั้งหมด' }).getAttribute('href')).toBe('/products')
  productResponse = async () => Response.json({ code: 'UNAVAILABLE' }, { status: 503 })
  await act(async () => { await router.navigate('/products/mango') })
  await screen.findByRole('alert')
  productResponse = async url => url.pathname.endsWith('/mango') ? Response.json(mango) : Response.json({ items: [], nextCursor: null })
  await userEvent.setup().click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }))
  await screen.findByRole('heading', { level: 1, name: mango.name })
})

test('home featured products filter by category, show empty state and retry failure', async () => {
  productResponse = async url => url.searchParams.get('category') === 'processed' ? Response.json({ items: [], nextCursor: null }) : Response.json({ items: [mango], nextCursor: null })
  const router = mount(<CatalogPage />, '/')
  await screen.findByRole('heading', { name: mango.name })
  await userEvent.setup().click(screen.getByRole('button', { name: 'แปรรูป' }))
  await screen.findByText('ยังไม่มีสินค้าในหมวดนี้')
  expect(requests.some(request => request.url.searchParams.get('category') === 'processed' && request.url.searchParams.get('limit') === '8')).toBe(true)
  productResponse = async () => Response.json({ code: 'UNAVAILABLE' }, { status: 503 })
  await userEvent.setup().click(screen.getByRole('button', { name: 'ผลไม้สด' }))
  await screen.findByRole('alert')
  productResponse = async () => Response.json({ items: [mango], nextCursor: null })
  await userEvent.setup().click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }))
  await screen.findByRole('link', { name: /Test mango/ })
  productResponse = async url => url.pathname.endsWith('/mango') ? Response.json(mango) : Response.json({ items: [], nextCursor: null })
  await userEvent.setup().click(await screen.findByRole('link', { name: /Test mango/ }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/products/mango'))
  await screen.findByRole('heading', { level: 1, name: mango.name })
})

test('catalog sort sends ordering and clears the previous cursor', async () => {
  const router = mount(<CatalogPage />, '/products?cursor=old-page')
  await screen.findByRole('heading', { name: mango.name })
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: 'เรียงตาม' }))
  await user.click(await screen.findByRole('option', { name: 'ราคา: น้อยไปมาก' }))
  await waitFor(() => expect(router.state.location.search).toBe('?sort=price-asc'))
  await waitFor(() => expect(requests.some(request => request.url.searchParams.get('sort') === 'price-asc' && !request.url.searchParams.has('cursor'))).toBe(true))
})

test('detail loads and blocks purchase for an unavailable product or one with no variants', async () => {
  let finish: ((response: Response) => void) | undefined
  productResponse = () => new Promise(resolve => { finish = resolve })
  const router = mount(<CatalogPage />, '/products/mango')
  expect(screen.getByText('กำลังโหลดสินค้า...')).toBeTruthy()
  await waitFor(() => expect(finish).toBeDefined())
  await act(async () => { finish!(Response.json({ ...mango, canPurchase: false })) })
  const add = await screen.findByRole('button', { name: 'ยังไม่พร้อมสั่งซื้อ' })
  expect((add as HTMLButtonElement).disabled).toBe(true)
  await userEvent.setup().click(add)
  expect(requests.some(request => request.method === 'PUT')).toBe(false)
  productResponse = async url => url.pathname.endsWith('/no-variants') ? Response.json({ ...jam, slug: 'no-variants', canPurchase: false, variants: [] }) : Response.json({ items: [], nextCursor: null })
  await act(async () => { await router.navigate('/products/no-variants') })
  await screen.findByText('ขณะนี้ไม่มีตัวเลือกสินค้าที่เปิดจำหน่าย')
  expect(screen.queryByRole('button', { name: 'เพิ่มลงตะกร้า' })).toBeNull()
})

test('detail respects remaining quantity allowance and blocks adding to a full cart', async () => {
  cart = { cartVersion: 1, lines: [{ variantId: mango.variants[1]!.id, productId: mango.id, productSlug: 'mango', productName: mango.name,
    productImageUrl: null, productImageAlt: null, variantName: 'Large', unit: 'box', quantity: 98, priceSatang: 2000, canPurchase: true, issues: [] }] }
  mount(<CatalogPage />, '/products/mango')
  await screen.findByRole('heading', { level: 1, name: mango.name })
  const user = userEvent.setup()
  await user.selectOptions(screen.getByLabelText('ตัวเลือกสินค้า'), mango.variants[1]!.id)
  await waitFor(() => expect((screen.getByRole('button', { name: `เพิ่มจำนวน ${mango.name}` }) as HTMLButtonElement).disabled).toBe(true))
  await user.click(screen.getByRole('button', { name: 'เพิ่มลงตะกร้า' }))
  const full = await screen.findByRole('button', { name: 'ครบจำนวนสูงสุดในตะกร้า' })
  expect((full as HTMLButtonElement).disabled).toBe(true)
  expect(requests.filter(request => request.method === 'PUT').map(request => request.body)).toEqual([{ quantity: 99 }])
})
