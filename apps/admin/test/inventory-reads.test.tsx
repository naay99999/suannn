import { afterEach, expect, spyOn, test } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { PermissionGate } from '../src/components/auth/permission-gate'
import { Component as LotDetailPage } from '../src/pages/inventory/lot-detail-page'
import { Component as InventoryPage } from '../src/pages/inventory/inventory-page'
import { Component as MovementsPage } from '../src/pages/inventory/movements-page'
import { Component as VariantStockPage } from '../src/pages/inventory/variant-stock-page'
import { Component as ProductDetailPage } from '../src/pages/products/product-detail-page'
import { authSessionQuery, type AuthSession } from '../src/lib/auth-session'
import { catalogApi, type ProductDetail } from '../src/lib/catalog/api'
import { inventoryApi, type Lot, type Movement, type StockSummary, type Warehouse } from '../src/lib/inventory/api'
import { cachedVariantMetadataIndex } from '../src/pages/inventory/_components/variant-metadata'

const warehouseId = '00000000-0000-4000-8000-000000000001'
const productId = '00000000-0000-4000-8000-000000000010'
const variantId = '00000000-0000-4000-8000-000000000020'
const lotId = '00000000-0000-4000-8000-000000000030'
const otherVariantId = '00000000-0000-4000-8000-000000000040'
const date = new Date('2026-09-01T08:00:00.000Z')

const warehouse: Warehouse = {
  id: warehouseId,
  code: 'MAIN',
  name: 'คลังหลัก',
  isActive: true,
  createdAt: date,
  updatedAt: date,
}
const quarantinedLot: Lot = {
  id: lotId,
  warehouseId,
  variantId,
  lotCode: 'MANGO-Q-1',
  receivedAt: '2026-08-01T01:00:00.000Z',
  expiryDate: '2026-09-01',
  quarantinedAt: '2026-08-20T02:00:00.000Z',
  quarantineReason: 'ตรวจสอบคุณภาพ',
  onHandQuantity: 0,
  reservedQuantity: 0,
  sellableQuantity: 0,
  createdAt: '2026-08-01T01:00:00.000Z',
  updatedAt: '2026-08-20T02:00:00.000Z',
}
const summary: StockSummary = {
  variantId,
  warehouseId,
  onHandQuantity: 12,
  reservedQuantity: 3,
  eligibleQuantity: 7,
  sellableQuantity: 4,
}
const movements: Movement[] = [
  {
    id: '00000000-0000-4000-8000-000000000050',
    lotId,
    operationId: '00000000-0000-4000-8000-000000000051',
    quantityDelta: -2,
    balanceAfter: 3,
    type: 'write_off',
    reasonCode: 'spoiled',
    occurredAt: '2026-09-02T01:30:00.000Z',
    actorId: 'staff-1',
  },
  {
    id: '00000000-0000-4000-8000-000000000052',
    lotId,
    operationId: '00000000-0000-4000-8000-000000000053',
    quantityDelta: 5,
    balanceAfter: 5,
    type: 'receipt',
    reasonCode: 'receipt',
    occurredAt: '2026-09-01T01:30:00.000Z',
    actorId: 'staff-2',
  },
]

function productData(variants: ProductDetail['variants'] = [variant]) : ProductDetail {
  return {
    id: productId,
    slug: 'nam-dok-mai',
    name: 'มะม่วงน้ำดอกไม้',
    englishName: null,
    category: 'fresh',
    imageUrl: null,
    imageAlt: null,
    status: 'published',
    createdAt: date,
    updatedAt: date,
    publishedAt: date,
    archivedAt: null,
    description: null,
    originStory: null,
    storageInstructions: null,
    variants,
  }
}

const variant: ProductDetail['variants'][number] = {
  id: variantId,
  productId,
  sku: 'MANGO-1KG',
  name: 'ขนาด 1 กิโลกรัม',
  unit: 'กิโลกรัม',
  priceSatang: 10000,
  salesEnabled: true,
  displayOrder: 0,
  minRemainingShelfLifeDays: 1,
  createdAt: date,
  updatedAt: date,
  archivedAt: null,
}
const sessionFor = (permissions: string[]): AuthSession => ({
  session: { id: 'session-1', expiresAt: '2026-10-03T00:00:00.000Z' },
  user: { id: 'staff-1', name: 'เจ้าหน้าที่', email: 'staff@example.com', emailVerified: true, image: null, accountType: 'staff' },
  staff: { role: 'owner', permissions },
})

const activeSpies: Array<{ mockRestore: () => void }> = []

function mockInventory() {
  const movementSpy = spyOn(inventoryApi, 'movements').mockResolvedValue({ items: movements, nextCursor: null })
  const catalogGetSpy = spyOn(catalogApi, 'get').mockImplementation(async () => { throw new Error('Unexpected catalog detail request') })
  activeSpies.push(
    spyOn(inventoryApi, 'warehouse').mockResolvedValue(warehouse),
    spyOn(inventoryApi, 'summary').mockResolvedValue(summary),
    spyOn(inventoryApi, 'lots').mockResolvedValue({ items: [quarantinedLot], nextCursor: null }),
    spyOn(inventoryApi, 'lot').mockResolvedValue(quarantinedLot),
    movementSpy,
    catalogGetSpy,
  )
  return { movementSpy, catalogGetSpy }
}

function renderInventory(initialEntry: string, permissions = ['inventory:read']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  queryClient.setQueryData(authSessionQuery.queryKey, sessionFor(permissions), { updatedAt: Date.now() + 10_000 })
  const router = createMemoryRouter([
    {
      path: '/inventory',
      element: <PermissionGate permission="inventory:read" />,
      children: [
        { index: true, element: <InventoryPage /> },
        { path: 'lots/:lotId', element: <LotDetailPage /> },
        { path: 'variants/:variantId', element: <VariantStockPage /> },
        { path: 'movements', element: <MovementsPage /> },
      ],
    },
    { path: '/products/:productId', element: <ProductDetailPage /> },
  ], { initialEntries: [initialEntry] })
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
  return { queryClient, router }
}

afterEach(() => {
  cleanup()
  activeSpies.splice(0).forEach((spy) => spy.mockRestore())
})

test('resolves MAIN and keeps zero-stock, expired, and quarantined lots visible', async () => {
  mockInventory()
  renderInventory('/inventory')

  expect(await screen.findByText(/คลังหลัก.*MAIN/)).toBeTruthy()
  expect(screen.getByText('MANGO-Q-1')).toBeTruthy()
  expect(screen.getByText('กักกัน')).toBeTruthy()
  expect(screen.getAllByText('0').length).toBeGreaterThan(0)
  expect(screen.getByRole('link', { name: 'MANGO-Q-1' }).getAttribute('href')).toBe(`/inventory/lots/${lotId}`)
  await waitFor(() => expect(inventoryApi.lots).toHaveBeenCalledWith(expect.objectContaining({ warehouseId, limit: 25 })))
  expect(catalogApi.get).not.toHaveBeenCalled()
})

test('builds a reusable variant metadata index from cached product details', () => {
  const queryClient = new QueryClient()
  queryClient.setQueryData(['catalog', 'detail', productId], productData())

  const metadata = cachedVariantMetadataIndex(queryClient)

  expect(metadata.get(variantId)).toEqual({ product: productData(), variant })
  expect(metadata.get('00000000-0000-4000-8000-000000000099')).toBeUndefined()
})

test('shows server stock quantities and direct variant links without router state or cached product metadata', async () => {
  mockInventory()
  renderInventory(`/inventory/variants/${variantId}`)

  expect(await screen.findByText('12')).toBeTruthy()
  expect(screen.getByText('3')).toBeTruthy()
  expect(screen.getByText('7')).toBeTruthy()
  expect(screen.getByText('4')).toBeTruthy()
  expect(screen.getAllByText(variantId).length).toBeGreaterThan(0)
  expect(screen.getAllByRole('button', { name: 'คัดลอกรหัสรูปแบบสินค้า' }).length).toBeGreaterThan(0)
  await waitFor(() => expect(inventoryApi.summary).toHaveBeenCalledWith(variantId))
  await waitFor(() => expect(inventoryApi.lots).toHaveBeenCalledWith(expect.objectContaining({ warehouseId, variantId, limit: 25 })))
})

test('checks optional product context membership before using its name', async () => {
  const { catalogGetSpy } = mockInventory()
  const unrelatedProduct = productData([{ ...variant, id: otherVariantId }])
  catalogGetSpy.mockResolvedValue(unrelatedProduct)
  renderInventory(`/inventory/variants/${variantId}?productId=${productId}`, ['inventory:read', 'catalog:read'])

  expect((await screen.findAllByText(variantId)).length).toBeGreaterThan(0)
  expect(screen.queryByText('มะม่วงน้ำดอกไม้')).toBeNull()
  expect(catalogGetSpy).toHaveBeenCalledWith(productId)
})

test('filters lot history by the selected lot and displays movement deltas with truthful variant IDs', async () => {
  mockInventory()
  renderInventory(`/inventory/lots/${lotId}`)

  expect(await screen.findByRole('heading', { name: /MANGO-Q-1/ })).toBeTruthy()
  expect(screen.getByText('-2')).toBeTruthy()
  expect(screen.getByText('+5')).toBeTruthy()
  expect(screen.getByText('staff-1')).toBeTruthy()
  await waitFor(() => expect(inventoryApi.movements).toHaveBeenCalledWith(expect.objectContaining({ lotId, limit: 25 })))
  expect(catalogApi.get).not.toHaveBeenCalled()
  expect(screen.getAllByRole('button', { name: 'คัดลอกรหัสรูปแบบสินค้า' }).length).toBeGreaterThan(0)
})

test('shows movement filters from the URL and uses only supported endpoint filters', async () => {
  const { movementSpy } = mockInventory()
  renderInventory(`/inventory/movements?variantId=${variantId}&limit=50`)

  expect(await screen.findByText('-2')).toBeTruthy()
  await waitFor(() => expect(inventoryApi.movements).toHaveBeenCalledWith(expect.objectContaining({ warehouseId, variantId, limit: 50 })))
  const query = movementSpy.mock.calls[0]?.[0]
  expect(query && 'q' in query).toBe(false)
  expect(catalogApi.get).not.toHaveBeenCalled()
})

test('denies inventory reads to staff without inventory:read before issuing API requests', async () => {
  mockInventory()
  renderInventory('/inventory', ['catalog:read'])

  expect(await screen.findByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึง' })).toBeTruthy()
  expect(inventoryApi.warehouse).not.toHaveBeenCalled()
  expect(inventoryApi.lots).not.toHaveBeenCalled()
})

test('rejects malformed lot and variant IDs before issuing inventory requests', async () => {
  mockInventory()
  renderInventory('/inventory/lots/not-a-uuid')

  expect(await screen.findByRole('heading', { name: 'รหัสล็อตไม่ถูกต้อง' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'กลับไปหน้าสต็อก' })).toBeTruthy()
  expect(inventoryApi.lot).not.toHaveBeenCalled()
  expect(inventoryApi.movements).not.toHaveBeenCalled()
  cleanup()

  renderInventory('/inventory/variants/not-a-uuid')

  expect(await screen.findByRole('heading', { name: 'รหัสรูปแบบสินค้าไม่ถูกต้อง' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'กลับไปหน้าสต็อก' })).toBeTruthy()
  expect(inventoryApi.warehouse).not.toHaveBeenCalled()
  expect(inventoryApi.summary).not.toHaveBeenCalled()
  expect(inventoryApi.lots).not.toHaveBeenCalled()
})

test('adds live stock links to product variants for staff with inventory read access', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const session = sessionFor(['catalog:read', 'inventory:read'])
  queryClient.setQueryData(authSessionQuery.queryKey, session, { updatedAt: Date.now() + 10_000 })
  expect(queryClient.getQueryData<AuthSession>(authSessionQuery.queryKey)?.staff?.permissions).toContain('inventory:read')
  const detailSpy = spyOn(catalogApi, 'get').mockResolvedValue(productData())
  activeSpies.push(detailSpy)
  const router = createMemoryRouter([{
    path: '/products/:productId',
    element: <PermissionGate permission="catalog:read" />,
    children: [{ index: true, element: <ProductDetailPage /> }],
  }], { initialEntries: [`/products/${productId}`] })
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)

  const stockLink = await screen.findByRole('link', { name: 'ดูสต็อก MANGO-1KG' })
  expect(stockLink.getAttribute('href')).toBe(`/inventory/variants/${variantId}?productId=${productId}`)
})
