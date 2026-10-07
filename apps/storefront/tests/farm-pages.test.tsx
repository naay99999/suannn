import { afterEach, beforeEach, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Component as FarmListPage } from '../src/pages/farms/farm-list-page'
import { Component as FarmDetailPage } from '../src/pages/farms/farm-detail-page'
import { FarmImage } from '../src/components/farms/farm-image'
import type { StoreFarmDetail, StoreFarmPage } from '../src/lib/store-farms'
import type { StoreProductPage } from '../src/lib/store-products'

const farm: StoreFarmDetail = {
  id: '00000000-0000-4000-8000-000000000101', slug: 'mae-rim', name: 'สวนแม่ริม', farmerName: 'คุณใจดี',
  province: 'เชียงใหม่', district: 'แม่ริม', summary: 'สวนผลไม้ที่ดูแลด้วยความตั้งใจ',
  coverImageUrl: null, coverImageAlt: null, isDemo: true,
  story: 'เรื่องราวของสวน', growingPractices: 'ดูแลตามฤดูกาล', portraitImageUrl: null, portraitImageAlt: null,
}
const product = {
  id: '00000000-0000-4000-8000-000000000201', slug: 'mango', name: 'มะม่วง', englishName: null,
  category: 'fresh' as const, imageUrl: null, imageAlt: null, minPriceSatang: 9900, canPurchase: true,
}
const originalFetch = globalThis.fetch
let clients: QueryClient[] = []

beforeEach(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input.url : String(input)
    const url = new URL(request)
    if (url.pathname.endsWith('/store/farms/private')) return Response.json({ code: 'FARM_NOT_FOUND' }, { status: 404 })
    if (url.pathname.endsWith('/store/farms/mae-rim/products')) return Response.json({ items: [product], nextCursor: null } satisfies StoreProductPage)
    if (url.pathname.endsWith('/store/farms/mae-rim')) return Response.json(farm)
    if (url.pathname.endsWith('/store/farms')) return Response.json({ items: [farm], nextCursor: null } satisfies StoreFarmPage)
    throw new Error(`Unexpected farm test request: ${url.pathname}`)
  }) as typeof fetch
})

afterEach(() => {
  cleanup()
  clients.forEach(client => client.clear())
  clients = []
  globalThis.fetch = originalFetch
})

function mount(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  clients.push(client)
  const router = createMemoryRouter([
    { path: '/farms', element: <FarmListPage /> },
    { path: '/farms/:slug', element: <FarmDetailPage /> },
  ], { initialEntries: [path] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}

test('farm directory shows profile links and marks demo data', async () => {
  mount('/farms')
  const link = await screen.findByRole('link', { name: /สวนแม่ริม/ })
  expect(link.getAttribute('href')).toBe('/farms/mae-rim')
  expect(screen.getAllByText('ข้อมูลสาธิต').length).toBeGreaterThan(0)
})

test('farm profile links its public products back to product details', async () => {
  mount('/farms/mae-rim')
  await screen.findByRole('heading', { level: 1, name: 'สวนแม่ริม' })
  expect(screen.getByText(/ยังไม่ระบุว่าสินค้าแต่ละล็อตที่จัดส่ง/)).toBeTruthy()
  expect((await screen.findByRole('link', { name: /มะม่วง/ })).getAttribute('href')).toBe('/products/mango')
})

test('profile navigation never shows the previous farm under a new slug', async () => {
  const router = mount('/farms/mae-rim')
  await screen.findByRole('heading', { level: 1, name: 'สวนแม่ริม' })
  await act(async () => { await router.navigate('/farms/private') })
  await screen.findByRole('heading', { level: 1, name: 'ไม่พบโปรไฟล์สวนนี้' })
  expect(screen.queryByRole('heading', { level: 1, name: 'สวนแม่ริม' })).toBeNull()
})

test('farm image replaces a failed remote image with an accessible fallback', async () => {
  render(<FarmImage src="https://example.test/farm.jpg" alt="ภาพสวน" />)
  fireEvent.error(screen.getByRole('img', { name: 'ภาพสวน' }))
  await waitFor(() => expect(screen.getByRole('img', { name: 'ภาพสวน' }).tagName).toBe('DIV'))
})
