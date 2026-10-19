import { afterEach, expect, spyOn, test } from 'bun:test'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Toaster } from '@workspace/ui/components/toast'
import { PermissionGate } from '../src/components/auth/permission-gate'
import { authSessionQuery, type AuthSession } from '../src/lib/auth-session'
import { farmsApi, type Farm } from '../src/lib/farms/api'
import { mediaApi, type MediaItem } from '../src/lib/media/api'
import { Component as FarmsPage } from '../src/pages/farms/farms-page'
import { Component as FarmCreatePage } from '../src/pages/farms/farm-create-page'
import { Component as FarmDetailPage } from '../src/pages/farms/farm-detail-page'

const farmId = '00000000-0000-4000-8000-000000000011'
const coverId = '00000000-0000-4000-8000-0000000000a1'
const updatedAt = new Date('2026-10-01T08:00:00.000Z')
const allCatalog = ['catalog:read', 'catalog:create', 'catalog:update', 'catalog:publish', 'catalog:delete']

const completeDraft: Farm = {
  id: farmId,
  slug: 'baan-suan',
  name: 'บ้านสวน',
  farmerName: 'ลุงสม',
  province: 'ระยอง',
  district: 'แกลง',
  summary: 'สวนผลไม้ผสม',
  story: 'เริ่มปลูกเมื่อปี 2540',
  growingPractices: 'ใช้ปุ๋ยหมัก',
  coverImage: { id: coverId, url: 'https://example.com/cover.webp', thumbUrl: 'https://example.com/cover-t.webp', alt: 'สวนทุเรียน', width: 800, height: 600 },
  portraitImage: null,
  isDemo: false,
  status: 'draft',
  createdAt: updatedAt,
  updatedAt,
  publishedAt: null,
  archivedAt: null,
}

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

function renderFarms(initialEntry: string, permissions = allCatalog) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  queryClient.setQueryData(authSessionQuery.queryKey, sessionFor(permissions), { updatedAt: Date.now() + 10_000 })
  const router = createMemoryRouter([
    {
      path: '/farms',
      element: <PermissionGate permission="catalog:read" />,
      children: [
        { index: true, element: <FarmsPage /> },
        { path: 'new', element: <FarmCreatePage /> },
        { path: ':farmId', element: <FarmDetailPage /> },
      ],
    },
  ], { initialEntries: [initialEntry] })
  render(<Toaster><QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider></Toaster>)
  return { router }
}

afterEach(() => {
  cleanup()
  activeSpies.splice(0).forEach((spy) => spy.mockRestore())
})

test('lists farms with demo badge and requests the selected status', async () => {
  const listSpy = track(spyOn(farmsApi, 'list').mockImplementation(async () => ({ items: [{ ...completeDraft, isDemo: true }], nextCursor: null })))
  const user = userEvent.setup()
  renderFarms('/farms')

  const link = await screen.findByRole('link', { name: 'บ้านสวน' })
  expect(link.getAttribute('href')).toBe(`/farms/${farmId}`)
  expect(screen.getByText('ตัวอย่าง')).toBeTruthy()
  expect(screen.getByText('แกลง, ระยอง')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'เพิ่มฟาร์ม' })).toBeTruthy()

  await user.click(screen.getByRole('combobox', { name: 'กรองตามสถานะ' }))
  await user.click(await screen.findByRole('option', { name: 'เผยแพร่แล้ว' }))
  await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'published', limit: 25 })))
})

test('hides farm writes from read-only catalog staff', async () => {
  track(spyOn(farmsApi, 'list').mockImplementation(async () => ({ items: [completeDraft], nextCursor: null })))
  track(spyOn(farmsApi, 'get').mockImplementation(async () => completeDraft))
  renderFarms('/farms', ['catalog:read'])

  await screen.findByRole('link', { name: 'บ้านสวน' })
  expect(screen.queryByRole('link', { name: 'เพิ่มฟาร์ม' })).toBeNull()
  cleanup()

  renderFarms(`/farms/${farmId}`, ['catalog:read'])
  await screen.findByRole('heading', { name: 'บ้านสวน' })
  expect(screen.queryByRole('button', { name: 'แก้ไขฟาร์ม' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'เผยแพร่ฟาร์ม' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'เก็บฟาร์ม' })).toBeNull()
})

test('creates a draft farm and opens its detail page', async () => {
  const createSpy = track(spyOn(farmsApi, 'create').mockImplementation(async () => completeDraft))
  track(spyOn(farmsApi, 'get').mockImplementation(async () => completeDraft))
  const user = userEvent.setup()
  const { router } = renderFarms('/farms/new')

  await user.type(await screen.findByLabelText('ชื่อ URL ฟาร์ม'), 'baan-suan')
  await user.type(screen.getByLabelText('ชื่อฟาร์ม'), 'บ้านสวน')
  await user.type(screen.getByLabelText('จังหวัด'), 'ระยอง')
  await user.click(screen.getByRole('button', { name: 'สร้างฟาร์ม' }))

  await waitFor(() => expect(router.state.location.pathname).toBe(`/farms/${farmId}`))
  expect(createSpy.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ slug: 'baan-suan', name: 'บ้านสวน', province: 'ระยอง', story: null }))
})

test('blocks publishing until the farm profile is complete', async () => {
  track(spyOn(farmsApi, 'get').mockImplementation(async () => ({ ...completeDraft, story: null })))
  renderFarms(`/farms/${farmId}`)

  const publish = await screen.findByRole('button', { name: 'เผยแพร่ฟาร์ม' })
  expect(publish.hasAttribute('disabled')).toBe(true)
  const checklist = screen.getByRole('list', { name: 'รายการตรวจสอบก่อนเผยแพร่' })
  expect(within(checklist).getByText(/เรื่องราวของฟาร์ม/).textContent).toContain('✕')
})

test('publishes a complete draft after confirmation', async () => {
  let current: Farm = completeDraft
  track(spyOn(farmsApi, 'get').mockImplementation(async () => current))
  const publishSpy = track(spyOn(farmsApi, 'publish').mockImplementation(async () => {
    current = { ...completeDraft, status: 'published', publishedAt: updatedAt }
    return current
  }))
  const user = userEvent.setup()
  renderFarms(`/farms/${farmId}`)

  await user.click(await screen.findByRole('button', { name: 'เผยแพร่ฟาร์ม' }))
  await user.click(await screen.findByRole('button', { name: 'ยืนยันเผยแพร่ฟาร์ม' }))

  await waitFor(() => expect(publishSpy).toHaveBeenCalledWith(farmId))
  expect(await screen.findByRole('button', { name: 'นำออกจากการเผยแพร่' })).toBeTruthy()
})

test('does not offer edits or actions for archived farms', async () => {
  track(spyOn(farmsApi, 'get').mockImplementation(async () => ({ ...completeDraft, status: 'archived', archivedAt: updatedAt })))
  renderFarms(`/farms/${farmId}`)

  await screen.findByRole('heading', { name: 'บ้านสวน' })
  expect(screen.queryByRole('button', { name: 'แก้ไขฟาร์ม' })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'การเผยแพร่' })).toBeNull()
})

test('submits coverMediaId from the picker', async () => {
  const pickedId = '00000000-0000-4000-8000-0000000000b2'
  const picked: MediaItem = {
    id: pickedId, url: 'https://example.com/new.webp', thumbUrl: 'https://example.com/new-t.webp', alt: 'สวนใหม่',
    width: 800, height: 600, byteSize: 2048, createdAt: updatedAt, originalFilename: 'new.jpg', usage: { products: 0, farms: 0 },
  }
  track(spyOn(farmsApi, 'get').mockImplementation(async () => completeDraft))
  track(spyOn(mediaApi, 'list').mockImplementation(async () => ({ items: [picked], nextCursor: null })))
  const updateSpy = track(spyOn(farmsApi, 'update').mockImplementation(async () => completeDraft))
  const user = userEvent.setup()
  renderFarms(`/farms/${farmId}`)

  await user.click(await screen.findByRole('button', { name: 'แก้ไขฟาร์ม' }))
  await user.click(await screen.findByRole('button', { name: 'เปลี่ยนรูปปก' }))
  await user.click(await screen.findByRole('button', { name: 'new.jpg' }))
  await user.click(screen.getByRole('button', { name: 'ยืนยันการเลือก' }))
  await user.click(screen.getByRole('button', { name: 'บันทึกฟาร์ม' }))

  await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(farmId, expect.objectContaining({ coverMediaId: pickedId, portraitMediaId: null })))
})
