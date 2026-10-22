import { afterEach, beforeEach, expect, test } from 'bun:test'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { authSessionQuery, type AuthSession } from '../src/lib/auth-session'
import { formatPercent } from '../src/lib/marketing/format'
import { Component as MarketingPage } from '../src/pages/marketing/marketing-page'

const session: AuthSession = {
  session: { id: 'session-1', expiresAt: '2026-10-30T00:00:00.000Z' },
  user: { id: 'staff-1', name: 'เจ้าหน้าที่', email: 'staff@example.com', emailVerified: true, image: null, accountType: 'staff' },
  staff: { role: 'admin', permissions: ['marketing:read'] },
}

const overview = {
  range: { from: '2026-10-16', to: '2026-10-22' },
  previousRange: { from: '2026-10-09', to: '2026-10-15' },
  breakEvenRoas: 2.86,
  summary: {
    spendSatang: 100_000, revenueSatang: 320_000, orders: 8, roas: 3.2, costPerOrderSatang: 12_500,
    previous: { spendSatang: 80_000, revenueSatang: 200_000, orders: 5, roas: 2.5 },
    unmatched: { revenueSatang: 45_000, orders: 2 },
    nonAdOrders: 4,
  },
  campaigns: [
    { platform: 'meta', utmSource: 'facebook', campaignId: 'c1', campaignName: 'แคมเปญทุเรียน', spendSatang: 50_000, orders: 5, revenueSatang: 250_000, roas: 5, costPerOrderSatang: 10_000, verdict: 'profit' },
    { platform: 'tiktok', utmSource: 'tiktok', campaignId: 'c2', campaignName: 'แคมเปญมังคุด', spendSatang: 50_000, orders: 3, revenueSatang: 70_000, roas: 1.4, costPerOrderSatang: 16_666, verdict: 'loss' },
  ],
  warnings: [],
}
const step = (event: string, label: string, count: number, conversionFromPrevious: number | null, dropOffFromPrevious: number | null) => ({ event, label, count, conversionFromPrevious, dropOffFromPrevious })
const funnel = {
  steps: [
    step('$pageview', 'เข้าเว็บ', 1000, null, null),
    step('view_item', 'ดูสินค้า', 600, 0.6, 0.4),
    step('add_to_cart', 'ใส่ตะกร้า', 120, 0.2, 0.8),
    step('begin_checkout', 'เริ่มชำระเงิน', 60, 0.5, 0.5),
    step('purchase', 'ซื้อสำเร็จ', 3, 0.05, 0.95),
  ],
}
const experiments = {
  experiments: [
    { id: 1, name: 'ทดสอบปุ่มซื้อ', status: 'complete', startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-15T00:00:00.000Z', flagKey: 'buy-button', url: 'https://eu.posthog.com/project/1/experiments/1', variants: [{ key: 'control', exposures: 500, conversions: 20, conversionRate: 0.04 }, { key: 'test', exposures: 500, conversions: 35, conversionRate: 0.07 }], winner: 'test', readable: true },
    { id: 2, name: 'ทดสอบราคา', status: 'running', startDate: '2026-10-10T00:00:00.000Z', endDate: null, flagKey: 'price', url: 'https://eu.posthog.com/project/1/experiments/2', variants: null, winner: null, readable: false },
  ],
}

interface Call { path: string; search: URLSearchParams }
let calls: Call[] = []
let routes: Record<string, () => Response> = {}
const previousFetch = globalThis.fetch

beforeEach(() => {
  calls = []
  routes = {
    'GET /api/v1/admin/marketing/overview': () => Response.json(overview),
    'GET /api/v1/admin/marketing/settings': () => Response.json({ marginPercent: 35, version: 1, updatedAt: '2026-10-20T00:00:00.000Z' }),
    'GET /api/v1/admin/marketing/templates': () => Response.json({ templates: [] }),
    'GET /api/v1/admin/marketing/funnel': () => Response.json(funnel),
    'GET /api/v1/admin/marketing/experiments': () => Response.json(experiments),
  }
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null
    const url = new URL(request ? request.url : String(input), 'http://localhost')
    const method = (request?.method ?? init?.method ?? 'GET').toUpperCase()
    calls.push({ path: url.pathname, search: url.searchParams })
    const handler = routes[`${method} ${url.pathname}`]
    return handler ? handler() : Response.json({ code: 'NOT_FOUND', message: 'x' }, { status: 404 })
  }) as typeof fetch
})

afterEach(() => {
  cleanup()
  globalThis.fetch = previousFetch
})

function renderPage(entry = '/marketing') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  queryClient.setQueryData(authSessionQuery.queryKey, session, { updatedAt: Date.now() + 60_000 })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}><MarketingPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

test('formats percentages with a decimal only under 10%', () => {
  expect(formatPercent(0.6)).toBe('60%')
  expect(formatPercent(0.055)).toBe('5.5%')
  expect(formatPercent(null)).toBe('—')
})

test('renders the five funnel steps with conversion from the previous step', async () => {
  renderPage()

  const list = await screen.findByRole('list', { name: 'ขั้นตอนการซื้อ' })
  for (const label of ['เข้าเว็บ', 'ดูสินค้า', 'ใส่ตะกร้า', 'เริ่มชำระเงิน', 'ซื้อสำเร็จ']) expect(within(list).getByText(label)).toBeTruthy()
  const second = within(list).getAllByRole('listitem')[1]!
  expect(within(second).getByText(/600/)).toBeTruthy()
  expect(within(second).getByText(/60%/)).toBeTruthy()
  expect(within(second).getByText(/40%/)).toBeTruthy()
  expect(screen.getByText('อิงข้อมูลผู้เยี่ยมชมใน PostHog')).toBeTruthy()
})

test('selecting a platform refetches the funnel with platform=meta and resets the campaign', async () => {
  const user = userEvent.setup()
  renderPage('/marketing?platform=tiktok&campaign=c2')
  await screen.findByRole('list', { name: 'ขั้นตอนการซื้อ' })
  expect(calls.filter((call) => call.path.endsWith('/funnel')).at(-1)!.search.get('campaign')).toBe('c2')

  await user.click(screen.getByRole('combobox', { name: 'แพลตฟอร์ม' }))
  await user.click(await screen.findByRole('option', { name: 'Meta' }))

  await waitFor(() => {
    const last = calls.filter((call) => call.path.endsWith('/funnel')).at(-1)!
    expect(last.search.get('platform')).toBe('meta')
    expect(last.search.get('campaign')).toBeNull()
  })
})

test('does not request the funnel for a range that is too long', async () => {
  renderPage('/marketing?range=custom&from=2024-01-01&to=2026-10-22')
  await screen.findByText('ช่วงวันที่ต้องไม่เกิน 366 วัน')
  expect(calls.some((call) => call.path.endsWith('/funnel'))).toBe(false)
})

test('renders experiment verdicts, status and the PostHog link', async () => {
  renderPage()

  expect(await screen.findByText('แบบ test ชนะ')).toBeTruthy()
  expect(screen.getByText('ยังสรุปไม่ได้ — ดูใน PostHog')).toBeTruthy()
  expect(screen.getByText('จบแล้ว')).toBeTruthy()
  expect(screen.getByText('กำลังทดสอบ')).toBeTruthy()
  expect(screen.getByText('รวมเฉพาะผู้เยี่ยมชมที่ยอมรับคุกกี้วิเคราะห์')).toBeTruthy()
  const links = screen.getAllByRole('link', { name: 'เปิดใน PostHog' })
  expect(links[0]!.getAttribute('target')).toBe('_blank')
  expect(links[0]!.getAttribute('rel')).toBe('noreferrer')
})

test('shows an empty state, not an error, when PostHog reading is not configured', async () => {
  const notConfigured = () => Response.json({ code: 'POSTHOG_READ_NOT_CONFIGURED', message: 'x' }, { status: 503 })
  routes['GET /api/v1/admin/marketing/funnel'] = notConfigured
  routes['GET /api/v1/admin/marketing/experiments'] = notConfigured
  renderPage()

  const empties = await screen.findAllByText('ยังไม่ได้เชื่อม PostHog สำหรับอ่านข้อมูล — ดูวิธีตั้งค่าใน README หัวข้อ Marketing page')
  expect(empties).toHaveLength(2)
  expect(screen.queryByRole('alert')).toBeNull()
})

test('shows the section error state for other PostHog failures', async () => {
  routes['GET /api/v1/admin/marketing/funnel'] = () => Response.json({ code: 'POSTHOG_READ_UNAVAILABLE', message: 'x' }, { status: 503 })
  renderPage()

  expect(await screen.findByText('ดึงข้อมูลจาก PostHog ไม่สำเร็จ กรุณาลองอีกครั้ง')).toBeTruthy()
  expect(await screen.findByText('แบบ test ชนะ')).toBeTruthy()
})
