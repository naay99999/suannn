import { afterEach, expect, jest, mock, spyOn, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { authSessionQuery, type AuthSession } from '../src/lib/auth-session'
import { ApiRequestError } from '../src/lib/api-result'
import { catalogApi, type ProductDetail } from '../src/lib/catalog/api'
import { inventoryApi, type Reservation, type Warehouse } from '../src/lib/inventory/api'
import { inventoryKeys, reservationQuery, scheduleReservationExpiry } from '../src/lib/inventory/queries'

const lookupPage = await import('../src/pages/inventory/reservation-lookup-page').catch(() => null)
const createPage = await import('../src/pages/inventory/reservation-create-page').catch(() => null)
const detailPage = await import('../src/pages/inventory/reservation-detail-page').catch(() => null)

const warehouseId = '00000000-0000-4000-8000-000000000001'
const productId = '00000000-0000-4000-8000-000000000010'
const variantId = '00000000-0000-4000-8000-000000000020'
const otherVariantId = '00000000-0000-4000-8000-000000000021'
const lotId = '00000000-0000-4000-8000-000000000030'
const reservationId = '00000000-0000-4000-8000-000000000040'
const otherReservationId = '00000000-0000-4000-8000-000000000041'
const now = new Date()

const session: AuthSession = {
  session: { id: 'session-1', expiresAt: '2026-10-03T00:00:00.000Z' },
  user: { id: 'staff-1', name: 'เจ้าหน้าที่', email: 'staff@example.com', emailVerified: true, image: null, accountType: 'staff' },
  staff: { role: 'owner', permissions: ['inventory:read', 'inventory:adjust', 'catalog:read'] },
}
const warehouse: Warehouse = {
  id: warehouseId,
  code: 'MAIN',
  name: 'คลังหลัก',
  isActive: true,
  createdAt: now,
  updatedAt: now,
}
const product: ProductDetail = {
  id: productId,
  slug: 'nam-dok-mai',
  name: 'มะม่วงน้ำดอกไม้',
  englishName: null,
  category: 'fresh',
  imageUrl: null,
  imageAlt: null,
  status: 'published',
  createdAt: now,
  updatedAt: now,
  publishedAt: now,
  archivedAt: null,
  description: null,
  originStory: null,
  storageInstructions: null,
  variants: [
    {
      id: variantId,
      productId,
      sku: 'MANGO-1KG',
      name: 'ขนาด 1 กิโลกรัม',
      unit: 'กิโลกรัม',
      priceSatang: 10000,
      salesEnabled: true,
      displayOrder: 0,
      minRemainingShelfLifeDays: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    },
    {
      id: otherVariantId,
      productId,
      sku: 'MANGO-500G',
      name: 'ขนาด 500 กรัม',
      unit: 'ถุง',
      priceSatang: 5000,
      salesEnabled: true,
      displayOrder: 1,
      minRemainingShelfLifeDays: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    },
  ],
}
const reservation: Reservation = {
  id: reservationId,
  warehouseId,
  externalReference: 'ORDER-42',
  status: 'active',
  createdAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + 60_000).toISOString(),
  completedAt: null,
  actorId: 'staff-1',
  allocations: [{ variantId, lotId, quantity: 2 }],
}

const activeSpies: Array<{ mockRestore: () => void }> = []
let originalClipboardDescriptor: PropertyDescriptor | undefined
let originalVisibilityDescriptor: PropertyDescriptor | undefined

function mockReservationApis() {
  const reserveSpy = spyOn(inventoryApi, 'reserve').mockResolvedValue(reservation)
  const reservationSpy = spyOn(inventoryApi, 'reservation').mockImplementation(async (id) => ({ ...reservation, id }))
  const confirmSpy = spyOn(inventoryApi, 'confirmReservation').mockResolvedValue({ ...reservation, status: 'confirmed' })
  const releaseSpy = spyOn(inventoryApi, 'releaseReservation').mockResolvedValue({ ...reservation, status: 'released' })
  activeSpies.push(
    reserveSpy,
    reservationSpy,
    confirmSpy,
    releaseSpy,
    spyOn(inventoryApi, 'warehouse').mockResolvedValue(warehouse),
    spyOn(catalogApi, 'list').mockResolvedValue({ items: [{
      id: productId,
      slug: product.slug,
      name: product.name,
      englishName: null,
      category: 'fresh',
      imageUrl: null,
      imageAlt: null,
      status: 'published',
      publishedAt: now,
      updatedAt: now,
    }], nextCursor: null }),
    spyOn(catalogApi, 'get').mockResolvedValue(product),
  )
  return { reserveSpy, reservationSpy, confirmSpy, releaseSpy }
}

function renderReservation(initialEntry: string) {
  if (!lookupPage || !createPage || !detailPage) throw new Error('Reservation route component is missing')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  queryClient.setQueryData(authSessionQuery.queryKey, session, { updatedAt: Date.now() + 10_000 })
  const router = createMemoryRouter([
    {
      path: '/inventory/reservations',
      children: [
        { index: true, Component: lookupPage.Component },
        { path: 'new', Component: createPage.Component },
        { path: ':reservationId', Component: detailPage.Component },
      ],
    },
  ], { initialEntries: [initialEntry] })
  const rendered = render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
  return { queryClient, router, ...rendered }
}

async function advanceTimers(milliseconds: number) {
  await act(async () => {
    jest.advanceTimersByTime(milliseconds)
    for (let index = 0; index < 5; index += 1) await Promise.resolve()
    jest.advanceTimersByTime(0)
    for (let index = 0; index < 5; index += 1) await Promise.resolve()
  })
}

async function flushAsyncWork() {
  await act(async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve()
    jest.advanceTimersByTime(0)
    for (let index = 0; index < 5; index += 1) await Promise.resolve()
    jest.advanceTimersByTime(0)
    for (let index = 0; index < 5; index += 1) await Promise.resolve()
  })
}

function setDocumentVisibility(value: DocumentVisibilityState) {
  if (originalVisibilityDescriptor === undefined) originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState')
  Object.defineProperty(document, 'visibilityState', { configurable: true, value })
}

afterEach(() => {
  cleanup()
  if (jest.isFakeTimers()) {
    jest.clearAllTimers()
    jest.useRealTimers()
  }
  activeSpies.splice(0).forEach((spy) => spy.mockRestore())
  if (originalClipboardDescriptor) Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor)
  else Reflect.deleteProperty(navigator, 'clipboard')
  originalClipboardDescriptor = undefined
  if (originalVisibilityDescriptor) Object.defineProperty(document, 'visibilityState', originalVisibilityDescriptor)
  else Reflect.deleteProperty(document, 'visibilityState')
  originalVisibilityDescriptor = undefined
})

test('loads lookup, create, and detail route components', () => {
  expect(lookupPage).not.toBeNull()
  expect(createPage).not.toBeNull()
  expect(detailPage).not.toBeNull()
})

test('reservation lookup validates malformed UUIDs without an HTTP request and renders no reservation list', async () => {
  const { reservationSpy } = mockReservationApis()
  renderReservation('/inventory/reservations')

  expect(screen.queryByRole('table')).toBeNull()
  fireEvent.change(screen.getByLabelText('รหัสการจอง'), { target: { value: 'not-a-uuid' } })
  fireEvent.click(screen.getByRole('button', { name: 'ค้นหาการจอง' }))

  expect(await screen.findByText(/UUID/)).toBeTruthy()
  expect(reservationSpy).not.toHaveBeenCalled()
})

test('creating a reservation redirects to the server returned ID with one atomic multi-line request', async () => {
  const { reserveSpy } = mockReservationApis()
  const { router } = renderReservation('/inventory/reservations/new')

  await screen.findByText(/คลังหลัก/)
  fireEvent.change(screen.getByRole('searchbox', { name: 'ค้นหาสินค้าเพื่อเลือกสต็อก' }), { target: { value: 'มะม่วง' } })
  fireEvent.click(await screen.findByRole('button', { name: /มะม่วงน้ำดอกไม้/ }))
  fireEvent.click(await screen.findByRole('button', { name: /MANGO-1KG/ }))
  fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรูปแบบที่เลือก' }))
  fireEvent.change(screen.getByLabelText('จำนวน มะม่วงน้ำดอกไม้ · MANGO-1KG · ขนาด 1 กิโลกรัม'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('รหัสอ้างอิงภายนอก (ไม่บังคับ)'), { target: { value: ' ORDER-42 ' } })
  fireEvent.click(screen.getByRole('button', { name: 'สร้างการจอง' }))

  await waitFor(() => expect(router.state.location.pathname).toBe(`/inventory/reservations/${reservationId}`))
  expect(reserveSpy).toHaveBeenCalledTimes(1)
  expect(reserveSpy.mock.calls[0]?.[0]).toEqual({
    warehouseId,
    lines: [{ variantId, quantity: 2 }],
    externalReference: 'ORDER-42',
  })
})

test('invalid reservation quantity shows its localized line error and can be corrected before submission', async () => {
  const { reserveSpy } = mockReservationApis()
  const { router } = renderReservation('/inventory/reservations/new')

  await screen.findByText(/คลังหลัก/)
  fireEvent.change(screen.getByRole('searchbox', { name: 'ค้นหาสินค้าเพื่อเลือกสต็อก' }), { target: { value: 'มะม่วง' } })
  fireEvent.click(await screen.findByRole('button', { name: /มะม่วงน้ำดอกไม้/ }))
  fireEvent.click(await screen.findByRole('button', { name: /MANGO-1KG/ }))
  fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรูปแบบที่เลือก' }))

  const quantity = screen.getByLabelText('จำนวน มะม่วงน้ำดอกไม้ · MANGO-1KG · ขนาด 1 กิโลกรัม')
  fireEvent.change(quantity, { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: 'สร้างการจอง' }))

  expect(await screen.findByText('จำนวนต้องไม่น้อยกว่า 1')).toBeTruthy()
  expect(quantity.getAttribute('aria-invalid')).toBe('true')
  const quantityErrorId = quantity.getAttribute('aria-describedby')
  expect(quantityErrorId).toBe(`reservation-quantity-${variantId}-error`)
  expect(document.getElementById(quantityErrorId ?? '')?.textContent).toBe('จำนวนต้องไม่น้อยกว่า 1')
  expect(reserveSpy).not.toHaveBeenCalled()

  fireEvent.change(quantity, { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'สร้างการจอง' }))

  await waitFor(() => expect(router.state.location.pathname).toBe(`/inventory/reservations/${reservationId}`))
  expect(reserveSpy).toHaveBeenCalledTimes(1)
  expect(reserveSpy.mock.calls[0]?.[0].lines).toEqual([{ variantId, quantity: 2 }])
})

test('insufficient stock keeps every line and sends the multi-line reservation only once', async () => {
  const { reserveSpy } = mockReservationApis()
  reserveSpy.mockRejectedValueOnce(new ApiRequestError(409, 'INVENTORY_STOCK_CONFLICT', 'stock changed'))
  renderReservation('/inventory/reservations/new')

  await screen.findByText(/คลังหลัก/)
  fireEvent.change(screen.getByRole('searchbox', { name: 'ค้นหาสินค้าเพื่อเลือกสต็อก' }), { target: { value: 'มะม่วง' } })
  fireEvent.click(await screen.findByRole('button', { name: /มะม่วงน้ำดอกไม้/ }))
  fireEvent.click(await screen.findByRole('button', { name: /MANGO-1KG/ }))
  fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรูปแบบที่เลือก' }))
  fireEvent.click(screen.getByRole('button', { name: /MANGO-500G/ }))
  fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรูปแบบที่เลือก' }))
  fireEvent.change(screen.getByLabelText('จำนวน มะม่วงน้ำดอกไม้ · MANGO-1KG · ขนาด 1 กิโลกรัม'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('จำนวน มะม่วงน้ำดอกไม้ · MANGO-500G · ขนาด 500 กรัม'), { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: 'สร้างการจอง' }))

  expect(await screen.findByText(/ข้อมูลสต็อกเปลี่ยนแปลง/)).toBeTruthy()
  expect(reserveSpy).toHaveBeenCalledTimes(1)
  expect(reserveSpy.mock.calls[0]?.[0].lines).toEqual([
    { variantId, quantity: 2 },
    { variantId: otherVariantId, quantity: 3 },
  ])
  expect((screen.getByLabelText('จำนวน มะม่วงน้ำดอกไม้ · MANGO-1KG · ขนาด 1 กิโลกรัม') as HTMLInputElement).value).toBe('2')
  expect((screen.getByLabelText('จำนวน มะม่วงน้ำดอกไม้ · MANGO-500G · ขนาด 500 กรัม') as HTMLInputElement).value).toBe('3')
})

test('reservation detail retains lot allocations and reports clipboard success and failure', async () => {
  mockReservationApis()
  originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const writeText = mock(async (_value: string) => undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  renderReservation(`/inventory/reservations/${reservationId}`)

  expect(await screen.findByText(lotId)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'คัดลอกรหัสการจอง' }))
  expect(await screen.findByText('คัดลอกแล้ว')).toBeTruthy()

  writeText.mockImplementation(async () => { throw new Error('denied') })
  fireEvent.click(screen.getByRole('button', { name: 'คัดลอกรหัสการจอง' }))
  expect(await screen.findByText('คัดลอกไม่สำเร็จ')).toBeTruthy()
})

test('confirm retries the same uncertain command key and hides commands after the server confirms', async () => {
  const { confirmSpy, reservationSpy } = mockReservationApis()
  confirmSpy.mockRejectedValueOnce(new Error('connection dropped'))
  reservationSpy.mockResolvedValueOnce(reservation).mockResolvedValue({ ...reservation, status: 'confirmed' })
  const { queryClient } = renderReservation(`/inventory/reservations/${reservationId}`)
  queryClient.setQueryData(inventoryKeys.lots(), [])

  await screen.findByText('กำลังจอง')
  fireEvent.click(screen.getByRole('button', { name: 'ยืนยันและตัดสต็อก' }))
  expect(await screen.findByText(/ตัดจำนวนที่ถือไว้จากสต็อกจริง/)).toBeTruthy()
  fireEvent.click(await screen.findByRole('button', { name: 'ยืนยันการตัดสต็อก' }))
  expect(await screen.findByRole('button', { name: 'ส่งคำยืนยันเดิมซ้ำ' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'ส่งคำยืนยันเดิมซ้ำ' }))

  await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(2))
  expect(confirmSpy.mock.calls.map(([id, key]) => [id, key])).toEqual([
    [reservationId, confirmSpy.mock.calls[0]?.[1]],
    [reservationId, confirmSpy.mock.calls[0]?.[1]],
  ])
  await waitFor(() => expect(screen.queryByRole('button', { name: 'ยืนยันและตัดสต็อก' })).toBeNull())
  expect(queryClient.getQueryState(inventoryKeys.lots())?.isInvalidated).toBe(true)
})

test('expired status removes confirm and release actions', async () => {
  const { reservationSpy, confirmSpy, releaseSpy } = mockReservationApis()
  reservationSpy.mockResolvedValue({ ...reservation, status: 'expired' })
  renderReservation(`/inventory/reservations/${reservationId}`)

  expect(await screen.findByText('หมดอายุ')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'ยืนยันและตัดสต็อก' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'ปล่อยการจอง' })).toBeNull()
  expect(confirmSpy).not.toHaveBeenCalled()
  expect(releaseSpy).not.toHaveBeenCalled()
})

test('release requires confirmation and refreshes to the released server status', async () => {
  const { reservationSpy, releaseSpy } = mockReservationApis()
  reservationSpy.mockResolvedValueOnce(reservation).mockResolvedValue({ ...reservation, status: 'released' })
  renderReservation(`/inventory/reservations/${reservationId}`)

  await screen.findByText('กำลังจอง')
  fireEvent.click(screen.getByRole('button', { name: 'ปล่อยการจอง' }))
  expect(await screen.findByText(/คืนจำนวนที่ถือไว้/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'ยืนยันปล่อยการจอง' }))

  await waitFor(() => expect(releaseSpy).toHaveBeenCalledTimes(1))
  expect(await screen.findByText('ปล่อยการจองแล้ว')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'ปล่อยการจอง' })).toBeNull()
})

test('active detail polls through its observer while visible and reports server quarantine cancellation', async () => {
  jest.useFakeTimers()
  jest.setSystemTime(now)
  const { reservationSpy } = mockReservationApis()
  reservationSpy.mockResolvedValueOnce(reservation).mockResolvedValueOnce({ ...reservation, status: 'cancelled' })
  renderReservation(`/inventory/reservations/${reservationId}`)

  await flushAsyncWork()
  expect(screen.getByText('กำลังจอง')).toBeTruthy()
  expect(reservationSpy).toHaveBeenCalledTimes(1)
  await advanceTimers(30_000)

  expect(reservationSpy).toHaveBeenCalledTimes(2)
  expect(screen.getByText('ถูกยกเลิก')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'ยืนยันและตัดสต็อก' })).toBeNull()
})

test('active detail does not poll while hidden and has no polling after unmount', async () => {
  jest.useFakeTimers()
  jest.setSystemTime(now)
  setDocumentVisibility('hidden')
  const { reservationSpy } = mockReservationApis()
  const { unmount } = renderReservation(`/inventory/reservations/${reservationId}`)

  await flushAsyncWork()
  expect(screen.getByText('กำลังจอง')).toBeTruthy()
  await advanceTimers(30_000)
  expect(reservationSpy).toHaveBeenCalledTimes(1)
  unmount()
  setDocumentVisibility('visible')
  await advanceTimers(60_000)
  expect(reservationSpy).toHaveBeenCalledTimes(1)
})

test('active detail expiry disables commands and asks the page observer to refetch once', async () => {
  jest.useFakeTimers()
  jest.setSystemTime(now)
  const { reservationSpy } = mockReservationApis()
  const nearExpiry = { ...reservation, expiresAt: new Date(now.getTime() + 1_000).toISOString() }
  reservationSpy.mockResolvedValueOnce(nearExpiry).mockImplementationOnce(() => new Promise(() => undefined))
  const { unmount } = renderReservation(`/inventory/reservations/${reservationId}`)

  await flushAsyncWork()
  expect(screen.getByRole('button', { name: 'ยืนยันและตัดสต็อก' })).toBeTruthy()
  await advanceTimers(1_000)

  expect(reservationSpy).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button', { name: 'ยืนยันและตัดสต็อก' }).hasAttribute('disabled')).toBe(true)
  unmount()
})

test('changing reservation resource warns that uncertain command keys are lost and starts a fresh attempt', async () => {
  const { confirmSpy, reservationSpy } = mockReservationApis()
  confirmSpy.mockRejectedValueOnce(new Error('connection dropped')).mockResolvedValueOnce({ ...reservation, id: otherReservationId, status: 'confirmed' })
  const { router } = renderReservation(`/inventory/reservations/${reservationId}`)

  await screen.findByText('กำลังจอง')
  fireEvent.click(screen.getByRole('button', { name: 'ยืนยันและตัดสต็อก' }))
  fireEvent.click(await screen.findByRole('button', { name: 'ยืนยันการตัดสต็อก' }))
  await screen.findByRole('button', { name: 'ส่งคำยืนยันเดิมซ้ำ' })
  const oldKey = confirmSpy.mock.calls[0]?.[1]

  await act(async () => { await router.navigate(`/inventory/reservations/${otherReservationId}`) })
  expect(await screen.findByText(/สูญเสียรหัสคำขอเดิม/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'ทิ้งการเปลี่ยนแปลง' }))
  await screen.findByText(otherReservationId)
  expect(screen.queryByRole('button', { name: 'ส่งคำยืนยันเดิมซ้ำ' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'ยืนยันและตัดสต็อก' }))
  fireEvent.click(await screen.findByRole('button', { name: 'ยืนยันการตัดสต็อก' }))

  await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(2))
  expect(confirmSpy.mock.calls[1]?.[0]).toBe(otherReservationId)
  expect(confirmSpy.mock.calls[1]?.[1]).not.toBe(oldKey)
  expect(reservationSpy).toHaveBeenCalledWith(otherReservationId)
})

test('reservation query polls only on a visible active detail and refetches on window focus', () => {
  const options = reservationQuery(reservationId)
  const interval = options.refetchInterval as (query: { state: { data: Reservation | undefined } }) => number | false
  const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  expect(interval({ state: { data: reservation } })).toBe(30_000)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  expect(interval({ state: { data: reservation } })).toBe(false)
  expect(interval({ state: { data: { ...reservation, status: 'expired' } } })).toBe(false)
  expect(options.refetchOnWindowFocus).toBe(true)
  if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility)
  else delete (document as { visibilityState?: DocumentVisibilityState }).visibilityState
})

test('expiry refetch fires once at the server deadline and cleanup cancels the timer', () => {
  let currentTime = now.getTime()
  let nextId = 0
  const tasks = new Map<number, () => void>()
  const cancelled: number[] = []
  const refetch = spyOn({ run: () => undefined }, 'run')
  const schedule = scheduleReservationExpiry(reservation.expiresAt, () => refetch(), {
    now: () => currentTime,
    setTimeout: (callback, delay) => {
      expect(delay).toBe(60_000)
      const id = ++nextId
      tasks.set(id, callback)
      return id
    },
    clearTimeout: (id) => {
      cancelled.push(id as number)
      tasks.delete(id as number)
    },
  })

  currentTime += 60_000
  tasks.get(1)?.()
  tasks.get(1)?.()
  expect(refetch).toHaveBeenCalledTimes(1)
  schedule()
  expect(cancelled).toEqual([1])

  const unmounted = scheduleReservationExpiry(reservation.expiresAt, () => refetch(), {
    now: () => currentTime,
    setTimeout: (callback) => {
      const id = ++nextId
      tasks.set(id, callback)
      return id
    },
    clearTimeout: (id) => {
      cancelled.push(id as number)
      tasks.delete(id as number)
    },
  })
  unmounted()
  tasks.get(2)?.()
  expect(refetch).toHaveBeenCalledTimes(1)
})
