import { afterEach, beforeEach, expect, test } from 'bun:test'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { SidebarProvider } from '@workspace/ui/components/sidebar'
import { AppSidebar } from '../src/components/layout/app-sidebar'
import { authSessionQuery, type AuthSession } from '../src/lib/auth-session'
import { presetRange } from '../src/lib/marketing/format'
import { Component as MarketingPage } from '../src/pages/marketing/marketing-page'

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

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
const totals = { spendSatang: 100_000, revenueSatang: 320_000, orders: 8, roas: 3.2 }
const overview = {
  range: { from: '2026-10-16', to: '2026-10-22' },
  previousRange: { from: '2026-10-09', to: '2026-10-15' },
  breakEvenRoas: 2.86,
  summary: {
    ...totals,
    costPerOrderSatang: 12_500,
    previous: { spendSatang: 80_000, revenueSatang: 200_000, orders: 5, roas: 2.5 },
    unmatched: { revenueSatang: 45_000, orders: 2 },
    nonAdOrders: 4,
  },
  campaigns: [
    { platform: 'meta', utmSource: 'facebook', campaignId: 'c1', campaignName: 'แคมเปญทุเรียน', spendSatang: 50_000, orders: 5, revenueSatang: 250_000, roas: 5, costPerOrderSatang: 10_000, verdict: 'profit' },
    { platform: 'tiktok', utmSource: 'tiktok', campaignId: 'c2', campaignName: 'แคมเปญมังคุด', spendSatang: 50_000, orders: 3, revenueSatang: 70_000, roas: 1.4, costPerOrderSatang: 16_666, verdict: 'loss' },
    { platform: 'google', utmSource: 'google', campaignId: 'c3', campaignName: 'แคมเปญลำไย', spendSatang: 20_000, orders: 0, revenueSatang: 0, roas: 0, costPerOrderSatang: null, verdict: 'no_sales' },
  ],
  warnings: [{ code: 'SPEND_DATA_STARTS_LATE', platform: 'meta', date: '2026-10-18' }],
}
const settings = { marginPercent: 35, version: 3, updatedAt: '2026-10-20T00:00:00.000Z' }
const templates = { templates: [{ platform: 'meta', where: 'Meta Ads > URL parameters', template: 'utm_source=facebook&utm_campaign={{campaign.id}}' }] }
const freshTracking = {
  destinations: [],
  adSpend: [{ platform: 'meta', configured: true, lastSuccessAt: hoursAgo(1), lastRunStatus: 'succeeded', lastErrorCode: null, earliestDate: '2026-07-24' }],
}
const staleTracking = {
  destinations: [],
  adSpend: [{ platform: 'meta', configured: true, lastSuccessAt: hoursAgo(9), lastRunStatus: 'succeeded', lastErrorCode: null, earliestDate: '2026-07-24' }],
}

interface Call { method: string; path: string; search: URLSearchParams; body: unknown }
let calls: Call[] = []
let routes: Record<string, () => Response> = {}
const previousFetch = globalThis.fetch

beforeEach(() => {
  calls = []
  routes = {
    'GET /api/v1/admin/marketing/overview': () => Response.json(overview),
    'GET /api/v1/admin/marketing/settings': () => Response.json(settings),
    'GET /api/v1/admin/marketing/templates': () => Response.json(templates),
    'GET /api/v1/admin/integrations/tracking': () => Response.json(freshTracking),
  }
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null
    const url = new URL(request ? request.url : String(input), 'http://localhost')
    const method = (request?.method ?? init?.method ?? 'GET').toUpperCase()
    const raw = request ? await request.clone().text() : init?.body
    calls.push({ method, path: url.pathname, search: url.searchParams, body: typeof raw === 'string' && raw ? JSON.parse(raw) : undefined })
    const handler = routes[`${method} ${url.pathname}`]
    return handler ? handler() : Response.json({ code: 'NOT_FOUND', message: 'x' }, { status: 404 })
  }) as typeof fetch
})

afterEach(() => {
  cleanup()
  globalThis.fetch = previousFetch
})

function renderPage(permissions = ['marketing:read', 'marketing:update', 'settings:read'], entry = '/marketing') {
  return render(
    <QueryClientProvider client={queryClientFor(permissions)}>
      <MemoryRouter initialEntries={[entry]}><MarketingPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

test('renders the summary and campaign rows with verdict badges', async () => {
  renderPage()

  expect(await screen.findByText('แคมเปญทุเรียน')).toBeTruthy()
  const table = screen.getByRole('table')
  expect(within(table).getByText('กำไร')).toBeTruthy()
  expect(within(table).getByText('ขาดทุน')).toBeTruthy()
  expect(within(table).getByText('ยังไม่มียอดขาย')).toBeTruthy()
  expect(screen.getByText('3.20x')).toBeTruthy()
  expect(screen.getByText(/ยอดขายจาก UTM ที่ไม่พบค่าโฆษณา/)).toBeTruthy()
  expect(screen.getByText('ค่าโฆษณาของ Meta เริ่มมีตั้งแต่วันที่ 2026-10-18')).toBeTruthy()
  expect(screen.queryByText('ข้อมูลค่าโฆษณาอาจไม่ครบ')).toBeNull()
  const overviewCall = calls.find((call) => call.path.endsWith('/overview'))!
  expect(overviewCall.search.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
})

test('keeps the templates panel when the overview fails', async () => {
  routes['GET /api/v1/admin/marketing/overview'] = () => Response.json({ code: 'SERVICE_UNAVAILABLE', message: 'x' }, { status: 503 })
  renderPage()

  expect(await screen.findByText('ตั้งค่า UTM ในแอดแต่ละแพลตฟอร์ม')).toBeTruthy()
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByText('แคมเปญทุเรียน')).toBeNull()
})

test('warns when ad spend data is stale', async () => {
  routes['GET /api/v1/admin/integrations/tracking'] = () => Response.json(staleTracking)
  renderPage()

  expect(await screen.findByText('ข้อมูลค่าโฆษณาอาจไม่ครบ')).toBeTruthy()
})

test('skips the stale warning silently without settings:read', async () => {
  routes['GET /api/v1/admin/integrations/tracking'] = () => Response.json({ code: 'FORBIDDEN', message: 'x' }, { status: 403 })
  renderPage(['marketing:read', 'marketing:update'])

  expect(await screen.findByText('แคมเปญทุเรียน')).toBeTruthy()
  expect(screen.queryByText('ข้อมูลค่าโฆษณาอาจไม่ครบ')).toBeNull()
  expect(calls.some((call) => call.path.endsWith('/integrations/tracking'))).toBe(false)
})

test('saves the margin with its version', async () => {
  routes['PUT /api/v1/admin/marketing/settings'] = () => Response.json({ ...settings, marginPercent: 40, version: 4 })
  const user = userEvent.setup()
  renderPage()

  const input = await screen.findByLabelText('กำไรขั้นต้น (%)')
  await waitFor(() => expect((input as HTMLInputElement).value).toBe('35'))
  await user.clear(input)
  await user.type(input, '40')
  expect(await screen.findByText('ROAS เท่าทุน 2.50x')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'บันทึก' }))

  await waitFor(() => {
    const put = calls.find((call) => call.method === 'PUT')
    expect(put?.body).toEqual({ marginPercent: 40, version: 3 })
  })
})

test('syncs now with an empty JSON body and lists per-platform results', async () => {
  routes['POST /api/v1/admin/marketing/sync'] = () => Response.json({ results: [
    { platform: 'meta', status: 'succeeded' },
    { platform: 'tiktok', status: 'failed', errorCode: 'TIKTOK_HTTP_500' },
    { platform: 'google', status: 'not_configured' },
  ] })
  const user = userEvent.setup()
  renderPage()

  await user.click(await screen.findByRole('button', { name: 'ซิงก์ตอนนี้' }))

  expect(await screen.findByText('TikTok: ไม่สำเร็จ (TIKTOK_HTTP_500)')).toBeTruthy()
  expect(screen.getByText('Google Ads: ยังไม่ได้เชื่อม')).toBeTruthy()
  expect(calls.find((call) => call.method === 'POST')?.body).toEqual({})
})

test('hides the margin save and sync controls without marketing:update', async () => {
  renderPage(['marketing:read'])

  expect(await screen.findByText('แคมเปญทุเรียน')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'ซิงก์ตอนนี้' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'บันทึก' })).toBeNull()
})

test('hides the sidebar item without marketing:read', () => {
  for (const [permissions, visible] of [[['marketing:read'], true], [['order:read'], false]] as const) {
    render(
      <QueryClientProvider client={queryClientFor([...permissions])}>
        <MemoryRouter><SidebarProvider><AppSidebar /></SidebarProvider></MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.queryByText('การตลาด') !== null).toBe(visible)
    cleanup()
  }
})

test('saving a stale margin refetches the settings and shows the conflict message', async () => {
  routes['PUT /api/v1/admin/marketing/settings'] = () => Response.json({ code: 'MARKETING_SETTINGS_CONFLICT', message: 'x' }, { status: 409 })
  const user = userEvent.setup()
  renderPage()

  const input = await screen.findByLabelText('กำไรขั้นต้น (%)')
  await waitFor(() => expect((input as HTMLInputElement).value).toBe('35'))
  await user.clear(input)
  await user.type(input, '40')
  await user.click(screen.getByRole('button', { name: 'บันทึก' }))

  expect(await screen.findByText('มีคนแก้ไขค่านี้ไปแล้ว กรุณาลองอีกครั้ง')).toBeTruthy()
  await waitFor(() => expect(calls.filter((call) => call.method === 'GET' && call.path.endsWith('/settings')).length).toBeGreaterThan(1))
})

test('shows a rate-limit message when sync returns 429', async () => {
  routes['POST /api/v1/admin/marketing/sync'] = () => Response.json({ code: 'RATE_LIMITED', message: 'x' }, { status: 429 })
  const user = userEvent.setup()
  renderPage()

  await user.click(await screen.findByRole('button', { name: 'ซิงก์ตอนนี้' }))

  expect(await screen.findByText('ซิงก์บ่อยเกินไป กรุณารอสักครู่')).toBeTruthy()
})

test('does not query a custom range longer than 366 days', async () => {
  renderPage(undefined, '/marketing?range=custom&from=2025-01-01&to=2026-10-22')

  expect(await screen.findByText('ช่วงวันที่ต้องไม่เกิน 366 วัน')).toBeTruthy()
  await screen.findByLabelText('กำไรขั้นต้น (%)')
  expect(calls.some((call) => call.path.endsWith('/overview'))).toBe(false)
})

test('resolves the month preset in Bangkok time', () => {
  // 18:00 UTC on 31 Oct is already 1 Nov in Bangkok.
  expect(presetRange('month', Date.parse('2026-10-31T18:00:00Z'))).toEqual({ from: '2026-11-01', to: '2026-11-01' })
  expect(presetRange('7d', Date.parse('2026-10-31T18:00:00Z'))).toEqual({ from: '2026-10-26', to: '2026-11-01' })
})
