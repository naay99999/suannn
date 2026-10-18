import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { Toaster } from '@workspace/ui/components/toast'
import { Component } from '../src/pages/account/addresses-page'
import { authSessionQuery } from '../src/lib/auth-session'
import { addressQueryKey } from '../src/pages/account/account-queries'
import { defaultBadgeLabel, defaultSuccessor, removeAddressFromList, setDefaultInList, sortAddresses } from '../src/pages/account/address-display'

const userId = 'user-1'
const base = { recipientName: 'มะลิ ใจดี', phone: '0812345678', addressLine1: '24 ถนนสุขุมวิท', addressLine2: null, subdistrict: 'คลองตันเหนือ', district: 'วัฒนา', province: 'กรุงเทพมหานคร', postalCode: '10110', country: 'TH' as const, createdAt: new Date(), updatedAt: new Date() }
const home = { ...base, id: 'a1', label: 'บ้าน', isDefaultShipping: false, isDefaultBilling: false }
const office = { ...base, id: 'a2', label: 'ที่ทำงาน', isDefaultShipping: true, isDefaultBilling: true }
const condo = { ...base, id: 'a3', label: 'คอนโด', isDefaultShipping: false, isDefaultBilling: false }
const originalFetch = globalThis.fetch

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

function renderPage(items: typeof home[]) {
  const requests: { method: string; url: string }[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    const method = input instanceof Request ? input.method : init?.method ?? 'GET'
    requests.push({ method, url })
    if (method === 'DELETE') return new Response(null, { status: 200 })
    return new Promise<Response>(() => {})
  }) as typeof fetch
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  queryClient.setQueryData(authSessionQuery.queryKey, { session: { id: 's', expiresAt: '' }, user: { id: userId, name: 'n', email: 'e', emailVerified: true, image: null, accountType: 'customer' } })
  queryClient.setQueryData(addressQueryKey(userId), { items })
  render(<QueryClientProvider client={queryClient}><Toaster><MemoryRouter><Component /></MemoryRouter></Toaster></QueryClientProvider>)
  return { requests, queryClient }
}

test('orders defaults first and keeps the rest oldest-first', () => {
  expect(sortAddresses([home, office, condo]).map(item => item.id)).toEqual(['a2', 'a1', 'a3'])
})

test('predicts which address inherits a removed default, matching the API', () => {
  expect(defaultSuccessor([home, office, condo], 'a2')?.id).toBe('a1')
  expect(defaultSuccessor([home, office, condo], 'a3')).toBeUndefined()
  const next = removeAddressFromList([home, office, condo], 'a2')
  expect(next.find(item => item.id === 'a1')).toMatchObject({ isDefaultShipping: true, isDefaultBilling: true })
  expect(setDefaultInList([home, office], 'a1', 'billing').map(item => item.isDefaultBilling)).toEqual([true, false])
})

test('merges both default kinds into one badge', () => {
  expect(defaultBadgeLabel(office)).toBe('ที่อยู่หลัก')
  expect(defaultBadgeLabel({ isDefaultShipping: false, isDefaultBilling: true })).toBe('ใบเสร็จหลัก')
  expect(defaultBadgeLabel(home)).toBeNull()
})

test('asks before deleting and names the address that becomes the default', async () => {
  const { requests } = renderPage([home, office])
  const user = userEvent.setup()

  await user.click(screen.getByRole('button', { name: 'ตัวเลือกเพิ่มเติมสำหรับ ที่ทำงาน' }))
  await user.click(await screen.findByRole('menuitem', { name: 'ลบที่อยู่' }))

  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText(/ที่อยู่ บ้าน จะกลายเป็นที่อยู่จัดส่งและออกใบเสร็จหลักแทน/)).toBeTruthy()
  expect(requests.some(request => request.method === 'DELETE')).toBe(false)

  await user.click(within(dialog).getByRole('button', { name: 'ลบที่อยู่' }))
  await waitFor(() => expect(requests.some(request => request.method === 'DELETE' && request.url.includes('/a2'))).toBe(true))
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'ที่ทำงาน' })).toBeNull())
})

test('opens the edit form in place of its card and focuses the first field', async () => {
  renderPage([office, home])
  const user = userEvent.setup()

  await user.click(screen.getByRole('button', { name: 'แก้ไขที่อยู่ บ้าน' }))

  expect(await screen.findByRole('region', { name: 'แก้ไขที่อยู่ บ้าน' })).toBeTruthy()
  await waitFor(() => expect(document.activeElement?.id).toBe('address-recipientName'))
  expect(screen.getByRole('heading', { name: 'ที่ทำงาน' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'ยกเลิก' }))
  await waitFor(() => expect(document.activeElement?.id).toBe('address-edit-a1'))
})

test('blocks adding past the address limit and explains why', () => {
  renderPage(Array.from({ length: 20 }, (_, index) => ({ ...home, id: `x${index}`, label: `ที่อยู่ ${index}` })))

  expect((screen.getByRole('button', { name: 'เพิ่มที่อยู่' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText(/บันทึกครบ 20 ที่อยู่แล้ว/)).toBeTruthy()
})
