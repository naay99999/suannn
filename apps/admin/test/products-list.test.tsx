import { afterEach, expect, spyOn, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Component as ProductDetailPage } from '../src/pages/products/product-detail-page'
import { Component as ProductsPage } from '../src/pages/products/products-page'
import { catalogApi } from '../src/lib/catalog/api'
import type { ProductDetail, ProductSummary } from '../src/lib/catalog/api'

const productId = '00000000-0000-4000-8000-000000000001'
const variantId = '00000000-0000-4000-8000-000000000002'
const createdAt = new Date('2026-09-01T08:00:00.000Z')
const updatedAt = new Date('2026-09-12T08:00:00.000Z')

const mango: ProductSummary = {
  id: productId,
  slug: 'nam-dok-mai-mango',
  name: 'มะม่วงน้ำดอกไม้',
  englishName: 'Nam Dok Mai Mango',
  category: 'fresh',
  imageUrl: null,
  imageAlt: null,
  status: 'published',
  createdAt,
  updatedAt,
  publishedAt: updatedAt,
  archivedAt: null,
}

const detail: ProductDetail = {
  ...mango,
  description: 'มะม่วงสุกหวานจากสวน',
  originStory: 'ปลูกในสวนครอบครัว',
  storageInstructions: 'เก็บในที่เย็น',
  variants: [{
    id: variantId,
    productId,
    sku: 'MANGO-1KG',
    name: 'ขนาด 1 กิโลกรัม',
    unit: 'กิโลกรัม',
    priceSatang: 18900,
    salesEnabled: true,
    displayOrder: 0,
    minRemainingShelfLifeDays: 1,
    createdAt,
    updatedAt,
    archivedAt: null,
  }],
}

const activeSpies: Array<{ mockRestore: () => void }> = []

function spyList(implementation: (query?: Parameters<typeof catalogApi.list>[0]) => Promise<Awaited<ReturnType<typeof catalogApi.list>>>) {
  const listSpy = spyOn(catalogApi, 'list').mockImplementation(implementation)
  activeSpies.push(listSpy)
  return listSpy
}

function spyGet(implementation: (id: string) => Promise<ProductDetail>) {
  const getSpy = spyOn(catalogApi, 'get').mockImplementation(implementation)
  activeSpies.push(getSpy)
  return getSpy
}

function renderProducts(initialEntry = '/products') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const router = createMemoryRouter([
    { path: '/products', element: <ProductsPage /> },
    { path: '/products/:productId', element: <ProductDetailPage /> },
  ], { initialEntries: [initialEntry] })
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
  return { queryClient, router }
}

async function waitForSearchDebounce() {
  await new Promise((resolve) => setTimeout(resolve, 320))
}

afterEach(() => {
  cleanup()
  activeSpies.splice(0).forEach((spy) => spy.mockRestore())
})

test('renders API catalog records without invented price, stock, or totals', async () => {
  spyList(async () => ({ items: [mango], nextCursor: null }))
  renderProducts()

  const productLink = await screen.findByRole('link', { name: 'มะม่วงน้ำดอกไม้' })
  expect(productLink.getAttribute('href')).toBe(`/products/${productId}`)
  expect(screen.queryByText('Coconut honey')).toBeNull()
  expect(screen.queryByText(/฿/)).toBeNull()
  expect(screen.queryByText(/stock/i)).toBeNull()
  expect(screen.queryByText(/page\s+\d+\s+of\s+\d+/i)).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(screen.queryByRole('button', { name: 'เพิ่มสินค้า' })).toBeNull()
})

test('shows product slugs and formats the last updated date in Bangkok with a Gregorian year', async () => {
  spyList(async () => ({ items: [mango], nextCursor: null }))
  renderProducts()

  await screen.findByRole('link', { name: mango.name })
  expect(screen.getByText(mango.slug)).toBeTruthy()
  expect(screen.getByText('12 ก.ย. 2026')).toBeTruthy()
  expect(screen.queryByText(/2569/)).toBeNull()
})

test('debounces Thai search for 300 ms and requests the selected status and page size', async () => {
  const listSpy = spyList(async () => ({ items: [], nextCursor: null }))
  const user = userEvent.setup()
  renderProducts()

  const search = await screen.findByRole('searchbox', { name: 'ค้นหาสินค้า' })
  await user.type(search, 'มะม่วง')
  await waitForSearchDebounce()

  await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'มะม่วง', limit: 25 })))
  expect(listSpy.mock.calls.at(-1)?.[0]?.cursor).toBeUndefined()

  const statusTrigger = screen.getByRole('combobox', { name: 'กรองตามสถานะ' })
  await user.click(statusTrigger)
  await user.click(await screen.findByRole('option', { name: 'ร่าง' }))

  await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'มะม่วง', status: 'draft', limit: 25 })))
})

test('uses the returned next cursor and clears it after a filter change', async () => {
  const listSpy = spyList(async (query) => query?.cursor
    ? { items: [], nextCursor: null }
    : { items: [mango], nextCursor: 'cursor-from-api' })
  const user = userEvent.setup()
  renderProducts()

  await screen.findByRole('link', { name: 'มะม่วงน้ำดอกไม้' })
  await user.click(screen.getByRole('button', { name: 'ไปหน้าถัดไป' }))
  await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'cursor-from-api', limit: 25 })))

  const search = screen.getByRole('searchbox', { name: 'ค้นหาสินค้า' })
  fireEvent.change(search, { target: { value: 'มะม่วง' } })
  await waitForSearchDebounce()

  await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'มะม่วง', limit: 25 })) )
  expect(listSpy.mock.calls.at(-1)?.[0]?.cursor).toBeUndefined()
})

test('offers first-page recovery for a direct cursor link without a fabricated previous cursor', async () => {
  const listSpy = spyList(async (query) => ({ items: query?.cursor ? [] : [mango], nextCursor: null }))
  const user = userEvent.setup()
  const { router } = renderProducts('/products?cursor=external-cursor&limit=25')

  expect((await screen.findByRole('button', { name: 'ไปหน้าก่อนหน้า' })).hasAttribute('disabled')).toBe(true)
  const firstPageButton = screen.getByRole('button', { name: 'ไปหน้าแรก' })
  expect(firstPageButton.hasAttribute('disabled')).toBe(false)
  await user.click(firstPageButton)

  await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 25 })) )
  expect(listSpy.mock.calls.at(-1)?.[0]?.cursor).toBeUndefined()
  expect(new URLSearchParams(router.state.location.search).get('cursor')).toBeNull()
})

test('shows real read-only product fields and variants after following a row link', async () => {
  spyList(async () => ({ items: [mango], nextCursor: null }))
  const getSpy = spyGet(async () => detail)
  const { router } = renderProducts()

  await userEvent.setup().click(await screen.findByRole('link', { name: 'มะม่วงน้ำดอกไม้' }))

  expect(await screen.findByRole('heading', { name: 'มะม่วงน้ำดอกไม้' })).toBeTruthy()
  expect(screen.getByText('มะม่วงสุกหวานจากสวน')).toBeTruthy()
  expect(screen.getByText('ปลูกในสวนครอบครัว')).toBeTruthy()
  expect(screen.getByText('MANGO-1KG')).toBeTruthy()
  expect(screen.getByText('ขนาด 1 กิโลกรัม')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /แก้ไข|บันทึก|เพิ่มรูปแบบ/i })).toBeNull()
  expect(getSpy).toHaveBeenCalledWith(productId)
  expect(router.state.location.pathname).toBe(`/products/${productId}`)
})

test('loads detail data on a direct link and reloads it on retry', async () => {
  let attempts = 0
  const getSpy = spyGet(async () => {
    attempts++
    if (attempts === 1) throw Object.assign(new Error('offline'), { status: 0, code: 'NETWORK_ERROR' })
    return detail
  })
  renderProducts(`/products/${productId}`)

  expect(await screen.findByRole('button', { name: 'ลองอีกครั้ง' })).toBeTruthy()
  await userEvent.setup().click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }))
  expect(await screen.findByText('MANGO-1KG')).toBeTruthy()
  expect(getSpy).toHaveBeenCalledTimes(2)
})

test('does not show a previous filter result when an older response resolves last', async () => {
  let resolveFirst: ((value: Awaited<ReturnType<typeof catalogApi.list>>) => void) | undefined
  const oldProduct = { ...mango, id: '00000000-0000-4000-8000-000000000010', name: 'ผลลัพธ์เดิม' }
  const listSpy = spyList((query) => {
    if (query?.q === 'ใหม่') return Promise.resolve({ items: [{ ...mango, name: 'ผลลัพธ์ใหม่' }], nextCursor: null })
    if (query?.q === 'เก่า') return new Promise((resolve) => { resolveFirst = resolve })
    return Promise.resolve({ items: [oldProduct], nextCursor: null })
  })
  renderProducts()

  const search = await screen.findByRole('searchbox', { name: 'ค้นหาสินค้า' })
  fireEvent.change(search, { target: { value: 'เก่า' } })
  await waitForSearchDebounce()
  await waitFor(() => expect(listSpy.mock.calls.some(([query]) => query?.q === 'เก่า')).toBe(true))

  fireEvent.change(search, { target: { value: 'ใหม่' } })
  await waitForSearchDebounce()
  expect(await screen.findByText('ผลลัพธ์ใหม่')).toBeTruthy()

  await act(async () => {
    resolveFirst?.({ items: [{ ...oldProduct, name: 'ผลลัพธ์เก่า' }], nextCursor: null })
  })
  expect(screen.queryByText('ผลลัพธ์เก่า')).toBeNull()
  expect(screen.getByText('ผลลัพธ์ใหม่')).toBeTruthy()
})

test('renders Thai empty and error states with a usable retry action', async () => {
  let attempts = 0
  spyList(async () => {
    attempts++
    if (attempts === 1) throw Object.assign(new Error('offline'), { status: 0, code: 'NETWORK_ERROR' })
    return { items: [], nextCursor: null }
  })
  renderProducts()

  expect(await screen.findByText('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองอีกครั้ง')).toBeTruthy()
  await userEvent.setup().click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }))
  expect(await screen.findByText('ยังไม่มีสินค้า')).toBeTruthy()
  expect(screen.getByText('ลองเปลี่ยนคำค้นหาหรือตัวกรองสถานะ')).toBeTruthy()
})
