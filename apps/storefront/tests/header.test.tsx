import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { StorefrontLayout } from '../src/pages/layout'
import { authSessionQuery } from '../src/lib/auth-session'
import type { CustomerSession } from '../src/lib/auth-client'
import type { StoreCartDetail } from '../src/lib/store-cart'

const customer: CustomerSession = {
  session: { id: 'header-session', expiresAt: '2099-01-01T00:00:00.000Z' },
  user: { id: 'header-customer', name: 'มะลิ', email: 'mali@example.com', emailVerified: true, image: null, accountType: 'customer' },
}
const originalFetch = globalThis.fetch
let sessionRequest: ReturnType<typeof spyOn<typeof authSessionQuery, 'queryFn'>>
let client: QueryClient
let cart: StoreCartDetail
const cartLine = { variantId: '00000000-0000-4000-8000-000000000101', productId: '00000000-0000-4000-8000-000000000001', productSlug: 'fruit-box', productName: 'Fruit box',
  productImageUrl: null, productImageAlt: null, variantName: 'Small box', unit: 'box', quantity: 1, priceSatang: 1000, canPurchase: true, issues: [] }

beforeEach(() => {
  sessionRequest = spyOn(authSessionQuery, 'queryFn').mockResolvedValue(null)
  cart = { cartVersion: 0, lines: [] }
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
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
      { path: 'products', element: <p>หน้าสินค้า</p> },
      { path: 'checkout', element: <p>หน้าชำระเงิน</p> },
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
  expect(mobile.getAllByRole('link').filter(link => link.getAttribute('href')?.includes('#'))).toEqual([])
  expect(mobile.getByRole('link', { name: 'หน้าแรก' }).getAttribute('aria-current')).toBe('page')
  expect(mobile.getByRole('link', { name: 'สินค้าทั้งหมด' }).getAttribute('href')).toBe('/products')
  expect(mobile.getByRole('link', { name: 'สวนและคนปลูก' }).getAttribute('href')).toBe('/farms')
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

test('staff sessions are treated as signed out', async () => {
  sessionRequest.mockResolvedValue(null)
  mount()
  const header = within(screen.getByRole('banner'))
  expect((await header.findByRole('link', { name: 'เข้าสู่ระบบ' })).getAttribute('href')).toBe('/sign-in')
  expect(header.queryByRole('link', { name: 'ไปหน้าผู้ดูแล' })).toBeNull()
})

test('order CTA starts shopping when the cart is empty', async () => {
  mount()
  const header = within(screen.getByRole('banner'))
  expect(header.getByRole('link', { name: 'เลือกซื้อสินค้า' }).getAttribute('href')).toBe('/products')
  expect(header.queryByRole('link', { name: 'สั่งซื้อและชำระเงิน' })).toBeNull()
})

test('order CTA leads to checkout when the cart can be purchased', async () => {
  cart = { cartVersion: 1, lines: [cartLine] }
  const router = mount()
  const header = within(screen.getByRole('banner'))
  await userEvent.setup().click(await header.findByRole('link', { name: 'สั่งซื้อและชำระเงิน' }))
  expect(router.state.location.pathname).toBe('/checkout')
})

test('order CTA opens the cart when a line needs attention before checkout', async () => {
  cart = { cartVersion: 1, lines: [{ ...cartLine, canPurchase: false, issues: ['OUT_OF_STOCK'] }] }
  mount()
  const header = within(screen.getByRole('banner'))
  await userEvent.setup().click(await header.findByRole('button', { name: 'ตรวจสอบตะกร้า' }))
  expect(await screen.findByRole('dialog', { name: 'ตะกร้าจากสวน · 1 ชิ้น' })).toBeTruthy()
  expect(header.queryByRole('link', { name: 'สั่งซื้อและชำระเงิน' })).toBeNull()
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

test('cart trigger opens the cart independently and restores focus after closing', async () => {
  mount()
  const user = userEvent.setup()
  const trigger = screen.getByRole('button', { name: 'เปิดตะกร้า 0 ชิ้น' })
  await user.click(trigger)
  const cart = await screen.findByRole('dialog', { name: 'ตะกร้าจากสวน · 0 ชิ้น' })
  expect(within(cart).getByText('ตะกร้ายังว่างอยู่')).toBeTruthy()
  expect(screen.queryByRole('dialog', { name: 'เมนูหลัก' })).toBeNull()
  await user.click(within(cart).getByRole('button', { name: 'ปิดตะกร้า' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(trigger))

  await user.click(screen.getByRole('button', { name: 'เปิดเมนู' }))
  expect(await screen.findByRole('dialog', { name: 'เมนูหลัก' })).toBeTruthy()
  expect(screen.queryByRole('dialog', { name: 'ตะกร้าจากสวน · 0 ชิ้น' })).toBeNull()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  trigger.focus()
  await user.keyboard('{Enter}')
  expect(await screen.findByRole('dialog', { name: 'ตะกร้าจากสวน · 0 ชิ้น' })).toBeTruthy()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(trigger))
})
