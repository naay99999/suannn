import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TrackingStatus } from '../src/pages/settings/_components/tracking-status'

afterEach(cleanup)

test('shows delivery status per destination', async () => {
  const previousFetch = globalThis.fetch
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
  globalThis.fetch = (async () => Response.json({
    destinations: [
      { destination: 'posthog', configured: true, lastSuccessAt: hoursAgo(1), failures24h: 0, lastErrorCode: null },
      { destination: 'meta', configured: true, lastSuccessAt: hoursAgo(48), failures24h: 3, lastErrorCode: 'HTTP_500' },
      { destination: 'tiktok', configured: false, lastSuccessAt: null, failures24h: 0, lastErrorCode: null },
      { destination: 'google_ads', configured: true, lastSuccessAt: hoursAgo(2), failures24h: 1, lastErrorCode: 'TIMEOUT' },
    ],
    adSpend: [
      { platform: 'meta', configured: true, lastSuccessAt: hoursAgo(7), lastRunStatus: 'failed', lastErrorCode: 'META_HTTP_500', earliestDate: '2026-07-24' },
      { platform: 'tiktok', configured: false, lastSuccessAt: null, lastRunStatus: null, lastErrorCode: null, earliestDate: null },
      { platform: 'google', configured: true, lastSuccessAt: hoursAgo(1), lastRunStatus: 'failed', lastErrorCode: 'GOOGLE_HTTP_500', earliestDate: '2026-09-01' },
    ],
  })) as typeof fetch
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(<QueryClientProvider client={client}><TrackingStatus /></QueryClientProvider>)
  const row = async (name: string) => within((await screen.findAllByText(name))[0]!.closest('tr') as HTMLElement)
  const spendRow = async (name: string) => {
    const table = (await screen.findByText('Ad spend sync')).closest('[data-slot="card"]') as HTMLElement
    return within(within(table).getByText(name).closest('tr') as HTMLElement)
  }

  expect((await row('PostHog')).getByText('Healthy')).toBeTruthy()
  const meta = await row('Meta')
  expect(meta.getByText('Failing')).toBeTruthy()
  expect(meta.getByText('3')).toBeTruthy()
  expect(meta.getByText('HTTP_500')).toBeTruthy()
  const tiktok = await row('TikTok')
  expect(tiktok.getByText('Not configured')).toBeTruthy()
  expect(tiktok.getByText('Never')).toBeTruthy()
  expect((await row('Google Ads')).getByText('Degraded')).toBeTruthy()

  const spendMeta = await spendRow('Meta')
  expect(spendMeta.getByText('Failing')).toBeTruthy()
  expect(spendMeta.getByText('META_HTTP_500')).toBeTruthy()
  expect((await spendRow('TikTok')).getByText('Not configured')).toBeTruthy()
  const spendGoogle = await spendRow('Google Ads')
  expect(spendGoogle.getByText('Degraded')).toBeTruthy()
  expect(spendGoogle.getByText('2026-09-01')).toBeTruthy()
  globalThis.fetch = previousFetch
})
