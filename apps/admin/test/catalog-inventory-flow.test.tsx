import { afterEach, expect, spyOn, test } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { PermissionGate } from '../src/components/auth/permission-gate'
import { authSessionQuery, type AuthSession } from '../src/lib/auth-session'
import type { ProductDetail, ProductSummary, Variant } from '../src/lib/catalog/api'
import type { Lot, Movement, Reservation, StockSummary, Warehouse } from '../src/lib/inventory/api'
import { Component as InventoryPage } from '../src/pages/inventory/inventory-page'
import { Component as LotDetailPage } from '../src/pages/inventory/lot-detail-page'
import { Component as ReceiveLotPage } from '../src/pages/inventory/receive-lot-page'
import { Component as ReservationCreatePage } from '../src/pages/inventory/reservation-create-page'
import { Component as ReservationDetailPage } from '../src/pages/inventory/reservation-detail-page'
import { Component as ReservationLookupPage } from '../src/pages/inventory/reservation-lookup-page'
import { Component as VariantStockPage } from '../src/pages/inventory/variant-stock-page'
import { Component as ProductCreatePage } from '../src/pages/products/product-create-page'
import { Component as ProductDetailPage } from '../src/pages/products/product-detail-page'
import { Component as ProductsPage } from '../src/pages/products/products-page'

const productId = '00000000-0000-4000-8000-000000000010'
const variantId = '00000000-0000-4000-8000-000000000020'
const warehouseId = '00000000-0000-4000-8000-000000000001'
const lotId = '00000000-0000-4000-8000-000000000030'
const reservationIds = [
  '00000000-0000-4000-8000-000000000040',
  '00000000-0000-4000-8000-000000000041',
]
const recordedAt = '2026-10-03T00:00:00.000Z'
const recordedDate = new Date(recordedAt)
const ownerPermissions = ['catalog:read', 'catalog:create', 'catalog:update', 'catalog:publish', 'catalog:delete', 'inventory:read', 'inventory:adjust']
const fulfillmentPermissions = ['catalog:read', 'inventory:read', 'inventory:adjust']

type RecordedRequest = {
  method: string
  path: string
  search: string
  body: Record<string, unknown> | null
  headers: Headers
}

function productVariant(id = variantId, priceSatang = 18_900): Variant {
  return {
    id,
    productId,
    sku: 'MANGO-1KG',
    name: 'ขนาด 1 กิโลกรัม',
    unit: 'กิโลกรัม',
    priceSatang,
    salesEnabled: true,
    displayOrder: 0,
    minRemainingShelfLifeDays: 1,
    createdAt: recordedDate,
    updatedAt: recordedDate,
    archivedAt: null,
  }
}

function productDetail(status: ProductDetail['status'] = 'draft'): ProductDetail {
  return {
    id: productId,
    slug: 'mango-demo',
    name: 'มะม่วงทดสอบ',
    englishName: 'Test mango',
    category: 'fresh',
    imageUrl: 'https://assets.example.test/mango.jpg',
    imageAlt: 'มะม่วงน้ำดอกไม้',
    status,
    createdAt: recordedDate,
    updatedAt: recordedDate,
    publishedAt: status === 'published' ? recordedDate : null,
    archivedAt: null,
    description: 'มะม่วงน้ำดอกไม้สำหรับตรวจสอบขั้นตอนจัดการสินค้า',
    originStory: 'สวนทดสอบ',
    storageInstructions: 'เก็บในที่เย็น',
    variants: [productVariant()],
  }
}

function productSummary(product: ProductDetail): ProductSummary {
  const { description: _description, originStory: _originStory, storageInstructions: _storageInstructions, variants: _variants, ...summary } = product
  return summary
}

function inventoryLot(overrides: Partial<Lot> = {}): Lot {
  return {
    id: lotId,
    warehouseId,
    variantId,
    lotCode: 'FULFILLMENT-LOT-1',
    receivedAt: recordedAt,
    expiryDate: '2027-12-31',
    quarantinedAt: null,
    quarantineReason: null,
    onHandQuantity: 8,
    reservedQuantity: 0,
    sellableQuantity: 8,
    createdAt: recordedAt,
    updatedAt: recordedAt,
    ...overrides,
  }
}

function parseBody(value: BodyInit | null | undefined): Record<string, unknown> | null {
  if (typeof value !== 'string' || value.length === 0) return null
  return JSON.parse(value) as Record<string, unknown>
}

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

class CatalogInventoryBoundary {
  readonly requests: RecordedRequest[] = []
  product: ProductDetail | null
  lots: Lot[]
  readonly reservations = new Map<string, Reservation>()
  readonly movements: Movement[] = []
  private reservationIndex = 0

  constructor(product: ProductDetail | null = null, lots: Lot[] = []) {
    this.product = product
    this.lots = lots
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const inputRequest = input instanceof Request ? input : null
    const url = new URL(inputRequest?.url ?? String(input))
    const method = (init?.method ?? inputRequest?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers ?? inputRequest?.headers)
    const body = parseBody(init?.body)
    const path = url.pathname.replace(/^\/api\/v1\/admin/, '')
    this.requests.push({ method, path, search: url.search, body, headers })

    if (path === '/products' && method === 'GET') {
      const items = this.product ? [productSummary(this.product)] : []
      return response({ items, nextCursor: null })
    }
    if (path === '/products' && method === 'POST') {
      const payload = body ?? {}
      this.product = {
        ...productDetail('draft'),
        ...payload,
        id: productId,
        status: 'draft',
        createdAt: recordedDate,
        updatedAt: recordedDate,
        publishedAt: null,
        archivedAt: null,
        variants: [],
      } as ProductDetail
      return response(this.product)
    }

    const productAction = path.match(/^\/products\/([^/]+)\/(publish|unpublish)$/)
    if (productAction && method === 'POST' && this.product) {
      this.product = {
        ...this.product,
        status: productAction[2] === 'publish' ? 'published' : 'draft',
        publishedAt: productAction[2] === 'publish' ? recordedDate : null,
        updatedAt: recordedDate,
      }
      return new Response(null, { status: 204 })
    }

    const variantAction = path.match(/^\/products\/([^/]+)\/variants(?:\/([^/]+))?$/)
    if (variantAction && this.product && variantAction[1] === productId) {
      if (method === 'POST' && !variantAction[2]) {
        const payload = (body ?? {}) as Partial<Variant>
        const created = { ...productVariant(), ...payload, id: variantId, productId, createdAt: recordedDate, updatedAt: recordedDate } as Variant
        this.product = { ...this.product, updatedAt: recordedDate, variants: [...this.product.variants.filter((variant) => variant.id !== created.id), created] }
        return response(created)
      }
      if (method === 'PATCH' && variantAction[2]) {
        const updated = this.product.variants.map((variant) => variant.id === variantAction[2]
          ? { ...variant, ...(body as Partial<Variant>), updatedAt: recordedDate }
          : variant)
        this.product = { ...this.product, updatedAt: recordedDate, variants: updated }
        return response(updated.find((variant) => variant.id === variantAction[2]))
      }
      if (method === 'DELETE' && variantAction[2]) {
        this.product = { ...this.product, variants: this.product.variants.map((variant) => variant.id === variantAction[2]
          ? { ...variant, archivedAt: recordedAt }
          : variant) }
        return new Response(null, { status: 204 })
      }
    }

    const productMatch = path.match(/^\/products\/([^/]+)$/)
    if (productMatch && productMatch[1] === productId && this.product) {
      if (method === 'GET') return response(this.product)
      if (method === 'PATCH') {
        this.product = { ...this.product, ...(body as Partial<ProductDetail>), updatedAt: recordedDate }
        return response(this.product)
      }
      if (method === 'DELETE') {
        this.product = { ...this.product, status: 'archived', archivedAt: recordedAt }
        return new Response(null, { status: 204 })
      }
    }

    if (path === '/inventory/warehouses' && method === 'GET') {
      const warehouse: Warehouse = {
        id: warehouseId,
        code: 'MAIN',
        name: 'คลังหลัก',
        isActive: true,
        createdAt: recordedDate,
        updatedAt: recordedDate,
      }
      return response(warehouse)
    }

    if (path === '/inventory/lots' && method === 'GET') {
      const requestedVariant = url.searchParams.get('variantId')
      const lots = requestedVariant ? this.lots.filter((lot) => lot.variantId === requestedVariant) : this.lots
      return response({ items: lots, nextCursor: null })
    }
    if (path === '/inventory/lots' && method === 'POST') {
      const payload = body ?? {}
      const lot: Lot = inventoryLot({
        id: lotId,
        warehouseId: String(payload.warehouseId),
        variantId: String(payload.variantId),
        lotCode: String(payload.lotCode).trim().toUpperCase(),
        receivedAt: String(payload.receivedAt ?? recordedAt),
        expiryDate: String(payload.expiryDate),
        onHandQuantity: Number(payload.quantity),
        sellableQuantity: payload.quarantined ? 0 : Number(payload.quantity),
        quarantinedAt: payload.quarantined ? recordedAt : null,
        quarantineReason: payload.quarantined ? String(payload.quarantineReason) : null,
      })
      this.lots = [...this.lots.filter((current) => current.id !== lot.id), lot]
      this.movements.push({
        id: '00000000-0000-4000-8000-000000000050',
        lotId: lot.id,
        operationId: '00000000-0000-4000-8000-000000000051',
        quantityDelta: lot.onHandQuantity,
        balanceAfter: lot.onHandQuantity,
        type: 'receipt',
        reasonCode: 'receipt',
        occurredAt: recordedAt,
        actorId: 'staff-1',
      })
      return response(lot)
    }

    const lotMatch = path.match(/^\/inventory\/lots\/([^/]+)$/)
    if (lotMatch && method === 'GET') {
      const lot = this.lots.find((candidate) => candidate.id === lotMatch[1])
      return lot ? response(lot) : response({ code: 'LOT_NOT_FOUND', message: 'missing lot' }, 404)
    }

    if (path === '/inventory/movements' && method === 'GET') {
      const lotIdFilter = url.searchParams.get('lotId')
      const items = lotIdFilter ? this.movements.filter((movement) => movement.lotId === lotIdFilter) : this.movements
      return response({ items, nextCursor: null })
    }

    const summaryMatch = path.match(/^\/inventory\/variants\/([^/]+)\/summary$/)
    if (summaryMatch && method === 'GET') {
      return response(this.stockSummary(summaryMatch[1]!))
    }

    if (path === '/inventory/reservations' && method === 'POST') {
      const payload = body ?? {}
      const lines = Array.isArray(payload.lines) ? payload.lines as Array<{ variantId: string; quantity: number }> : []
      const allocations: Reservation['allocations'] = []
      for (const line of lines) {
        const eligibleLot = this.lots.find((lot) => lot.variantId === line.variantId
          && !lot.quarantinedAt && lot.expiryDate >= '2026-10-03'
          && lot.sellableQuantity >= line.quantity)
        if (!eligibleLot) return response({ code: 'INSUFFICIENT_STOCK', message: 'not enough stock' }, 409)
        eligibleLot.reservedQuantity += line.quantity
        eligibleLot.sellableQuantity -= line.quantity
        allocations.push({ variantId: line.variantId, lotId: eligibleLot.id, quantity: line.quantity })
      }
      const id = reservationIds[this.reservationIndex++] ?? reservationIds[reservationIds.length - 1]!
      const reservation: Reservation = {
        id,
        warehouseId: String(payload.warehouseId),
        externalReference: typeof payload.externalReference === 'string' ? payload.externalReference : null,
        status: 'active',
        createdAt: recordedAt,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        completedAt: null,
        actorId: 'staff-1',
        allocations,
      }
      this.reservations.set(id, reservation)
      return response(reservation)
    }

    const reservationCommand = path.match(/^\/inventory\/reservations\/([^/]+)(?:\/(confirm|release))?$/)
    if (reservationCommand) {
      const reservation = this.reservations.get(reservationCommand[1]!)
      if (!reservation) return response({ code: 'RESERVATION_NOT_FOUND', message: 'missing reservation' }, 404)
      if (method === 'GET' && !reservationCommand[2]) return response(reservation)
      if (method === 'POST' && reservationCommand[2]) {
        const confirming = reservationCommand[2] === 'confirm'
        for (const allocation of reservation.allocations) {
          const lot = this.lots.find((candidate) => candidate.id === allocation.lotId)
          if (!lot) continue
          lot.reservedQuantity -= allocation.quantity
          if (confirming) lot.onHandQuantity -= allocation.quantity
          lot.sellableQuantity = Math.max(0, lot.onHandQuantity - lot.reservedQuantity)
          lot.updatedAt = recordedAt
          if (confirming) this.movements.push({
            id: `00000000-0000-4000-8000-${String(52 + this.movements.length).padStart(12, '0')}`,
            lotId: lot.id,
            operationId: `00000000-0000-4000-8000-${String(70 + this.movements.length).padStart(12, '0')}`,
            quantityDelta: -allocation.quantity,
            balanceAfter: lot.onHandQuantity,
            type: 'reservation_confirm',
            reasonCode: 'reservation_confirm',
            occurredAt: recordedAt,
            actorId: 'staff-1',
          })
        }
        const updated = { ...reservation, status: confirming ? 'confirmed' as const : 'released' as const, completedAt: recordedAt }
        this.reservations.set(updated.id, updated)
        return response(updated)
      }
    }

    const countAdjustment = path.match(/^\/inventory\/lots\/([^/]+)\/count-adjustments$/)
    if (countAdjustment && method === 'POST') {
      const lot = this.lots.find((candidate) => candidate.id === countAdjustment[1])
      if (!lot) return response({ code: 'LOT_NOT_FOUND', message: 'missing lot' }, 404)
      lot.onHandQuantity = Number(body?.countedQuantity)
      lot.sellableQuantity = Math.max(0, lot.onHandQuantity - lot.reservedQuantity)
      lot.updatedAt = recordedAt
      return response(lot)
    }

    return response({ code: 'NOT_FOUND', message: `unhandled ${method} ${path}` }, 404)
  }

  count(method: string, path: string): number {
    return this.requests.filter((request) => request.method === method && request.path === path).length
  }

  private stockSummary(forVariantId: string): StockSummary {
    const lots = this.lots.filter((lot) => lot.variantId === forVariantId)
    const eligible = lots.filter((lot) => !lot.quarantinedAt && lot.expiryDate >= '2026-10-03')
    return {
      variantId: forVariantId,
      warehouseId,
      onHandQuantity: lots.reduce((sum, lot) => sum + lot.onHandQuantity, 0),
      reservedQuantity: lots.reduce((sum, lot) => sum + lot.reservedQuantity, 0),
      eligibleQuantity: eligible.reduce((sum, lot) => sum + lot.onHandQuantity, 0),
      sellableQuantity: eligible.reduce((sum, lot) => sum + lot.sellableQuantity, 0),
    }
  }
}

const activeSpies: Array<{ mockRestore: () => void }> = []

function staffSession(permissions: string[]): AuthSession {
  return {
    session: { id: 'session-1', expiresAt: '2026-10-03T08:00:00.000Z' },
    user: { id: 'staff-1', name: 'เจ้าหน้าที่', email: 'staff@example.com', emailVerified: true, image: null, accountType: 'staff' },
    staff: { role: permissions.includes('catalog:create') ? 'owner' : 'fulfillment', permissions },
  }
}

function applicationRoutes() {
  return [
    {
      path: '/products',
      element: <PermissionGate permission="catalog:read" />,
      children: [
        { index: true, element: <ProductsPage /> },
        { path: 'new', element: <PermissionGate permission="catalog:create" />, children: [{ index: true, element: <ProductCreatePage /> }] },
        { path: ':productId', element: <ProductDetailPage /> },
      ],
    },
    {
      path: '/inventory',
      element: <PermissionGate permission="inventory:read" />,
      children: [
        { index: true, element: <InventoryPage /> },
        { path: 'lots/new', element: <ReceiveLotPage /> },
        { path: 'variants/:variantId', element: <VariantStockPage /> },
        { path: 'lots/:lotId', element: <LotDetailPage /> },
        { path: 'reservations', element: <ReservationLookupPage /> },
        { path: 'reservations/new', element: <ReservationCreatePage /> },
        { path: 'reservations/:reservationId', element: <ReservationDetailPage /> },
      ],
    },
  ]
}

function renderApplication(path: string, permissions: string[], boundary: CatalogInventoryBoundary) {
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((input, init) => boundary.fetch(input, init))
  activeSpies.push(fetchSpy)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 60_000 }, mutations: { retry: false } },
  })
  queryClient.setQueryData(authSessionQuery.queryKey, staffSession(permissions), { updatedAt: Date.now() + 10_000 })
  const router = createMemoryRouter(applicationRoutes(), { initialEntries: [path] })
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
  return { queryClient, router }
}

async function chooseVariant(user: ReturnType<typeof userEvent.setup>) {
  const search = await screen.findByRole('searchbox', { name: 'ค้นหาสินค้าเพื่อเลือกสต็อก' })
  await user.type(search, 'มะม่วง')
  await new Promise((resolve) => setTimeout(resolve, 320))
  await user.click(await screen.findByRole('button', { name: /มะม่วงทดสอบ.*mango-demo/ }))
  await user.click(await screen.findByRole('button', { name: /MANGO-1KG.*ขนาด 1 กิโลกรัม/ }))
}

async function createReservation(user: ReturnType<typeof userEvent.setup>, reference: string) {
  await user.click(await screen.findByRole('link', { name: 'สร้างการจอง' }))
  await chooseVariant(user)
  await user.click(screen.getByRole('button', { name: 'เพิ่มรูปแบบที่เลือก' }))
  await user.type(screen.getByRole('textbox', { name: 'รหัสอ้างอิงภายนอก (ไม่บังคับ)' }), reference)
  await user.click(screen.getByRole('button', { name: 'สร้างการจอง' }))
  await screen.findByRole('heading', { name: 'รายละเอียดการจอง' })
}

afterEach(() => {
  cleanup()
  activeSpies.splice(0).forEach((spy) => spy.mockRestore())
})

test('owner completes catalog, stock, release, and confirmation workflows through the HTTP boundary', async () => {
  const boundary = new CatalogInventoryBoundary()
  const user = userEvent.setup()
  const { router } = renderApplication('/products', ownerPermissions, boundary)

  await screen.findByRole('heading', { name: 'สินค้า' })
  await user.click(await screen.findByRole('link', { name: 'เพิ่มสินค้า' }))
  await user.type(await screen.findByRole('textbox', { name: 'ชื่อ URL สินค้า' }), 'mango-demo')
  await user.type(screen.getByRole('textbox', { name: 'ชื่อสินค้า' }), 'มะม่วงทดสอบ')
  await user.type(screen.getByRole('textbox', { name: 'คำอธิบาย' }), 'มะม่วงน้ำดอกไม้สำหรับตรวจสอบขั้นตอนจัดการสินค้า')
  await user.type(screen.getByRole('textbox', { name: 'URL รูปสินค้า HTTPS' }), 'https://assets.example.test/mango.jpg')
  await user.type(screen.getByRole('textbox', { name: 'คำอธิบายรูปภาพ' }), 'มะม่วงน้ำดอกไม้')
  await user.click(screen.getByRole('button', { name: 'สร้างสินค้า' }))
  await screen.findByRole('heading', { name: 'มะม่วงทดสอบ' })
  expect(boundary.count('POST', '/products')).toBe(1)

  let detailReads = boundary.count('GET', `/products/${productId}`)
  await user.click(screen.getByRole('button', { name: 'แก้ไขสินค้า' }))
  const productName = screen.getByRole('textbox', { name: 'ชื่อสินค้า' })
  await user.clear(productName)
  await user.type(productName, 'มะม่วงทดสอบชุดใหม่')
  await user.click(screen.getByRole('button', { name: 'บันทึกสินค้า' }))
  await waitFor(() => {
    expect(boundary.product?.name).toBe('มะม่วงทดสอบชุดใหม่')
    expect(boundary.count('GET', `/products/${productId}`)).toBeGreaterThan(detailReads)
  })
  expect(boundary.count('PATCH', `/products/${productId}`)).toBe(1)

  detailReads = boundary.count('GET', `/products/${productId}`)
  await user.click(screen.getByRole('button', { name: 'เพิ่มรูปแบบสินค้า' }))
  await user.type(await screen.findByRole('textbox', { name: 'SKU' }), 'MANGO-1KG')
  await user.type(screen.getByRole('textbox', { name: 'ชื่อรูปแบบ' }), 'ขนาด 1 กิโลกรัม')
  await user.type(screen.getByRole('textbox', { name: 'หน่วย' }), 'กิโลกรัม')
  await user.type(screen.getByRole('textbox', { name: 'ราคา (บาท)' }), '189.00')
  await user.click(screen.getByRole('button', { name: 'บันทึกรูปแบบสินค้า' }))
  await waitFor(() => {
    expect(boundary.product?.variants).toHaveLength(1)
    expect(boundary.count('GET', `/products/${productId}`)).toBeGreaterThan(detailReads)
  })

  detailReads = boundary.count('GET', `/products/${productId}`)
  await user.click(screen.getByRole('button', { name: 'แก้ไขรูปแบบ MANGO-1KG' }))
  const variantPrice = await screen.findByRole('textbox', { name: 'ราคา (บาท)' })
  await user.clear(variantPrice)
  await user.type(variantPrice, '205.25')
  await user.click(screen.getByRole('button', { name: 'บันทึกรูปแบบสินค้า' }))
  await waitFor(() => {
    expect(boundary.product?.variants[0]?.priceSatang).toBe(20_525)
    expect(boundary.count('GET', `/products/${productId}`)).toBeGreaterThan(detailReads)
  })
  expect(boundary.requests.find((request) => request.method === 'PATCH' && request.path.endsWith(`/variants/${variantId}`))?.body).toMatchObject({ priceSatang: 20_525 })

  detailReads = boundary.count('GET', `/products/${productId}`)
  await user.click(screen.getByRole('button', { name: 'เผยแพร่สินค้า' }))
  await user.click(await screen.findByRole('button', { name: 'ยืนยันเผยแพร่สินค้า', exact: true }))
  await waitFor(() => {
    expect(boundary.product?.status).toBe('published')
    expect(boundary.count('GET', `/products/${productId}`)).toBeGreaterThan(detailReads)
  })
  expect(boundary.count('POST', `/products/${productId}/publish`)).toBe(1)

  await user.click(screen.getByRole('link', { name: 'ดูสต็อก MANGO-1KG' }))
  await screen.findByRole('heading', { name: 'สต็อกรูปแบบสินค้า' })
  expect(boundary.count('GET', `/inventory/variants/${variantId}/summary`)).toBe(1)
  await user.click(screen.getByRole('link', { name: 'รายการล็อต' }))
  await user.click(await screen.findByRole('link', { name: 'รับสินค้าเข้าคลัง' }))
  await chooseVariant(user)
  await user.type(screen.getByRole('textbox', { name: 'รหัสล็อต' }), 'MANGO-DEMO-LOT-1')
  const quantity = screen.getByRole('spinbutton', { name: 'จำนวนที่รับเข้า' })
  await user.clear(quantity)
  await user.type(quantity, '20')
  fireEvent.change(screen.getByLabelText('วันหมดอายุ'), { target: { value: '2027-12-31' } })
  await user.click(screen.getByRole('button', { name: 'ยืนยันรับสินค้าเข้าคลัง' }))
  await waitFor(() => expect(boundary.count('POST', '/inventory/lots')).toBe(1))
  await waitFor(() => expect(router.state.location.pathname).toBe(`/inventory/lots/${lotId}`), {
    onTimeout: (error) => new Error(`${error.message}\n${JSON.stringify({
      request: boundary.requests.find((request) => request.method === 'POST' && request.path === '/inventory/lots'),
      alerts: screen.queryAllByRole('alert').map((element) => element.textContent),
      headings: screen.queryAllByRole('heading').map((element) => element.textContent),
    })}`),
  })
  await screen.findByRole('heading', { name: 'ล็อต MANGO-DEMO-LOT-1' })
  const receipt = boundary.requests.find((request) => request.method === 'POST' && request.path === '/inventory/lots')
  expect(receipt?.body).toMatchObject({ lotCode: 'MANGO-DEMO-LOT-1', quantity: 20, variantId })
  expect(receipt?.headers.get('idempotency-key')).toBeTruthy()

  await user.click(screen.getByRole('link', { name: 'สต็อกรูปแบบสินค้า' }))
  const stockSummary = await screen.findByLabelText('สรุปสต็อก')
  expect([...stockSummary.querySelectorAll('dd')].map((value) => value.textContent)).toEqual(['20', '0', '20', '20'])
  expect(boundary.count('GET', `/inventory/variants/${variantId}/summary`)).toBeGreaterThan(1)
  await user.click(screen.getByRole('link', { name: 'การจองสินค้า' }))

  await createReservation(user, 'RELEASE-FLOW-1')
  const releaseId = reservationIds[0]!
  const releaseReadCount = boundary.count('GET', `/inventory/reservations/${releaseId}`)
  await user.click(screen.getByRole('button', { name: 'ปล่อยการจอง' }))
  await screen.findByRole('heading', { name: 'ปล่อยการจองนี้?' })
  await user.click(screen.getByRole('button', { name: 'ยืนยันปล่อยการจอง' }))
  await screen.findByText('ปล่อยการจองแล้ว')
  await waitFor(() => expect(boundary.count('GET', `/inventory/reservations/${releaseId}`)).toBeGreaterThan(releaseReadCount))
  expect(boundary.requests.find((request) => request.method === 'POST' && request.path.endsWith(`/${releaseId}/release`))?.headers.get('idempotency-key')).toBeTruthy()

  await user.click(screen.getByRole('link', { name: 'กลับไปค้นหาการจอง' }))
  await createReservation(user, 'CONFIRM-FLOW-1')
  const confirmId = reservationIds[1]!
  const confirmReadCount = boundary.count('GET', `/inventory/reservations/${confirmId}`)
  await user.click(screen.getByRole('button', { name: 'ยืนยันและตัดสต็อก' }))
  await screen.findByRole('heading', { name: 'ยืนยันการใช้สต็อกที่จองไว้?' })
  await user.click(screen.getByRole('button', { name: 'ยืนยันการตัดสต็อก' }))
  await screen.findByText('ยืนยันแล้ว')
  await waitFor(() => expect(boundary.count('GET', `/inventory/reservations/${confirmId}`)).toBeGreaterThan(confirmReadCount))
  expect(boundary.requests.find((request) => request.method === 'POST' && request.path.endsWith(`/${confirmId}/confirm`))?.headers.get('idempotency-key')).toBeTruthy()
  expect(boundary.lots[0]?.onHandQuantity).toBe(19)
})

test('fulfillment reads catalog and adjusts stock without sending any product writes', async () => {
  const boundary = new CatalogInventoryBoundary(productDetail('published'), [inventoryLot()])
  const user = userEvent.setup()
  const { router } = renderApplication('/products', fulfillmentPermissions, boundary)

  await user.click(await screen.findByRole('link', { name: 'มะม่วงทดสอบ' }))
  await screen.findByRole('heading', { name: 'มะม่วงทดสอบ' })
  expect(screen.queryByRole('button', { name: 'แก้ไขสินค้า' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'เพิ่มรูปแบบสินค้า' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'นำสินค้าออกจากการเผยแพร่' })).toBeNull()
  await user.click(screen.getByRole('link', { name: 'ดูสต็อก MANGO-1KG' }))
  await screen.findByRole('heading', { name: 'สต็อกรูปแบบสินค้า' })
  await user.click(screen.getByRole('link', { name: 'รายการล็อต' }))
  await user.click(await screen.findByRole('link', { name: 'FULFILLMENT-LOT-1' }))
  await screen.findByRole('heading', { name: 'ล็อต FULFILLMENT-LOT-1' })
  await user.click(screen.getByRole('button', { name: 'ปรับยอดนับ' }))
  await user.clear(await screen.findByRole('spinbutton', { name: 'จำนวนที่นับได้จริง' }))
  await user.type(screen.getByRole('spinbutton', { name: 'จำนวนที่นับได้จริง' }), '7')
  await user.type(screen.getByRole('textbox', { name: 'รหัสเหตุผล' }), 'cycle_count')
  await user.click(screen.getByRole('button', { name: 'ยืนยันปรับยอด' }))
  await waitFor(() => expect(boundary.lots[0]?.onHandQuantity).toBe(7))
  expect(boundary.count('POST', `/inventory/lots/${lotId}/count-adjustments`)).toBe(1)

  await router.navigate('/products/new')
  expect(await screen.findByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึง' })).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: 'ชื่อสินค้า' })).toBeNull()
  expect(boundary.requests.filter((request) => request.path.startsWith('/products') && ['POST', 'PATCH', 'DELETE'].includes(request.method))).toEqual([])
})
