import { afterEach, expect, spyOn, test } from 'bun:test'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Toaster } from '@workspace/ui/components/toast'
import { PermissionGate } from '../src/components/auth/permission-gate'
import { ApiRequestError } from '../src/lib/api-result'
import { authSessionQuery, type AuthSession } from '../src/lib/auth-session'
import { catalogApi, type ProductDetail, type ProductFarm } from '../src/lib/catalog/api'
import { farmsApi, type Farm } from '../src/lib/farms/api'
import { ProductFarms } from '../src/pages/products/_components/product-farms'

const productId = '00000000-0000-4000-8000-000000000001'
const at = new Date('2026-10-01T08:00:00.000Z')

function farmId(index: number) {
  return `00000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`
}

function farm(index: number, status: Farm['status'] = 'published'): Farm {
  return {
    id: farmId(index), slug: `farm-${index}`, name: `ฟาร์ม ${index}`, farmerName: null, province: 'ระยอง', district: null,
    summary: null, story: null, growingPractices: null, coverImage: null,
    portraitImage: null, isDemo: false, status,
    createdAt: at, updatedAt: at, publishedAt: null, archivedAt: null,
  }
}

function linked(source: Farm, displayOrder: number): ProductFarm {
  return {
    id: source.id, slug: source.slug, name: source.name, farmerName: source.farmerName, province: source.province,
    district: source.district, summary: source.summary, coverImage: source.coverImage,
    isDemo: source.isDemo, displayOrder, status: source.status,
  }
}

function product(farms: ProductFarm[], status: ProductDetail['status'] = 'published'): ProductDetail {
  return {
    id: productId, slug: 'mango', name: 'มะม่วง', englishName: null, category: 'fresh', images: [],
    status, createdAt: at, updatedAt: at, publishedAt: at, archivedAt: null,
    description: null, originStory: null, storageInstructions: null, farms, variants: [],
  }
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

function renderSection(detail: ProductDetail, permissions = ['catalog:read', 'catalog:update']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
  queryClient.setQueryData(authSessionQuery.queryKey, sessionFor(permissions), { updatedAt: Date.now() + 10_000 })
  const router = createMemoryRouter([{
    path: '/products',
    element: <PermissionGate permission="catalog:read" />,
    children: [{ index: true, element: <ProductFarms product={detail} /> }],
  }], { initialEntries: ['/products'] })
  render(<Toaster><QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider></Toaster>)
}

afterEach(() => {
  cleanup()
  activeSpies.splice(0).forEach((spy) => spy.mockRestore())
})

test('shows linked farms in display order without an edit button for read-only staff', async () => {
  renderSection(product([linked(farm(2), 1), linked(farm(1, 'draft'), 0)]), ['catalog:read'])

  const items = await screen.findAllByRole('listitem')
  expect(items.map((item) => within(item).getByRole('link').textContent)).toEqual(['ฟาร์ม 1', 'ฟาร์ม 2'])
  expect(within(items[0]!).getByText('ร่าง')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'แก้ไขฟาร์มต้นทาง' })).toBeNull()
})

test('adds, reorders, and removes farms, then saves the ordered IDs', async () => {
  track(spyOn(farmsApi, 'list').mockImplementation(async () => ({ items: [farm(1), farm(2), farm(3, 'archived')], nextCursor: null })))
  const replaceSpy = track(spyOn(catalogApi, 'replaceFarms').mockImplementation(async () => []))
  const user = userEvent.setup()
  renderSection(product([linked(farm(1), 0)]))

  await user.click(await screen.findByRole('button', { name: 'แก้ไขฟาร์มต้นทาง' }))
  const picker = await screen.findByRole('combobox', { name: 'เพิ่มฟาร์ม' })
  await waitFor(() => expect(picker.hasAttribute('disabled') || picker.getAttribute('data-disabled') !== null).toBe(false))
  await user.click(picker)
  expect(screen.queryByRole('option', { name: 'ฟาร์ม 3' })).toBeNull()
  await user.click(await screen.findByRole('option', { name: 'ฟาร์ม 2' }))

  await user.click(screen.getByRole('button', { name: 'เลื่อน ฟาร์ม 2 ขึ้น' }))
  await user.click(screen.getByRole('button', { name: 'บันทึกฟาร์มต้นทาง' }))
  await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith(productId, [farmId(2), farmId(1)]))

  await user.click(await screen.findByRole('button', { name: 'แก้ไขฟาร์มต้นทาง' }))
  await user.click(await screen.findByRole('button', { name: 'นำ ฟาร์ม 1 ออก' }))
  await user.click(screen.getByRole('button', { name: 'บันทึกฟาร์มต้นทาง' }))
  await waitFor(() => expect(replaceSpy).toHaveBeenLastCalledWith(productId, []))
})

test('disables adding more farms at the 20-farm limit', async () => {
  const twenty = Array.from({ length: 20 }, (_, index) => linked(farm(index), index))
  track(spyOn(farmsApi, 'list').mockImplementation(async () => ({ items: [farm(99)], nextCursor: null })))
  const user = userEvent.setup()
  renderSection(product(twenty))

  await user.click(await screen.findByRole('button', { name: 'แก้ไขฟาร์มต้นทาง' }))
  expect(await screen.findByText('ผูกได้สูงสุด 20 ฟาร์ม')).toBeTruthy()
  const picker = screen.getByRole('combobox', { name: 'เพิ่มฟาร์ม' })
  expect(picker.hasAttribute('disabled') || picker.getAttribute('data-disabled') !== null).toBe(true)
})

test('shows the conflict message when a farm was archived before saving', async () => {
  track(spyOn(farmsApi, 'list').mockImplementation(async () => ({ items: [farm(1)], nextCursor: null })))
  track(spyOn(catalogApi, 'replaceFarms').mockImplementation(async () => {
    throw new ApiRequestError(409, 'FARM_STATE_CONFLICT', 'ไม่สามารถดำเนินการกับสถานะฟาร์มนี้ได้')
  }))
  const user = userEvent.setup()
  renderSection(product([linked(farm(1), 0)]))

  await user.click(await screen.findByRole('button', { name: 'แก้ไขฟาร์มต้นทาง' }))
  await user.click(screen.getByRole('button', { name: 'บันทึกฟาร์มต้นทาง' }))
  expect((await screen.findByRole('alert')).textContent).toBe('ไม่สามารถดำเนินการกับสถานะฟาร์มนี้ได้')
})

test('does not allow editing farms of an archived product', async () => {
  renderSection(product([], 'archived'))

  await screen.findByText('ยังไม่ได้ผูกฟาร์ม')
  expect(screen.queryByRole('button', { name: 'แก้ไขฟาร์มต้นทาง' })).toBeNull()
})
