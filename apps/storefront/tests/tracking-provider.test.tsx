import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { act, cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useNavigate } from 'react-router'
import { useLayoutEffect, useState, type ReactNode } from 'react'

const captured: string[] = []
const identified: Array<string | null> = []

mock.module('posthog-js', () => ({
  default: {
    init: () => {},
    capture: (name: string) => { captured.push(name) },
    set_config: () => {},
    startSessionRecording: () => {},
    stopSessionRecording: () => {},
    reset: () => { identified.push(null) },
    identify: (id: string) => { identified.push(id) },
    get_distinct_id: () => 'distinct',
    getFeatureFlag: () => undefined,
    onFeatureFlags: () => () => {},
  },
}))

process.env.VITE_POSTHOG_KEY = 'phc_test'
process.env.VITE_META_PIXEL_ID = '111'

const { TrackingProvider } = await import('../src/components/tracking/tracking-provider')
const { ConsentContext } = await import('../src/components/consent/consent-context')

let client: QueryClient
let goTo: (path: string) => void
let setMarketing: (value: boolean) => void

function Nav() {
  const navigate = useNavigate()
  useLayoutEffect(() => { goTo = path => { void navigate(path) } }, [navigate])
  return null
}

function ConsentHarness({ children }: { children: ReactNode }) {
  const [marketing, setMarketingState] = useState(false)
  useLayoutEffect(() => { setMarketing = setMarketingState }, [])
  const noop = async () => {}
  const choice = marketing
    ? { analytics: true, marketing: true, policyVersion: 'v1', consentId: 'c1', decidedAt: '2026-10-22T00:00:00.000Z' }
    : null
  return (
    <ConsentContext.Provider value={{ choice, policyVersion: 'v1', decided: marketing, acceptAll: noop, rejectAll: noop, save: noop, openSettings: () => {} }}>
      {children}
    </ConsentContext.Provider>
  )
}

function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['auth', 'session'], null)
  render(
    <MemoryRouter initialEntries={['/']}>
      <QueryClientProvider client={client}>
        <ConsentHarness><TrackingProvider><Nav /></TrackingProvider></ConsentHarness>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  captured.length = 0
  identified.length = 0
  document.head.querySelectorAll('script[data-tracking-pixel]').forEach(script => script.remove())
  delete (window as { fbq?: unknown }).fbq
})

afterEach(() => {
  cleanup()
  client?.clear()
})

test('no pixel scripts without consent', () => {
  mount()
  expect(document.head.querySelectorAll('script[data-tracking-pixel]').length).toBe(0)
})

test('pixel scripts appear once marketing consent is granted', () => {
  mount()
  act(() => setMarketing(true))
  expect(document.head.querySelector('script[data-tracking-pixel="meta"]')).not.toBeNull()
})

test('each location change produces a page_view', () => {
  mount()
  act(() => goTo('/products'))
  expect(captured.filter(name => name === '$pageview').length).toBe(2)
})

test('granting marketing consent replays the current page_view to pixels only', () => {
  mount()
  act(() => goTo('/products?page=2'))
  const before = captured.filter(name => name === '$pageview').length
  act(() => setMarketing(true))
  const fbq = window.fbq as unknown as { queue: unknown[][] }
  const pageViews = fbq.queue.filter(args => args[0] === 'track' && args[1] === 'PageView')
  expect(pageViews.length).toBe(1)
  expect(captured.filter(name => name === '$pageview').length).toBe(before)
})
