import { afterEach, beforeEach, expect, test } from 'bun:test'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { authSessionQuery, type AuthSession } from '../src/lib/auth-session'
import { catalogFeedUrl } from '../src/lib/marketing/catalog-feed'
import { CatalogFeedSection } from '../src/pages/marketing/_components/catalog-feed-section'

const sessionFor = (permissions: string[]): AuthSession => ({
  session: { id: 'session-1', expiresAt: '2026-10-30T00:00:00.000Z' },
  user: { id: 'staff-1', name: 'เจ้าหน้าที่', email: 'staff@example.com', emailVerified: true, image: null, accountType: 'staff' },
  staff: { role: 'admin', permissions },
})

function queryClientFor(permissions: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  queryClient.setQueryData(authSessionQuery.queryKey, sessionFor(permissions), { updatedAt: Date.now() + 60_000 })
  return queryClient
}

const feedUrl = 'http://localhost:6767/api/v1/store/catalog/feed.xml'
const settings = { marginPercent: 35, catalogBrandName: 'suannn', version: 3, updatedAt: '2026-10-20T00:00:00.000Z' }
const summary = {
  problems: [
    { productId: 'p1', variantId: 'v1', productName: 'ทุเรียนหมอนทอง', variantName: '2 กก.', code: 'no_image', excluded: true },
    { productId: 'p2', variantId: 'v2', productName: 'มังคุด', variantName: '1 กก.', code: 'no_description', excluded: false },
  ],
  warnings: ['shipping_fee_unset', 'checkout_disabled'],
  counts: { total: 5, inFeed: 4, inStock: 3, outOfStock: 1, excluded: 1 },
  brandName: 'suannn',
}

interface Call { method: string; path: string; body: unknown }
let calls: Call[] = []
let routes: Record<string, () => Response> = {}
const previousFetch = globalThis.fetch
let copied: string[] = []

beforeEach(() => {
  calls = []
  copied = []
  routes = {
    'GET /api/v1/admin/marketing/catalog-feed': () => Response.json(summary),
    'GET /api/v1/admin/marketing/settings': () => Response.json(settings),
  }
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null
    const url = new URL(request ? request.url : String(input), 'http://localhost')
    const method = (request?.method ?? init?.method ?? 'GET').toUpperCase()
    const raw = request ? await request.clone().text() : init?.body
    calls.push({ method, path: url.pathname, body: typeof raw === 'string' && raw ? JSON.parse(raw) : undefined })
    const handler = routes[`${method} ${url.pathname}`]
    return handler ? handler() : Response.json({ code: 'NOT_FOUND', message: 'x' }, { status: 404 })
  }) as typeof fetch
})

afterEach(() => {
  cleanup()
  globalThis.fetch = previousFetch
})

function renderSection(permissions = ['marketing:read', 'marketing:update']) {
  return render(
    <QueryClientProvider client={queryClientFor(permissions)}>
      <MemoryRouter><CatalogFeedSection /></MemoryRouter>
    </QueryClientProvider>,
  )
}

test('builds the feed URL from the API origin', () => {
  expect(catalogFeedUrl('https://api.example.com')).toBe('https://api.example.com/api/v1/store/catalog/feed.xml')
})

test('shows the feed URL, copies it, and shows the counts', async () => {
  const user = userEvent.setup()
  // userEvent.setup() installs its own clipboard stub, so spy on it afterwards.
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied.push(text) } } })
  renderSection()

  expect(await screen.findByText(feedUrl)).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'คัดลอก' }))
  expect(copied).toEqual([feedUrl])
  expect(await screen.findByText('ในฟีด')).toBeTruthy()
  expect(screen.getByText('มีของ')).toBeTruthy()
  expect(screen.getByText('หมด')).toBeTruthy()
  expect(screen.getAllByText('ไม่ได้ใส่ในฟีด').length).toBeGreaterThan(0)
})

test('lists problems with reasons, badges and product links', async () => {
  renderSection()

  const excludedLink = await screen.findByRole('link', { name: /ทุเรียนหมอนทอง/ })
  expect(excludedLink.getAttribute('href')).toBe('/products/p1')
  const excludedRow = excludedLink.closest('li')!
  expect(within(excludedRow).getByText('2 กก.')).toBeTruthy()
  expect(within(excludedRow).getByText('ไม่มีรูปสินค้า')).toBeTruthy()
  expect(within(excludedRow).getByText('ไม่ได้ใส่ในฟีด')).toBeTruthy()
  const warnRow = screen.getByRole('link', { name: /มังคุด/ }).closest('li')!
  expect(within(warnRow).getByText('ไม่มีคำอธิบาย ใช้ชื่อสินค้าแทน')).toBeTruthy()
  expect(within(warnRow).queryByText('ไม่ได้ใส่ในฟีด')).toBeNull()
  expect(within(warnRow).getByText('ควรแก้')).toBeTruthy()
})

test('renders feed-wide warnings as alerts', async () => {
  renderSection()

  expect(await screen.findByText(/ยังไม่ได้ตั้งค่าค่าจัดส่ง/)).toBeTruthy()
  expect(screen.getByText(/ปิดการสั่งซื้ออยู่/)).toBeTruthy()
})

test('says every product is ready when there are no problems', async () => {
  routes['GET /api/v1/admin/marketing/catalog-feed'] = () => Response.json({ ...summary, problems: [], warnings: [] })
  renderSection()

  expect(await screen.findByText('สินค้าทุกชิ้นพร้อมลงโฆษณา')).toBeTruthy()
})

test('renders the setup guide as three ordered lists', async () => {
  renderSection()

  for (const name of ['Google Merchant Center', 'Meta Commerce Manager', 'TikTok Ads Manager']) {
    expect(await screen.findByRole('heading', { name })).toBeTruthy()
  }
  expect(screen.getAllByRole('list').filter((el) => el.tagName === 'OL')).toHaveLength(3)
  expect(screen.getByText(/ประเทศ ไทย.*ภาษา ไทย/)).toBeTruthy()
  expect(screen.getByText(/เชื่อม Merchant Center กับบัญชี Google Ads/)).toBeTruthy()
  expect(screen.getAllByText(/พิกเซล/).length).toBeGreaterThanOrEqual(2)
})

test('shows the brand and saves it with its version', async () => {
  routes['PUT /api/v1/admin/marketing/settings/catalog-brand'] = () => Response.json({ ...settings, catalogBrandName: 'สวน', version: 4 })
  const user = userEvent.setup()
  renderSection()

  const input = await screen.findByLabelText('ชื่อแบรนด์ในฟีด')
  await waitFor(() => expect((input as HTMLInputElement).value).toBe('suannn'))
  await user.clear(input)
  await user.type(input, 'สวน')
  await user.click(screen.getByRole('button', { name: 'บันทึกชื่อแบรนด์' }))

  await waitFor(() => {
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ catalogBrandName: 'สวน', version: 3 })
  })
  await waitFor(() => expect(calls.filter((call) => call.path.endsWith('/catalog-feed')).length).toBeGreaterThan(1))
})

test('blocks an empty brand name', async () => {
  const user = userEvent.setup()
  renderSection()

  const input = await screen.findByLabelText('ชื่อแบรนด์ในฟีด')
  await waitFor(() => expect((input as HTMLInputElement).value).toBe('suannn'))
  await user.clear(input)
  await user.click(screen.getByRole('button', { name: 'บันทึกชื่อแบรนด์' }))

  expect(await screen.findByText('กรอกชื่อแบรนด์')).toBeTruthy()
  expect(calls.some((call) => call.method === 'PUT')).toBe(false)
})

test('shows the conflict message when the brand version is stale', async () => {
  routes['PUT /api/v1/admin/marketing/settings/catalog-brand'] = () => Response.json({ code: 'MARKETING_SETTINGS_CONFLICT', message: 'x' }, { status: 409 })
  const user = userEvent.setup()
  renderSection()

  const input = await screen.findByLabelText('ชื่อแบรนด์ในฟีด')
  await waitFor(() => expect((input as HTMLInputElement).value).toBe('suannn'))
  await user.clear(input)
  await user.type(input, 'ใหม่')
  await user.click(screen.getByRole('button', { name: 'บันทึกชื่อแบรนด์' }))

  expect(await screen.findByText('มีคนแก้ไขค่านี้ไปแล้ว กรุณาลองอีกครั้ง')).toBeTruthy()
})

test('shows the brand read-only without marketing:update', async () => {
  renderSection(['marketing:read'])

  expect(await screen.findByText('suannn')).toBeTruthy()
  expect(screen.queryByLabelText('ชื่อแบรนด์ในฟีด')).toBeNull()
  expect(screen.queryByRole('button', { name: 'บันทึกชื่อแบรนด์' })).toBeNull()
})

test('renders nothing without marketing:read', () => {
  renderSection([])

  expect(screen.queryByText('ฟีดสินค้า')).toBeNull()
  expect(calls).toHaveLength(0)
})
