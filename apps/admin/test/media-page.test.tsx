import { afterEach, expect, spyOn, test } from 'bun:test'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router'
import { SidebarProvider } from '@workspace/ui/components/sidebar'
import { Toaster } from '@workspace/ui/components/toast'
import { AppSidebar } from '../src/components/layout/app-sidebar'
import { PermissionGate } from '../src/components/auth/permission-gate'
import { authSessionQuery, type AuthSession } from '../src/lib/auth-session'
import { mediaApi, type MediaDetail, type MediaItem } from '../src/lib/media/api'
import { Component as MediaPage } from '../src/pages/media/media-page'

const usedId = '00000000-0000-4000-8000-0000000000a1'
const unusedId = '00000000-0000-4000-8000-0000000000a2'
const productId = '00000000-0000-4000-8000-000000000001'
const farmId = '00000000-0000-4000-8000-000000000011'
const createdAt = new Date('2026-10-01T08:00:00.000Z')
const allCatalog = ['catalog:read', 'catalog:create', 'catalog:update', 'catalog:delete']

const base = { alt: null, width: 800, height: 600, byteSize: 204800, createdAt }
const usedItem: MediaItem = {
  ...base, id: usedId, url: 'https://cdn.example.test/used.webp', thumbUrl: 'https://cdn.example.test/used-t.webp',
  originalFilename: 'used.jpg', usage: { products: 1, farms: 1 },
}
const unusedItem: MediaItem = {
  ...base, id: unusedId, url: 'https://cdn.example.test/unused.webp', thumbUrl: 'https://cdn.example.test/unused-t.webp',
  originalFilename: 'unused.jpg', usage: { products: 0, farms: 0 },
}
const usedDetail: MediaDetail = {
  ...usedItem,
  usedBy: { products: [{ id: productId, name: 'ทุเรียน', slug: 'durian' }], farms: [{ id: farmId, name: 'บ้านสวน', slot: 'cover' }] },
}
const unusedDetail: MediaDetail = { ...unusedItem, usedBy: { products: [], farms: [] } }

const sessionFor = (permissions: string[]): AuthSession => ({
  session: { id: 'session-1', expiresAt: '2026-10-30T00:00:00.000Z' },
  user: { id: 'staff-1', name: 'เจ้าหน้าที่', email: 'staff@example.com', emailVerified: true, image: null, accountType: 'staff' },
  staff: { role: 'catalog_manager', permissions },
})

const activeSpies: Array<{ mockRestore: () => void }> = []
function track<T extends { mockRestore: () => void }>(spy: T): T {
  activeSpies.push(spy)
  return spy
}

function queryClientFor(permissions: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  queryClient.setQueryData(authSessionQuery.queryKey, sessionFor(permissions), { updatedAt: Date.now() + 10_000 })
  return queryClient
}

function renderMedia(permissions = allCatalog) {
  const queryClient = queryClientFor(permissions)
  const router = createMemoryRouter([
    { path: '/media', element: <PermissionGate permission="catalog:read" />, children: [{ index: true, element: <MediaPage /> }] },
  ], { initialEntries: ['/media'] })
  render(<Toaster><QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider></Toaster>)
  return { queryClient }
}

function mockList(items: MediaItem[] = [usedItem, unusedItem]) {
  return track(spyOn(mediaApi, 'list').mockImplementation(async () => ({ items, nextCursor: null })))
}

afterEach(() => {
  cleanup()
  activeSpies.splice(0).forEach((spy) => spy.mockRestore())
})

test('lists media with usage badges', async () => {
  mockList()
  renderMedia()

  expect(await screen.findByText('ใช้งาน 2')).toBeTruthy()
  expect(screen.getByText('ไม่ได้ใช้')).toBeTruthy()
  expect(screen.getAllByText('800×600 · 200 KB')).toHaveLength(2)
})

test('searches with debounce', async () => {
  const listSpy = mockList()
  const user = userEvent.setup()
  renderMedia()
  await screen.findByText('ใช้งาน 2')

  await user.type(screen.getByRole('searchbox', { name: 'ค้นหารูปภาพ' }), 'durian')
  await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'durian', limit: 40 })))
  expect(listSpy.mock.calls.filter(([query]) => query?.q)).toHaveLength(1)
})

test('shows per-file upload errors', async () => {
  mockList()
  const uploadSpy = track(spyOn(mediaApi, 'upload'))
  const user = userEvent.setup()
  renderMedia()
  await screen.findByText('ใช้งาน 2')

  const big = new File([new Uint8Array(12 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' })
  await user.upload(screen.getByLabelText('เลือกไฟล์ภาพ'), big)

  const status = await screen.findByRole('list', { name: 'สถานะการอัปโหลด' })
  expect(within(status).getByText('big.jpg')).toBeTruthy()
  expect(within(status).getByText('ไฟล์ใหญ่เกิน 10MB')).toBeTruthy()
  expect(uploadSpy).not.toHaveBeenCalled()
})

test('uploads valid files and refreshes the list', async () => {
  const listSpy = mockList()
  const uploadSpy = track(spyOn(mediaApi, 'upload').mockImplementation(async () => ({ item: unusedItem, duplicate: true })))
  const user = userEvent.setup()
  renderMedia()
  await screen.findByText('ใช้งาน 2')

  await user.upload(screen.getByLabelText('เลือกไฟล์ภาพ'), new File(['x'], 'ok.png', { type: 'image/png' }))

  expect(await screen.findByText('มีภาพนี้อยู่แล้ว')).toBeTruthy()
  expect(uploadSpy).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(listSpy.mock.calls.length).toBeGreaterThan(1))
})

test('disables delete for media in use and explains why', async () => {
  mockList()
  track(spyOn(mediaApi, 'get').mockImplementation(async () => usedDetail))
  const user = userEvent.setup()
  renderMedia()

  await user.click(await screen.findByRole('button', { name: 'used.jpg' }))
  const dialog = await screen.findByRole('dialog', { name: 'รายละเอียดรูปภาพ' })

  expect(await within(dialog).findByText('ภาพนี้ถูกใช้งานอยู่ ลบไม่ได้')).toBeTruthy()
  expect((within(dialog).getByRole('button', { name: 'ลบภาพ' }) as HTMLButtonElement).disabled).toBe(true)
  expect(within(dialog).getByRole('link', { name: 'ทุเรียน' }).getAttribute('href')).toBe(`/products/${productId}`)
  expect(within(dialog).getByRole('link', { name: 'บ้านสวน' }).getAttribute('href')).toBe(`/farms/${farmId}`)
})

test('deletes unused media after confirmation', async () => {
  const listSpy = mockList()
  track(spyOn(mediaApi, 'get').mockImplementation(async () => unusedDetail))
  const removeSpy = track(spyOn(mediaApi, 'remove').mockImplementation(async () => undefined))
  const user = userEvent.setup()
  renderMedia()

  await user.click(await screen.findByRole('button', { name: 'unused.jpg' }))
  const sheet = await screen.findByRole('dialog', { name: 'รายละเอียดรูปภาพ' })
  await user.click(await within(sheet).findByRole('button', { name: 'ลบภาพ' }))
  expect(removeSpy).not.toHaveBeenCalled()
  const calls = listSpy.mock.calls.length
  await user.click(await screen.findByRole('button', { name: 'ยืนยันลบภาพ' }))

  await waitFor(() => expect(removeSpy).toHaveBeenCalledWith(unusedId))
  await waitFor(() => expect(listSpy.mock.calls.length).toBeGreaterThan(calls))
})

test('saves alt text', async () => {
  mockList()
  track(spyOn(mediaApi, 'get').mockImplementation(async () => unusedDetail))
  const updateSpy = track(spyOn(mediaApi, 'updateAlt').mockImplementation(async () => unusedItem))
  const user = userEvent.setup()
  renderMedia()

  await user.click(await screen.findByRole('button', { name: 'unused.jpg' }))
  await user.type(await screen.findByLabelText('คำอธิบายภาพ (alt)'), '  ทุเรียนหมอนทอง  ')
  await user.click(screen.getByRole('button', { name: 'บันทึกคำอธิบาย' }))

  await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(unusedId, 'ทุเรียนหมอนทอง'))
})

test('hides write controls from read-only staff', async () => {
  mockList()
  track(spyOn(mediaApi, 'get').mockImplementation(async () => unusedDetail))
  const user = userEvent.setup()
  renderMedia(['catalog:read'])

  await user.click(await screen.findByRole('button', { name: 'unused.jpg' }))
  await screen.findByRole('dialog', { name: 'รายละเอียดรูปภาพ' })
  expect(screen.queryByLabelText('เลือกไฟล์ภาพ')).toBeNull()
  expect(screen.queryByRole('button', { name: 'ลบภาพ' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'บันทึกคำอธิบาย' })).toBeNull()
})

test('hides the menu item without catalog:read', () => {
  for (const [permissions, visible] of [[['catalog:read'], true], [['order:read'], false]] as const) {
    render(
      <QueryClientProvider client={queryClientFor([...permissions])}>
        <MemoryRouter><SidebarProvider><AppSidebar /></SidebarProvider></MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.queryByText('คลังภาพ') !== null).toBe(visible)
    cleanup()
  }
})
