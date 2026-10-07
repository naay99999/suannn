import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { FeaturedFarms } from '../src/components/farms/featured-farms'

const originalFetch = globalThis.fetch
afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '*', element: <FeaturedFarms /> }], { initialEntries: ['/'] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return client
}

test('homepage farm feature loads API-backed profiles and links to the directory', async () => {
  globalThis.fetch = (async () => Response.json({ items: [{
    id: '00000000-0000-4000-8000-000000000101', slug: 'mae-rim', name: 'สวนแม่ริม', farmerName: 'คุณใจดี',
    province: 'เชียงใหม่', district: 'แม่ริม', summary: 'สวนผลไม้', coverImageUrl: null, coverImageAlt: null, isDemo: true,
  }], nextCursor: null })) as typeof fetch
  mount()
  expect(await screen.findByRole('heading', { name: 'สวนแม่ริม' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'ดูสวนทั้งหมด' }).getAttribute('href')).toBe('/farms')
  expect(screen.getByText('ข้อมูลสาธิต')).toBeTruthy()
})

test('homepage farm feature keeps its empty state informative', async () => {
  globalThis.fetch = (async () => Response.json({ items: [], nextCursor: null })) as typeof fetch
  mount()
  expect(await screen.findByText('ยังไม่มีโปรไฟล์สวนที่เผยแพร่')).toBeTruthy()
})
