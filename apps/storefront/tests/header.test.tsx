import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { StorefrontLayout } from '../src/pages/layout'
import { authSessionQuery } from '../src/lib/auth-session'
import type { CustomerSession } from '../src/lib/auth-client'

const customer: CustomerSession = {
  session: { id: 'header-session', expiresAt: '2099-01-01T00:00:00.000Z' },
  user: { id: 'header-customer', name: 'มะลิ', email: 'mali@example.com', emailVerified: true, image: null, accountType: 'customer' },
}
const originalFetch = globalThis.fetch
let sessionRequest: ReturnType<typeof spyOn<typeof authSessionQuery, 'queryFn'>>
let client: QueryClient

beforeEach(() => {
  sessionRequest = spyOn(authSessionQuery, 'queryFn').mockResolvedValue(null)
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const cart = { cartVersion: 0, lines: [] }
    if (url.pathname.endsWith('/store/cart/merge')) return Response.json({ cart, skipped: [] })
    if (url.pathname.endsWith('/store/cart')) return Response.json(cart)
    throw new Error(`Unexpected request: ${url.pathname}`)
  }) as typeof fetch
})

afterEach(() => {
  cleanup()
  client?.clear()
  sessionRequest.mockRestore()
  globalThis.fetch = originalFetch
})

function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([
    { path: '/', element: <StorefrontLayout />, children: [
      { index: true, element: <p>หน้าแรก</p> },
      { path: 'sign-in', element: <p>หน้าเข้าสู่ระบบ</p> },
      { path: 'account', element: <p>หน้าบัญชี</p> },
    ] },
  ])
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}

test('anonymous visitors can sign in from desktop and mobile navigation', async () => {
  const router = mount()
  const header = within(screen.getByRole('banner'))
  expect((await header.findByRole('link', { name: 'เข้าสู่ระบบ' })).getAttribute('href')).toBe('/sign-in')
  expect(header.queryByRole('link', { name: 'บัญชีของฉัน' })).toBeNull()
  const user = userEvent.setup()
  await user.click(header.getByRole('button', { name: 'เปิดเมนู' }))
  const mobile = within(screen.getByRole('navigation', { name: 'เมนูมือถือ' }))
  expect(mobile.getByRole('link', { name: 'สินค้าทั้งหมด' }).getAttribute('href')).toBe('/products')
  expect(mobile.getByRole('link', { name: 'ที่มาของสินค้า' }).getAttribute('href')).toBe('/#from-the-farm')
  expect(mobile.getByRole('link', { name: 'เกี่ยวกับเรา' }).getAttribute('href')).toBe('/#our-story')
  mobile.getByRole('link', { name: 'เข้าสู่ระบบ' }).focus()
  await user.keyboard('{Enter}')
  expect(router.state.location.pathname).toBe('/sign-in')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'เมนูหลัก' })).toBeNull())
})

test('customer account control follows login and logout cache changes in both menus', async () => {
  mount()
  const header = within(screen.getByRole('banner'))
  await header.findByRole('link', { name: 'เข้าสู่ระบบ' })
  await userEvent.setup().click(header.getByRole('button', { name: 'เปิดเมนู' }))
  await act(async () => { client.setQueryData(authSessionQuery.queryKey, customer) })
  await waitFor(() => expect(screen.getAllByRole('link', { name: 'บัญชีของฉัน', hidden: true }).length).toBe(2))
  for (const link of screen.getAllByRole('link', { name: 'บัญชีของฉัน', hidden: true })) expect(link.getAttribute('href')).toBe('/account')
  expect(header.queryByRole('link', { name: 'เข้าสู่ระบบ' })).toBeNull()
  await act(async () => { client.setQueryData(authSessionQuery.queryKey, null) })
  await waitFor(() => expect(screen.getAllByRole('link', { name: 'เข้าสู่ระบบ', hidden: true }).length).toBe(2))
  expect(header.queryByRole('link', { name: 'บัญชีของฉัน' })).toBeNull()
})

test('unknown session shows disabled checking controls instead of a sign-in CTA', async () => {
  sessionRequest.mockImplementation(() => new Promise(() => {}))
  mount()
  const header = within(screen.getByRole('banner'))
  expect((header.getByRole('button', { name: 'กำลังตรวจสอบบัญชี' }) as HTMLButtonElement).disabled).toBe(true)
  expect(header.queryByRole('link', { name: 'เข้าสู่ระบบ' })).toBeNull()
  await userEvent.setup().click(header.getByRole('button', { name: 'เปิดเมนู' }))
  expect(screen.getAllByRole('button', { name: 'กำลังตรวจสอบบัญชี', hidden: true }).every(button => (button as HTMLButtonElement).disabled)).toBe(true)
})

test('session failures offer retry and recover to sign-in when the request succeeds', async () => {
  sessionRequest.mockRejectedValueOnce(new Error('offline'))
  mount()
  const header = within(screen.getByRole('banner'))
  const retry = await header.findByRole('button', { name: 'ตรวจสอบบัญชีอีกครั้ง' })
  expect(header.queryByRole('link', { name: 'เข้าสู่ระบบ' })).toBeNull()
  await userEvent.setup().click(retry)
  expect((await header.findByRole('link', { name: 'เข้าสู่ระบบ' })).getAttribute('href')).toBe('/sign-in')
})

test('staff sessions link to admin sign-in instead of the customer account', async () => {
  sessionRequest.mockResolvedValue({ ...customer, user: { ...customer.user, accountType: 'staff' } })
  mount()
  const header = within(screen.getByRole('banner'))
  const link = await header.findByRole('link', { name: 'ไปหน้าผู้ดูแล' })
  expect(new URL(link.getAttribute('href')!).pathname).toBe('/login')
  expect(header.queryByRole('link', { name: 'บัญชีของฉัน' })).toBeNull()
  await userEvent.setup().click(header.getByRole('button', { name: 'เปิดเมนู' }))
  expect(within(screen.getByRole('navigation', { name: 'เมนูมือถือ' })).getByRole('link', { name: 'ไปหน้าผู้ดูแล' }).getAttribute('href')).toBe(link.getAttribute('href'))
})


test('mobile menu opens as a modal and Escape restores focus to its trigger', async () => {
  mount()
  const user = userEvent.setup()
  const trigger = screen.getByRole('button', { name: 'เปิดเมนู' })
  await user.click(trigger)
  const menu = await screen.findByRole('dialog', { name: 'เมนูหลัก' })
  expect(within(menu).getByRole('navigation', { name: 'เมนูมือถือ' })).toBeTruthy()
  expect(screen.queryByRole('main')).toBeNull()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(trigger))
  expect(screen.getByRole('main')).toBeTruthy()
})

test('mobile menu close button dismisses the modal', async () => {
  mount()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'เปิดเมนู' }))
  const menu = await screen.findByRole('dialog', { name: 'เมนูหลัก' })
  await user.click(within(menu).getByRole('button', { name: 'ปิดเมนู' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})
