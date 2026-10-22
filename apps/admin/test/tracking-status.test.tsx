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
  })) as typeof fetch
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(<QueryClientProvider client={client}><TrackingStatus /></QueryClientProvider>)
  const row = async (name: string) => within((await screen.findByText(name)).closest('tr') as HTMLElement)

  expect((await row('PostHog')).getByText('Healthy')).toBeTruthy()
  const meta = await row('Meta')
  expect(meta.getByText('Failing')).toBeTruthy()
  expect(meta.getByText('3')).toBeTruthy()
  expect(meta.getByText('HTTP_500')).toBeTruthy()
  const tiktok = await row('TikTok')
  expect(tiktok.getByText('Not configured')).toBeTruthy()
  expect(tiktok.getByText('Never')).toBeTruthy()
  expect((await row('Google Ads')).getByText('Degraded')).toBeTruthy()
  globalThis.fetch = previousFetch
})
