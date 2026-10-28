import { afterEach, beforeEach, expect, test } from 'bun:test'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { authSessionQuery, type AuthSession } from '../src/lib/auth-session'
import { bangkokIsoToInput } from '../src/lib/discounts/schema'
import { Component as DiscountEditorPage } from '../src/pages/marketing/discounts/discount-editor-page'
import { Component as DiscountsPage } from '../src/pages/marketing/discounts/discounts-page'
import { OrderDetailSummary } from '../src/pages/orders/_components/order-detail-summary'
import type { OrderDetail } from '../src/lib/orders/api'

const sessionFor = (permissions: string[]): AuthSession => ({
  session: { id: 'session-1', expiresAt: '2026-10-30T00:00:00.000Z' },
  user: { id: 'staff-1', name: 'เจ้าหน้าที่', email: 'staff@example.com', emailVerified: true, image: null, accountType: 'staff' },
  staff: { role: 'admin', permissions },
})

function queryClientFor(permissions: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  queryClient.setQueryData(authSessionQuery.queryKey, sessionFor(permissions), { updatedAt: Date.now() + 60_000 })
  return queryClient
}

const base = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'SUMMER10',
  name: 'ลดหน้าร้อน',
  kind: 'percent',
  percentOff: 10,
  amountOffSatang: null,
  maxDiscountSatang: 20000,
  minSubtotalSatang: 50000,
  minQuantity: null,
  eligibleCategories: [],
  eligibleProductIds: [],
  startsAt: '2026-10-01T00:00:00.000Z',
  endsAt: null,
  usageLimit: 100,
  perCustomerLimit: null,
  allowedEmails: [],
  firstOrderOnly: false,
  active: true,
  version: 3,
  createdAt: '2026-09-30T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  status: 'active',
  uses: 4,
  locked: true,
  revenueSatang: 480000,
  discountGivenSatang: 32000,
}
const fixed = { ...base, id: '22222222-2222-4222-8222-222222222222', code: 'MINUS100', name: 'ลดร้อย', kind: 'fixed', percentOff: null, amountOffSatang: 10000, maxDiscountSatang: null, usageLimit: null, uses: 0, locked: false, revenueSatang: 0, discountGivenSatang: 0, status: 'paused', active: false }
const shipping = { ...base, id: '33333333-3333-4333-8333-333333333333', code: 'FREESHIP', name: 'โปรส่งฟรี', kind: 'free_shipping', percentOff: null, maxDiscountSatang: null, uses: 7, revenueSatang: 0, discountGivenSatang: 0, status: 'expired' }
const detail = (discount: typeof base) => ({
  ...discount,
  recentOrders: [{ id: 'order-1', orderNumber: 'SN-1001', createdAt: '2026-10-05T03:00:00.000Z', totalSatang: 90000, discountSatang: 10000 }],
})
const products = {
  items: [
    { id: '44444444-4444-4444-8444-444444444444', name: 'ทุเรียนหมอนทอง', status: 'published', category: 'fresh' },
    { id: '55555555-5555-4555-8555-555555555555', name: 'มังคุดเก่า', status: 'archived', category: 'fresh' },
  ],
  nextCursor: null,
}

interface Call { method: string; path: string; body: unknown; contentType: string | null }
let calls: Call[] = []
let routes: Record<string, () => Response> = {}
const previousFetch = globalThis.fetch

beforeEach(() => {
  calls = []
  routes = {
    'GET /api/v1/admin/discounts': () => Response.json({ items: [base, fixed, shipping] }),
    [`GET /api/v1/admin/discounts/${base.id}`]: () => Response.json(detail(base)),
    [`GET /api/v1/admin/discounts/${fixed.id}`]: () => Response.json(detail(fixed)),
    'GET /api/v1/admin/products': () => Response.json(products),
  }
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null
    const url = new URL(request ? request.url : String(input), 'http://localhost')
    const method = (request?.method ?? init?.method ?? 'GET').toUpperCase()
    const raw = request ? await request.clone().text() : init?.body
    const headers = new Headers(request?.headers ?? init?.headers)
    calls.push({ method, path: url.pathname, body: typeof raw === 'string' && raw ? JSON.parse(raw) : undefined, contentType: headers.get('content-type') })
    const handler = routes[`${method} ${url.pathname}`]
    return handler ? handler() : Response.json({ code: 'NOT_FOUND', message: 'x' }, { status: 404 })
  }) as typeof fetch
})

afterEach(() => {
  cleanup()
  globalThis.fetch = previousFetch
})

const writer = ['marketing:read', 'marketing:update']

function renderAt(entry: string, permissions = writer) {
  const router = createMemoryRouter([
    { path: '/marketing/discounts', element: <DiscountsPage /> },
    { path: '/marketing/discounts/new', element: <DiscountEditorPage /> },
    { path: '/marketing/discounts/:discountId', element: <DiscountEditorPage /> },
    { path: '/orders/:orderId', element: <p>order page</p> },
  ], { initialEntries: [entry] })
  render(<QueryClientProvider client={queryClientFor(permissions)}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}

test('list shows each code with its value text, status, uses, revenue and discount given', async () => {
  renderAt('/marketing/discounts')

  expect(await screen.findByText('SUMMER10')).toBeTruthy()
  const table = screen.getByRole('table')
  expect(within(table).getByText('ลด 10% (สูงสุด ฿200)')).toBeTruthy()
  expect(within(table).getByText('ลด ฿100')).toBeTruthy()
  expect(within(table).getByText('ส่งฟรี')).toBeTruthy()
  expect(within(table).getByText('ใช้งานอยู่')).toBeTruthy()
  expect(within(table).getByText('หยุดชั่วคราว')).toBeTruthy()
  expect(within(table).getByText('4 / 100')).toBeTruthy()
  expect(within(table).getByText('฿4,800.00')).toBeTruthy()
  expect(within(table).getByText('฿320.00')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'สร้างโค้ด' })).toBeTruthy()
})

test('status filter narrows the rows', async () => {
  const user = userEvent.setup()
  renderAt('/marketing/discounts')
  expect(await screen.findByText('MINUS100')).toBeTruthy()

  await user.click(screen.getByRole('combobox', { name: 'กรองตามสถานะ' }))
  await user.click(await screen.findByRole('option', { name: 'หยุดชั่วคราว' }))

  expect(screen.getByText('MINUS100')).toBeTruthy()
  expect(screen.queryByText('SUMMER10')).toBeNull()
})

test('read-only staff do not see the create button', async () => {
  renderAt('/marketing/discounts', ['marketing:read'])
  expect(await screen.findByText('SUMMER10')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'สร้างโค้ด' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'สร้างโค้ด' })).toBeNull()
})

test('create sends satang values, an upper-cased code and nulls for empty limits', async () => {
  routes['POST /api/v1/admin/discounts'] = () => Response.json(detail(base), { status: 201 })
  const user = userEvent.setup()
  renderAt('/marketing/discounts/new')

  await user.type(await screen.findByLabelText('รหัสโค้ด'), 'summer10')
  await user.type(screen.getByLabelText('ชื่อโค้ด'), 'ลดหน้าร้อน')
  await user.type(screen.getByLabelText('ลดกี่เปอร์เซ็นต์'), '10')
  await user.type(screen.getByLabelText('ลดสูงสุด (บาท)'), '200')
  await user.type(screen.getByLabelText('ยอดซื้อขั้นต่ำ (บาท)'), '500.50')
  await user.type(screen.getByLabelText('เริ่มใช้ได้ (เวลาไทย)'), '2026-10-01T08:00')
  await user.click(screen.getByRole('button', { name: 'บันทึกโค้ด' }))

  await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true))
  expect(calls.find((call) => call.method === 'POST')!.body).toEqual({
    code: 'SUMMER10',
    name: 'ลดหน้าร้อน',
    kind: 'percent',
    percentOff: 10,
    amountOffSatang: null,
    maxDiscountSatang: 20000,
    minSubtotalSatang: 50050,
    minQuantity: null,
    eligibleCategories: [],
    eligibleProductIds: [],
    startsAt: '2026-10-01T01:00:00.000Z',
    endsAt: null,
    usageLimit: null,
    perCustomerLimit: null,
    allowedEmails: [],
    firstOrderOnly: false,
    active: true,
  })
})

test('the random button fills a 10 character code from A-Z and 2-9', async () => {
  const user = userEvent.setup()
  renderAt('/marketing/discounts/new')

  await user.click(await screen.findByRole('button', { name: 'สุ่มโค้ด' }))

  expect((screen.getByLabelText('รหัสโค้ด') as HTMLInputElement).value).toMatch(/^[A-Z2-9]{10}$/)
})

test('the end time must be after the start time', async () => {
  const user = userEvent.setup()
  renderAt('/marketing/discounts/new')

  await user.type(await screen.findByLabelText('รหัสโค้ด'), 'LATE')
  await user.type(screen.getByLabelText('ชื่อโค้ด'), 'ทดสอบ')
  await user.type(screen.getByLabelText('ลดกี่เปอร์เซ็นต์'), '5')
  await user.type(screen.getByLabelText('เริ่มใช้ได้ (เวลาไทย)'), '2026-10-02T08:00')
  await user.type(screen.getByLabelText('หมดอายุ (เวลาไทย)'), '2026-10-01T08:00')
  await user.click(screen.getByRole('button', { name: 'บันทึกโค้ด' }))

  expect(await screen.findByText('เวลาสิ้นสุดต้องหลังเวลาเริ่ม')).toBeTruthy()
  expect(calls.some((call) => call.method === 'POST')).toBe(false)
})

test('code and type are disabled once an order references the code, and delete is hidden', async () => {
  renderAt(`/marketing/discounts/${base.id}`)

  const code = (await screen.findByLabelText('รหัสโค้ด')) as HTMLInputElement
  await waitFor(() => expect(code.value).toBe('SUMMER10'))
  expect(code.disabled).toBe(true)
  expect((screen.getByRole('radio', { name: 'ลดเป็นเปอร์เซ็นต์' }) as HTMLInputElement).disabled).toBe(true)
  expect(screen.getByText(/เปลี่ยนรหัสโค้ดไม่ได้/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'ลบโค้ด' })).toBeNull()
  expect(screen.getByRole('link', { name: 'SN-1001' }).getAttribute('href')).toBe('/orders/order-1')
})

test('an unreferenced code stays editable and can be deleted with a JSON body', async () => {
  routes[`DELETE /api/v1/admin/discounts/${fixed.id}`] = () => new Response(null, { status: 204 })
  const user = userEvent.setup()
  const router = renderAt(`/marketing/discounts/${fixed.id}`)

  const code = (await screen.findByLabelText('รหัสโค้ด')) as HTMLInputElement
  await waitFor(() => expect(code.value).toBe('MINUS100'))
  expect(code.disabled).toBe(false)

  await user.click(screen.getByRole('button', { name: 'ลบโค้ด' }))
  await user.click(await screen.findByRole('button', { name: 'ยืนยันลบโค้ด' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/marketing/discounts'))
  const call = calls.find((c) => c.method === 'DELETE')!
  expect(call.contentType).toContain('application/json')
})

test('saving sends the loaded version and shows a Thai message on a version conflict', async () => {
  routes[`PUT /api/v1/admin/discounts/${base.id}`] = () => Response.json({ code: 'DISCOUNT_VERSION_CONFLICT', message: 'x' }, { status: 409 })
  const user = userEvent.setup()
  renderAt(`/marketing/discounts/${base.id}`)

  const name = (await screen.findByLabelText('ชื่อโค้ด')) as HTMLInputElement
  await waitFor(() => expect(name.value).toBe('ลดหน้าร้อน'))
  await user.clear(name)
  await user.type(name, 'ลดใหม่')
  await user.click(screen.getByRole('button', { name: 'บันทึกโค้ด' }))

  expect(await screen.findByText('มีคนแก้ไขโค้ดนี้ไปก่อนแล้ว กรุณาโหลดใหม่')).toBeTruthy()
  const body = calls.find((call) => call.method === 'PUT')!.body as Record<string, unknown>
  expect(body.version).toBe(3)
  expect(body.name).toBe('ลดใหม่')
  expect(body.code).toBe('SUMMER10')
  expect(body.kind).toBe('percent')
  expect(body.percentOff).toBe(10)
  expect(body.maxDiscountSatang).toBe(20000)
  expect(body.startsAt).toBe('2026-10-01T00:00:00.000Z')
})

test('products eligibility lists only non-archived products', async () => {
  const user = userEvent.setup()
  renderAt('/marketing/discounts/new')

  await user.click(await screen.findByRole('radio', { name: 'เลือกเฉพาะ' }))

  expect(await screen.findByRole('checkbox', { name: 'ทุเรียนหมอนทอง' })).toBeTruthy()
  expect(screen.queryByRole('checkbox', { name: 'มังคุดเก่า' })).toBeNull()
})

test('a code with both categories and products round-trips through open and save unchanged', async () => {
  const mixed = { ...base, eligibleCategories: ['fresh'], eligibleProductIds: ['44444444-4444-4444-8444-444444444444'] }
  routes[`GET /api/v1/admin/discounts/${base.id}`] = () => Response.json(detail(mixed))
  routes[`PUT /api/v1/admin/discounts/${base.id}`] = () => Response.json(detail(mixed))
  const user = userEvent.setup()
  renderAt(`/marketing/discounts/${base.id}`)

  const name = (await screen.findByLabelText('ชื่อโค้ด')) as HTMLInputElement
  await waitFor(() => expect(name.value).toBe('ลดหน้าร้อน'))
  expect((screen.getByRole('radio', { name: 'เลือกเฉพาะ' }) as HTMLInputElement).checked).toBe(true)
  await user.click(screen.getByRole('button', { name: 'บันทึกโค้ด' }))

  await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true))
  const body = calls.find((call) => call.method === 'PUT')!.body as Record<string, unknown>
  expect(body.eligibleCategories).toEqual(['fresh'])
  expect(body.eligibleProductIds).toEqual(['44444444-4444-4444-8444-444444444444'])
})

test('a categories-only code submits its categories and no products', async () => {
  const only = { ...base, eligibleCategories: ['fresh'], eligibleProductIds: [] }
  routes[`GET /api/v1/admin/discounts/${base.id}`] = () => Response.json(detail(only))
  routes[`PUT /api/v1/admin/discounts/${base.id}`] = () => Response.json(detail(only))
  const user = userEvent.setup()
  renderAt(`/marketing/discounts/${base.id}`)

  const name = (await screen.findByLabelText('ชื่อโค้ด')) as HTMLInputElement
  await waitFor(() => expect(name.value).toBe('ลดหน้าร้อน'))
  await user.click(screen.getByRole('button', { name: 'บันทึกโค้ด' }))

  await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true))
  const body = calls.find((call) => call.method === 'PUT')!.body as Record<string, unknown>
  expect(body.eligibleCategories).toEqual(['fresh'])
  expect(body.eligibleProductIds).toEqual([])
})

test('selecting specific products requires a category or a product', async () => {
  const user = userEvent.setup()
  renderAt('/marketing/discounts/new')

  await user.type(await screen.findByLabelText('รหัสโค้ด'), 'PICK')
  await user.type(screen.getByLabelText('ชื่อโค้ด'), 'ทดสอบ')
  await user.type(screen.getByLabelText('ลดกี่เปอร์เซ็นต์'), '5')
  await user.click(screen.getByRole('radio', { name: 'เลือกเฉพาะ' }))
  await user.click(screen.getByRole('button', { name: 'บันทึกโค้ด' }))

  expect(await screen.findByText('เลือกอย่างน้อยหนึ่งหมวดหมู่หรือหนึ่งสินค้า')).toBeTruthy()
  expect(calls.some((call) => call.method === 'POST')).toBe(false)
})

test('a taken code shows its message once, on the code field only', async () => {
  routes['POST /api/v1/admin/discounts'] = () => Response.json({ code: 'DISCOUNT_CODE_TAKEN', message: 'x' }, { status: 409 })
  const user = userEvent.setup()
  renderAt('/marketing/discounts/new')

  await user.type(await screen.findByLabelText('รหัสโค้ด'), 'DUP')
  await user.type(screen.getByLabelText('ชื่อโค้ด'), 'ซ้ำ')
  await user.type(screen.getByLabelText('ลดกี่เปอร์เซ็นต์'), '5')
  await user.click(screen.getByRole('button', { name: 'บันทึกโค้ด' }))

  await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true))
  await waitFor(() => expect(document.getElementById('discount-code-error')?.textContent ?? '').not.toBe(''))
  const message = document.getElementById('discount-code-error')!.textContent!
  expect(screen.getAllByText(message)).toHaveLength(1)
  // The code field error is the only alert. queryByRole took over a minute here (computed
  // styles for every node) and treated that field error as hidden, so query the DOM directly.
  const alerts = Array.from(document.querySelectorAll('[role="alert"]'))
  expect(alerts.map((alert) => alert.id)).toEqual(['discount-code-error'])
})

test('bangkokIsoToInput renders UTC instants as Bangkok wall time', () => {
  expect(bangkokIsoToInput('2026-10-01T01:00:00.000Z')).toBe('2026-10-01T08:00')
  expect(bangkokIsoToInput(null)).toBe('')
})

test('order detail shows the discount rows and a gross shipping line', () => {
  const order = {
    id: 'o1', orderNumber: 'SN-200', status: 'placed', customerId: null, contactEmail: 'c@example.test', contactPhone: '0800000000', recipientName: 'A',
    addressLine1: '1', addressLine2: null, subdistrict: 's', district: 'd', province: 'p', postalCode: '10000',
    subtotalSatang: 100000, shippingSatang: 0, totalSatang: 90000, currency: 'THB', paymentMethod: 'cod', createdAt: '2026-10-01T00:00:00Z',
    items: [{ id: 'i1', productName: 'ทุเรียน', variantName: '1 กก.', sku: 'D1', unit: 'กก.', unitPriceSatang: 100000, quantity: 1, lineTotalSatang: 100000, discountSatang: 10000 }],
    discount: { code: 'SUMMER10', kind: 'percent', itemDiscountSatang: 10000, shippingDiscountSatang: 5000 },
    payment: { id: 'p', method: 'cod', provider: 'cod', amountSatang: 90000, currency: 'THB', status: 'awaiting_collection' },
  } as unknown as OrderDetail
  render(<OrderDetailSummary order={order} />)

  expect(screen.getByText('ส่วนลด (SUMMER10)')).toBeTruthy()
  expect(screen.getByText('-฿100.00')).toBeTruthy()
  expect(screen.getByText('ส่วนลดค่าจัดส่ง (SUMMER10)')).toBeTruthy()
  expect(screen.getByText('-฿50.00')).toBeTruthy()
})

test('order detail without a discount shows no discount rows', () => {
  const order = {
    id: 'o1', orderNumber: 'SN-201', status: 'placed', customerId: null, contactEmail: 'c@example.test', contactPhone: '0800000000', recipientName: 'A',
    addressLine1: '1', addressLine2: null, subdistrict: 's', district: 'd', province: 'p', postalCode: '10000',
    subtotalSatang: 100000, shippingSatang: 0, totalSatang: 100000, currency: 'THB', paymentMethod: 'cod', createdAt: '2026-10-01T00:00:00Z', items: [],
    payment: { id: 'p', method: 'cod', provider: 'cod', amountSatang: 100000, currency: 'THB', status: 'awaiting_collection' },
  } as unknown as OrderDetail
  render(<OrderDetailSummary order={order} />)
  expect(screen.queryByText(/^ส่วนลด/)).toBeNull()
})
