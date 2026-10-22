import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { ConsentProvider } from '../src/components/consent/consent-provider'
import { useConsent } from '../src/components/consent/consent-context'
import { readConsent, writeConsent } from '../src/lib/tracking/consent'

const originalFetch = globalThis.fetch
let posts: unknown[]
let policyFails: boolean
let client: QueryClient

beforeEach(() => {
  localStorage.clear()
  posts = []
  policyFails = false
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname.endsWith('/store/consent/policy')) {
      if (policyFails) return new Response('{}', { status: 500 })
      return Response.json({ version: '2026-10-21' })
    }
    if (url.pathname.endsWith('/store/consent')) {
      posts.push(await request.json())
      return Response.json({ consentId: '00000000-0000-4000-8000-000000000001' }, { status: 201 })
    }
    throw new Error(`Unexpected request: ${url.pathname}`)
  }) as typeof fetch
})

afterEach(() => {
  cleanup()
  client?.clear()
  globalThis.fetch = originalFetch
})

function Footer() {
  const { openSettings } = useConsent()
  return <button onClick={openSettings}>ตั้งค่าคุกกี้</button>
}

function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<MemoryRouter><QueryClientProvider client={client}><ConsentProvider><Footer /></ConsentProvider></QueryClientProvider></MemoryRouter>)
}

test('banner publishes its height as --consent-banner-offset and resets it when decided', async () => {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 96 })
  try {
    mount()
    await screen.findByRole('button', { name: 'ปฏิเสธ' })
    expect(document.documentElement.style.getPropertyValue('--consent-banner-offset')).toBe('96px')
    expect(screen.getByRole('link', { name: 'นโยบายความเป็นส่วนตัว' }).getAttribute('href')).toBe('/privacy')
    await userEvent.setup().click(screen.getByRole('button', { name: 'ปฏิเสธ' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'ปฏิเสธ' })).toBeNull())
    expect(document.documentElement.style.getPropertyValue('--consent-banner-offset')).toBe('0px')
  } finally {
    if (original) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original)
    else delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight
  }
})

test('first visit shows the banner with three buttons', async () => {
  mount()
  expect(await screen.findByRole('button', { name: 'ยอมรับทั้งหมด' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'ปฏิเสธ' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'ตั้งค่า' })).toBeTruthy()
})

test('reject hides the banner, posts false/false and stores the choice', async () => {
  mount()
  await userEvent.setup().click(await screen.findByRole('button', { name: 'ปฏิเสธ' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'ปฏิเสธ' })).toBeNull())
  expect(posts).toHaveLength(1)
  expect(posts[0]).toMatchObject({ analytics: false, marketing: false, policyVersion: '2026-10-21' })
  expect(readConsent()).toMatchObject({ analytics: false, marketing: false, policyVersion: '2026-10-21', consentId: '00000000-0000-4000-8000-000000000001' })
})

test('a stored choice with an old policy version shows the banner again', async () => {
  writeConsent({ analytics: true, marketing: true, policyVersion: '2025-01-01', consentId: null, decidedAt: new Date().toISOString() })
  mount()
  expect(await screen.findByRole('button', { name: 'ยอมรับทั้งหมด' })).toBeTruthy()
})

test('a current stored choice keeps the banner hidden', async () => {
  writeConsent({ analytics: true, marketing: false, policyVersion: '2026-10-21', consentId: null, decidedAt: new Date().toISOString() })
  mount()
  await waitFor(() => expect(client.getQueryState(['store-consent-policy'])?.status).toBe('success'))
  expect(screen.queryByRole('button', { name: 'ยอมรับทั้งหมด' })).toBeNull()
})

test('footer link opens settings showing the current switches', async () => {
  writeConsent({ analytics: true, marketing: false, policyVersion: '2026-10-21', consentId: null, decidedAt: new Date().toISOString() })
  mount()
  await userEvent.setup().click(screen.getByRole('button', { name: 'ตั้งค่าคุกกี้' }))
  const dialog = await screen.findByRole('dialog')
  expect(dialog).toBeTruthy()
  const necessary = screen.getByRole('checkbox', { name: 'จำเป็น' })
  expect(necessary.getAttribute('aria-checked')).toBe('true')
  expect(necessary.hasAttribute('disabled') || necessary.getAttribute('aria-disabled') === 'true').toBe(true)
  expect(screen.getByRole('checkbox', { name: 'วิเคราะห์การใช้งาน' }).getAttribute('aria-checked')).toBe('true')
  expect(screen.getByRole('checkbox', { name: 'การตลาด' }).getAttribute('aria-checked')).toBe('false')
  await userEvent.setup().click(screen.getByRole('checkbox', { name: 'การตลาด' }))
  await userEvent.setup().click(screen.getByRole('button', { name: 'บันทึกการตั้งค่า' }))
  await waitFor(() => expect(readConsent()).toMatchObject({ analytics: true, marketing: true }))
  expect(posts[0]).toMatchObject({ analytics: true, marketing: true })
})

test('banner still shows when the policy fetch fails', async () => {
  policyFails = true
  mount()
  expect(await screen.findByRole('button', { name: 'ปฏิเสธ' })).toBeTruthy()
})

test('throwing localStorage does not break the banner or accept', async () => {
  const get = spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  const set = spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  try {
    mount()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'ยอมรับทั้งหมด' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'ยอมรับทั้งหมด' })).toBeNull())
    expect(readConsent()).toMatchObject({ analytics: true, marketing: true })
  } finally {
    get.mockRestore()
    set.mockRestore()
  }
})
