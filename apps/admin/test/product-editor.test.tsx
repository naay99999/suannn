import { afterEach, expect, spyOn, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Toaster } from '@workspace/ui/components/toast'
import { ApiRequestError } from '../src/lib/api-result'
import { PermissionGate } from '../src/components/auth/permission-gate'
import { authSessionQuery, type AuthSession } from '../src/lib/auth-session'
import { catalogApi } from '../src/lib/catalog/api'
import { catalogKeys } from '../src/lib/catalog/queries'
import type { ProductDetail, ProductSummary, Variant } from '../src/lib/catalog/api'
import { Component as ProductCreatePage } from '../src/pages/products/product-create-page'
import { Component as ProductDetailPage } from '../src/pages/products/product-detail-page'
import { Component as ProductsPage } from '../src/pages/products/products-page'

const productId = '00000000-0000-4000-8000-000000000001'
const variantId = '00000000-0000-4000-8000-000000000002'
const createdAt = new Date('2026-09-01T08:00:00.000Z')
const updatedAt = new Date('2026-09-12T08:00:00.000Z')
const permissions = ['catalog:read', 'catalog:create', 'catalog:update', 'catalog:publish', 'catalog:delete']

const product: ProductSummary = {
  id: productId,
  slug: 'nam-dok-mai-mango',
  name: 'มะม่วงน้ำดอกไม้',
  englishName: 'Nam Dok Mai Mango',
  category: 'fresh',
  imageUrl: 'https://example.test/mango.jpg',
  imageAlt: 'ผลมะม่วงน้ำดอกไม้',
  status: 'draft',
  createdAt,
  updatedAt,
  publishedAt: null,
  archivedAt: null,
}

const variant: Variant = {
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
}

const detail: ProductDetail = {
  ...product,
  description: 'มะม่วงสุกหวานจากสวน',
  originStory: 'ปลูกในสวนครอบครัว',
  storageInstructions: 'เก็บในที่เย็น',
  variants: [variant],
}

const activeSpies: Array<{ mockRestore: () => void }> = []

function stub<K extends keyof typeof catalogApi>(method: K, value: unknown) {
  const methodSpy = spyOn(catalogApi, method as never).mockImplementation(value as never)
  activeSpies.push(methodSpy)
  return methodSpy
}

function sessionWith(access: string[]): AuthSession {
  return {
    session: { id: 'session-1', expiresAt: '2026-10-03T00:00:00.000Z' },
    user: { id: 'staff-1', name: 'เจ้าหน้าที่', email: 'staff@example.com', emailVerified: true, image: null, accountType: 'staff' },
    staff: { role: 'owner', permissions: access },
  }
}

function renderCatalog(path: string, access = permissions) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
  queryClient.setQueryData(authSessionQuery.queryKey, sessionWith(access), { updatedAt: Date.now() + 10_000 })
  const router = createMemoryRouter([
    {
      path: '/products',
      element: <PermissionGate permission="catalog:read" />,
      children: [
        { index: true, element: <ProductsPage /> },
        {
          path: 'new',
          element: <PermissionGate permission="catalog:create" />,
          children: [{ index: true, element: <ProductCreatePage /> }],
        },
        { path: ':productId', element: <ProductDetailPage /> },
      ],
    },
  ], { initialEntries: [path] })
  render(<Toaster><QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider></Toaster>)
  return { queryClient, router }
}

afterEach(() => {
  cleanup()
  activeSpies.splice(0).forEach((methodSpy) => methodSpy.mockRestore())
})

test('shows the create entry only for staff with catalog:create', async () => {
  stub('list', async () => ({ items: [], nextCursor: null }))
  const { router } = renderCatalog('/products', ['catalog:read'])
  expect(await screen.findByText('ยังไม่มีสินค้า')).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'เพิ่มสินค้า' })).toBeNull()
  cleanup()

  renderCatalog('/products', ['catalog:read', 'catalog:create'])
  expect(await screen.findByRole('link', { name: 'เพิ่มสินค้า' })).toBeTruthy()
  expect(router.state.location.pathname).toBe('/products')
})

test('creates a draft and navigates to its detail without asking to discard the submitted form', async () => {
  const user = userEvent.setup()
  const createSpy = stub('create', async () => detail)
  stub('get', async () => detail)
  const { router } = renderCatalog('/products/new')

  await user.type(await screen.findByRole('textbox', { name: 'ชื่อ URL สินค้า' }), 'mango-box')
  await user.type(screen.getByRole('textbox', { name: 'ชื่อสินค้า' }), 'มะม่วงกล่อง')
  await user.click(screen.getByRole('button', { name: 'สร้างสินค้า' }))

  await waitFor(() => expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ slug: 'mango-box', name: 'มะม่วงกล่อง' })))
  expect(await screen.findByRole('heading', { name: 'มะม่วงน้ำดอกไม้' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'ยังไม่ได้บันทึกการเปลี่ยนแปลง' })).toBeNull()
  expect(router.state.location.pathname).toBe(`/products/${productId}`)
})

test('retains product form input and shows a safe API error after a rejected create', async () => {
  const user = userEvent.setup()
  stub('create', async () => { throw Object.assign(new Error('private server detail'), { status: 409, code: 'PRODUCT_SLUG_CONFLICT' }) })
  renderCatalog('/products/new')

  const name = await screen.findByRole('textbox', { name: 'ชื่อสินค้า' })
  await user.type(screen.getByRole('textbox', { name: 'ชื่อ URL สินค้า' }), 'mango-box')
  await user.type(name, 'สินค้าทดสอบ')
  await user.click(screen.getByRole('button', { name: 'สร้างสินค้า' }))

  expect(await screen.findByText('URL สินค้านี้ถูกใช้งานแล้ว')).toBeTruthy()
  expect((screen.getByRole('textbox', { name: 'ชื่อสินค้า' }) as HTMLInputElement).value).toBe('สินค้าทดสอบ')
  expect(screen.queryByText('private server detail')).toBeNull()
})

test('refreshes the catalog before offering recovery after an ambiguous create failure', async () => {
  const user = userEvent.setup()
  const createSpy = stub('create', async () => { throw new ApiRequestError(500, 'SERVER_ERROR', 'failed') })
  const listSpy = stub('list', async () => ({ items: [product], nextCursor: null }))
  const { queryClient } = renderCatalog('/products')
  queryClient.setQueryDefaults(catalogKeys.lists(), { staleTime: 60_000 })

  await screen.findByRole('link', { name: product.name })
  await user.click(screen.getByRole('link', { name: 'เพิ่มสินค้า' }))
  await user.type(await screen.findByRole('textbox', { name: 'ชื่อ URL สินค้า' }), 'mango-box')
  await user.type(screen.getByRole('textbox', { name: 'ชื่อสินค้า' }), 'กล่องมะม่วง')
  await user.click(screen.getByRole('button', { name: 'สร้างสินค้า' }))

  expect(await screen.findByRole('link', { name: 'ตรวจสอบรายการสินค้า' })).toBeTruthy()
  expect(listSpy).toHaveBeenCalledTimes(2)
  expect(createSpy).toHaveBeenCalledTimes(1)
})

test('edits every mutable product field while keeping slug read-only and out of the payload', async () => {
  const user = userEvent.setup()
  const updateSpy = stub('update', async () => detail)
  stub('get', async () => detail)
  const { queryClient } = renderCatalog(`/products/${productId}`)
  queryClient.setQueryDefaults(catalogKeys.lists(), { gcTime: 60_000 })
  queryClient.setQueryDefaults(['inventory'], { gcTime: 60_000 })
  queryClient.setQueryData(catalogKeys.lists(), { items: [], nextCursor: null })
  queryClient.setQueryData(['inventory', 'lots'], { items: [] })

  await user.click(await screen.findByRole('button', { name: 'แก้ไขสินค้า' }))
  expect((screen.getByRole('textbox', { name: 'ชื่อ URL สินค้า' }) as HTMLInputElement).readOnly).toBe(true)
  await user.clear(screen.getByRole('textbox', { name: 'ชื่อสินค้า' }))
  await user.type(screen.getByRole('textbox', { name: 'ชื่อสินค้า' }), 'มะม่วงชุดใหม่')
  await user.clear(screen.getByRole('textbox', { name: 'ชื่อภาษาอังกฤษ' }))
  await user.clear(screen.getByRole('textbox', { name: 'คำอธิบาย' }))
  await user.clear(screen.getByRole('textbox', { name: 'เรื่องราวจากสวน' }))
  await user.clear(screen.getByRole('textbox', { name: 'วิธีเก็บรักษา' }))
  await user.clear(screen.getByRole('textbox', { name: 'URL รูปสินค้า HTTPS' }))
  await user.clear(screen.getByRole('textbox', { name: 'คำอธิบายรูปภาพ' }))
  await user.click(screen.getByRole('button', { name: 'บันทึกสินค้า' }))

  await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(productId, expect.objectContaining({
    name: 'มะม่วงชุดใหม่',
    englishName: null,
    description: null,
    originStory: null,
    storageInstructions: null,
    imageUrl: null,
    imageAlt: null,
  })))
  expect(updateSpy.mock.calls[0]?.[1]).not.toHaveProperty('slug')
  await waitFor(() => {
    expect(queryClient.getQueryState(catalogKeys.lists())?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['inventory', 'lots'])?.isInvalidated).toBe(true)
  })
})

test('disables product inputs while a save is pending', async () => {
  const user = userEvent.setup()
  let resolveUpdate: ((value: ProductDetail) => void) | undefined
  stub('update', () => new Promise((resolve) => { resolveUpdate = resolve }))
  stub('get', async () => detail)
  renderCatalog(`/products/${productId}`)

  await user.click(await screen.findByRole('button', { name: 'แก้ไขสินค้า' }))
  await user.type(screen.getByRole('textbox', { name: 'ชื่อสินค้า' }), 'ใหม่')
  await user.click(screen.getByRole('button', { name: 'บันทึกสินค้า' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'ชื่อสินค้า' }).matches(':disabled')).toBe(true))
  expect(screen.getByRole('textbox', { name: 'คำอธิบาย' }).matches(':disabled')).toBe(true)
  expect((screen.getByRole('combobox', { name: 'หมวดหมู่' }) as HTMLButtonElement).disabled).toBe(true)

  await act(async () => resolveUpdate?.(detail))
})

test('keeps product edits protected by the shared detail-page blocker', async () => {
  const user = userEvent.setup()
  stub('get', async () => detail)
  const { router } = renderCatalog(`/products/${productId}`)

  await user.click(await screen.findByRole('button', { name: 'แก้ไขสินค้า' }))
  await user.type(screen.getByRole('textbox', { name: 'ชื่อสินค้า' }), 'เพิ่มเติม')
  await act(async () => { await router.navigate('/products') })

  expect(screen.getByRole('heading', { name: 'ยังไม่ได้บันทึกการเปลี่ยนแปลง' })).toBeTruthy()
  expect(router.state.location.pathname).toBe(`/products/${productId}`)
})

test('creates a variant with exact satang and keeps SKU immutable in edit mode', async () => {
  const user = userEvent.setup()
  const createVariantSpy = stub('createVariant', async () => variant)
  stub('get', async () => detail)
  renderCatalog(`/products/${productId}`)

  await user.click(await screen.findByRole('button', { name: 'เพิ่มรูปแบบสินค้า' }))
  await user.type(screen.getByRole('textbox', { name: 'SKU' }), 'MANGO-500G')
  await user.type(screen.getByRole('textbox', { name: 'ชื่อรูปแบบ' }), 'ครึ่งกิโลกรัม')
  await user.type(screen.getByRole('textbox', { name: 'หน่วย' }), 'กิโลกรัม')
  await user.clear(screen.getByRole('textbox', { name: 'ราคา (บาท)' }))
  await user.type(screen.getByRole('textbox', { name: 'ราคา (บาท)' }), '99.90')
  await user.click(screen.getByRole('button', { name: 'บันทึกรูปแบบสินค้า' }))

  await waitFor(() => expect(createVariantSpy).toHaveBeenCalledWith(productId, expect.objectContaining({ sku: 'MANGO-500G', priceSatang: 9990 })))
})

test('blocks route navigation while a variant has unsaved changes', async () => {
  const user = userEvent.setup()
  stub('get', async () => detail)
  const { router } = renderCatalog(`/products/${productId}`)

  await user.click(await screen.findByRole('button', { name: 'เพิ่มรูปแบบสินค้า' }))
  await user.type(screen.getByRole('textbox', { name: 'SKU' }), 'MANGO-500G')
  await act(async () => { await router.navigate('/products') })

  expect(screen.getByRole('heading', { name: 'ยังไม่ได้บันทึกการเปลี่ยนแปลง' })).toBeTruthy()
  expect(router.state.location.pathname).toBe(`/products/${productId}`)
  await user.click(screen.getByRole('button', { name: 'อยู่หน้านี้ต่อ' }))
  await user.click(screen.getByRole('button', { name: 'ยกเลิก' }))
  expect(screen.getByRole('heading', { name: 'ทิ้งการเปลี่ยนแปลงรูปแบบสินค้า?' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'ทิ้งการเปลี่ยนแปลง', exact: true }))
  expect(router.state.location.pathname).toBe(`/products/${productId}`)
})

test('protects dirty variant edits from beforeunload and clears protection on discard', async () => {
  const user = userEvent.setup()
  stub('get', async () => detail)
  renderCatalog(`/products/${productId}`)

  await user.click(await screen.findByRole('button', { name: 'เพิ่มรูปแบบสินค้า' }))
  await user.type(screen.getByRole('textbox', { name: 'SKU' }), 'MANGO-500G')
  const dirtyEvent = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(dirtyEvent)
  expect(dirtyEvent.defaultPrevented).toBe(true)

  await user.click(screen.getByRole('button', { name: 'ยกเลิก' }))
  await user.click(await screen.findByRole('button', { name: 'ทิ้งการเปลี่ยนแปลง', exact: true }))
  const cleanEvent = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(cleanEvent)
  expect(cleanEvent.defaultPrevented).toBe(false)
})

test('clears variant dirty protection after a successful save', async () => {
  const user = userEvent.setup()
  stub('get', async () => detail)
  const createVariantSpy = stub('createVariant', async () => variant)
  renderCatalog(`/products/${productId}`)

  await user.click(await screen.findByRole('button', { name: 'เพิ่มรูปแบบสินค้า' }))
  await user.type(screen.getByRole('textbox', { name: 'SKU' }), 'MANGO-500G')
  await user.type(screen.getByRole('textbox', { name: 'ชื่อรูปแบบ' }), 'ครึ่งกิโลกรัม')
  await user.type(screen.getByRole('textbox', { name: 'หน่วย' }), 'กิโลกรัม')
  await user.type(screen.getByRole('textbox', { name: 'ราคา (บาท)' }), '99.90')
  const dirtyEvent = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(dirtyEvent)
  expect(dirtyEvent.defaultPrevented).toBe(true)

  await user.click(screen.getByRole('button', { name: 'บันทึกรูปแบบสินค้า' }))
  await waitFor(() => expect(createVariantSpy).toHaveBeenCalled())
  await waitFor(() => expect(screen.queryByRole('button', { name: 'บันทึกรูปแบบสินค้า' })).toBeNull())
  const cleanEvent = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(cleanEvent)
  expect(cleanEvent.defaultPrevented).toBe(false)
})

test('prevents archiving the final active variant of a published product', async () => {
  const published = { ...detail, status: 'published' as const, publishedAt: updatedAt }
  const onlyVariant = { ...variant, archivedAt: null }
  stub('get', async () => ({ ...published, variants: [onlyVariant] }))
  renderCatalog(`/products/${productId}`)

  await screen.findByText('MANGO-1KG')
  const archiveButton = screen.getByRole('button', { name: 'เก็บรูปแบบสินค้า MANGO-1KG' })
  expect((archiveButton as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('สินค้าที่เผยแพร่แล้วต้องมีรูปแบบที่ใช้งานได้อย่างน้อยหนึ่งรายการ')).toBeTruthy()
})

test('shows published product prerequisites and requires confirmation before unpublishing', async () => {
  const user = userEvent.setup()
  const published = { ...detail, status: 'published' as const, publishedAt: updatedAt }
  const unpublishSpy = stub('unpublish', async () => undefined)
  stub('get', async () => published)
  renderCatalog(`/products/${productId}`)

  await screen.findByText('รายละเอียด')
  expect(screen.getByRole('heading', { name: 'เงื่อนไขการเผยแพร่' })).toBeTruthy()
  expect(screen.getAllByText('คำอธิบาย').length).toBeGreaterThan(1)
  await user.click(screen.getByRole('button', { name: 'นำสินค้าออกจากการเผยแพร่' }))
  expect(await screen.findByRole('heading', { name: 'ยืนยันนำสินค้าออกจากการเผยแพร่' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'ยืนยันนำออกจากการเผยแพร่' }))
  await waitFor(() => expect(unpublishSpy).toHaveBeenCalledWith(productId))
})

test('publishes a complete draft only after staff confirms the action', async () => {
  const user = userEvent.setup()
  const publishSpy = stub('publish', async () => undefined)
  stub('get', async () => detail)
  renderCatalog(`/products/${productId}`)

  await screen.findByText('MANGO-1KG')
  const publishButton = screen.getByRole('button', { name: 'เผยแพร่สินค้า' })
  expect((publishButton as HTMLButtonElement).disabled).toBe(false)
  await user.click(publishButton)
  expect(await screen.findByRole('heading', { name: 'ยืนยันเผยแพร่สินค้า' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'ยืนยันเผยแพร่สินค้า', exact: true }))
  await waitFor(() => expect(publishSpy).toHaveBeenCalledWith(productId))
})

test('archives a product only after confirmation and returns to the catalog', async () => {
  const user = userEvent.setup()
  const archiveSpy = stub('archive', async () => undefined)
  stub('get', async () => detail)
  stub('list', async () => ({ items: [], nextCursor: null }))
  const { router } = renderCatalog(`/products/${productId}`)

  await screen.findByText('MANGO-1KG')
  await user.click(screen.getByRole('button', { name: 'เก็บสินค้า' }))
  expect(await screen.findByRole('heading', { name: 'ยืนยันเก็บสินค้า' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'ยืนยันเก็บสินค้า', exact: true }))
  await waitFor(() => expect(archiveSpy).toHaveBeenCalledWith(productId))
  await waitFor(() => expect(router.state.location.pathname).toBe('/products'))
})

test('updates variant fields while keeping its SKU immutable and out of the payload', async () => {
  const user = userEvent.setup()
  const updateVariantSpy = stub('updateVariant', async () => variant)
  stub('get', async () => detail)
  renderCatalog(`/products/${productId}`)

  await user.click(await screen.findByRole('button', { name: 'แก้ไขรูปแบบ MANGO-1KG' }))
  const sku = screen.getByRole('textbox', { name: 'SKU' }) as HTMLInputElement
  expect(sku.readOnly).toBe(true)
  await user.clear(screen.getByRole('textbox', { name: 'ราคา (บาท)' }))
  await user.type(screen.getByRole('textbox', { name: 'ราคา (บาท)' }), '199.00')
  await user.click(screen.getByRole('button', { name: 'บันทึกรูปแบบสินค้า' }))

  await waitFor(() => expect(updateVariantSpy).toHaveBeenCalledWith(productId, variantId, expect.objectContaining({ priceSatang: 19900 })))
  expect(updateVariantSpy.mock.calls[0]?.[2]).not.toHaveProperty('sku')
})

test('disables variant inputs while a save is pending', async () => {
  const user = userEvent.setup()
  let resolveUpdate: ((value: Variant) => void) | undefined
  stub('updateVariant', () => new Promise((resolve) => { resolveUpdate = resolve }))
  stub('get', async () => detail)
  renderCatalog(`/products/${productId}`)

  await user.click(await screen.findByRole('button', { name: 'แก้ไขรูปแบบ MANGO-1KG' }))
  await user.clear(screen.getByRole('textbox', { name: 'ราคา (บาท)' }))
  await user.type(screen.getByRole('textbox', { name: 'ราคา (บาท)' }), '199.00')
  await user.click(screen.getByRole('button', { name: 'บันทึกรูปแบบสินค้า' }))

  await waitFor(() => expect((screen.getByRole('textbox', { name: 'ราคา (บาท)' }) as HTMLInputElement).disabled).toBe(true))
  expect((screen.getByRole('textbox', { name: 'ชื่อรูปแบบ' }) as HTMLInputElement).disabled).toBe(true)
  expect(screen.getByRole('checkbox', { name: 'เปิดขายรูปแบบนี้' }).getAttribute('aria-disabled')).toBe('true')
  await act(async () => resolveUpdate?.(variant))
})

test('refreshes and shows the latest archived variant after a concurrent edit conflict', async () => {
  const user = userEvent.setup()
  const archived = { ...variant, archivedAt: updatedAt, name: 'เวอร์ชันล่าสุด' }
  const getSpy = stub('get', async () => detail)
  const updateSpy = stub('updateVariant', async () => { throw new ApiRequestError(409, 'VARIANT_STATE_CONFLICT', 'conflict') })
  getSpy.mockImplementationOnce(async () => detail).mockImplementationOnce(async () => ({ ...detail, variants: [archived] }))
  renderCatalog(`/products/${productId}`)

  await user.click(await screen.findByRole('button', { name: 'แก้ไขรูปแบบ MANGO-1KG' }))
  await user.clear(screen.getByRole('textbox', { name: 'ราคา (บาท)' }))
  await user.type(screen.getByRole('textbox', { name: 'ราคา (บาท)' }), '199.00')
  await user.click(screen.getByRole('button', { name: 'บันทึกรูปแบบสินค้า' }))

  expect((await screen.findAllByText('เวอร์ชันล่าสุด')).length).toBeGreaterThan(1)
  expect(screen.getByText('รูปแบบสินค้านี้ถูกเก็บถาวรแล้วบนเซิร์ฟเวอร์')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'บันทึกรูปแบบสินค้า' }) as HTMLButtonElement).disabled).toBe(true)
  expect(getSpy).toHaveBeenCalledTimes(2)
  expect(updateSpy).toHaveBeenCalledTimes(1)
  expect((screen.getByRole('textbox', { name: 'ราคา (บาท)' }) as HTMLInputElement).value).toBe('199.00')
})

test('blocks stale variant creation and shows current parent and variants after the product is archived', async () => {
  const user = userEvent.setup()
  const archivedProduct = { ...detail, status: 'archived' as const, archivedAt: updatedAt, variants: [{ ...variant, name: 'รูปแบบล่าสุดจากเซิร์ฟเวอร์' }] }
  const getSpy = stub('get', async () => detail)
  const createSpy = stub('createVariant', async () => { throw new ApiRequestError(409, 'PRODUCT_STATE_CONFLICT', 'conflict') })
  getSpy.mockImplementationOnce(async () => detail).mockImplementationOnce(async () => archivedProduct)
  renderCatalog(`/products/${productId}`)

  await user.click(await screen.findByRole('button', { name: 'เพิ่มรูปแบบสินค้า' }))
  await user.type(screen.getByRole('textbox', { name: 'SKU' }), 'MANGO-500G')
  await user.type(screen.getByRole('textbox', { name: 'ชื่อรูปแบบ' }), 'ครึ่งกิโลกรัม')
  await user.type(screen.getByRole('textbox', { name: 'หน่วย' }), 'กิโลกรัม')
  await user.type(screen.getByRole('textbox', { name: 'ราคา (บาท)' }), '99.90')
  await user.click(screen.getByRole('button', { name: 'บันทึกรูปแบบสินค้า' }))

  expect(await screen.findByText('สินค้านี้ถูกเก็บถาวรแล้วบนเซิร์ฟเวอร์')).toBeTruthy()
  expect(screen.getByText('รูปแบบล่าสุดจากเซิร์ฟเวอร์')).toBeTruthy()
  expect((screen.getByRole('textbox', { name: 'ชื่อรูปแบบ' }) as HTMLInputElement).value).toBe('ครึ่งกิโลกรัม')
  expect((screen.getByRole('button', { name: 'บันทึกรูปแบบสินค้า' }) as HTMLButtonElement).disabled).toBe(true)
  expect(createSpy).toHaveBeenCalledTimes(1)
})

test('explains an SKU conflict and allows a create retry only after reviewing current variants', async () => {
  const user = userEvent.setup()
  const latest = { ...detail, variants: [{ ...variant, sku: 'MANGO-500G', name: 'ครึ่งกิโลกรัมที่มีอยู่แล้ว' }] }
  const getSpy = stub('get', async () => detail)
  const createSpy = stub('createVariant', async () => variant)
  createSpy.mockImplementationOnce(async () => { throw new ApiRequestError(409, 'SKU_CONFLICT', 'conflict') })
  let resolveRefresh: ((value: ProductDetail) => void) | undefined
  getSpy.mockImplementationOnce(async () => detail).mockImplementationOnce(async () => latest).mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve }))
  renderCatalog(`/products/${productId}`)

  await user.click(await screen.findByRole('button', { name: 'เพิ่มรูปแบบสินค้า' }))
  await user.type(screen.getByRole('textbox', { name: 'SKU' }), 'MANGO-500G')
  await user.type(screen.getByRole('textbox', { name: 'ชื่อรูปแบบ' }), 'ครึ่งกิโลกรัม')
  await user.type(screen.getByRole('textbox', { name: 'หน่วย' }), 'กิโลกรัม')
  await user.type(screen.getByRole('textbox', { name: 'ราคา (บาท)' }), '99.90')
  await user.click(screen.getByRole('button', { name: 'บันทึกรูปแบบสินค้า' }))

  expect(await screen.findByText('SKU นี้ถูกใช้งานแล้ว')).toBeTruthy()
  expect(screen.getByText('ครึ่งกิโลกรัมที่มีอยู่แล้ว')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'บันทึกรูปแบบสินค้า' }) as HTMLButtonElement).disabled).toBe(true)
  expect(createSpy).toHaveBeenCalledTimes(1)
  expect((screen.getByRole('textbox', { name: 'SKU' }) as HTMLInputElement).value).toBe('MANGO-500G')

  await user.click(screen.getByRole('button', { name: 'ตรวจสอบแล้ว ใช้ร่างเดิม' }))
  await user.clear(screen.getByRole('textbox', { name: 'SKU' }))
  await user.type(screen.getByRole('textbox', { name: 'SKU' }), 'MANGO-250G')
  await user.click(screen.getByRole('button', { name: 'โหลดข้อมูลล่าสุด' }))
  await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(3))
  expect((screen.getByRole('button', { name: 'บันทึกรูปแบบสินค้า' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'ตรวจสอบแล้ว ใช้ร่างเดิม' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => resolveRefresh?.(latest))
  expect((screen.getByRole('button', { name: 'บันทึกรูปแบบสินค้า' }) as HTMLButtonElement).disabled).toBe(true)
  await user.click(screen.getByRole('button', { name: 'ตรวจสอบแล้ว ใช้ร่างเดิม' }))
  await user.click(screen.getByRole('button', { name: 'บันทึกรูปแบบสินค้า' }))

  await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(2))
  expect(createSpy.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ sku: 'MANGO-250G', priceSatang: 9990 }))
})

test('keeps a create draft blocked after refresh failure and recovers after retrying the refresh', async () => {
  const user = userEvent.setup()
  const getSpy = stub('get', async () => detail)
  const createSpy = stub('createVariant', async () => variant)
  createSpy.mockImplementationOnce(async () => { throw new ApiRequestError(409, 'VARIANT_STATE_CONFLICT', 'conflict') })
  getSpy.mockImplementationOnce(async () => detail).mockRejectedValueOnce(new Error('refresh failed')).mockImplementationOnce(async () => detail)
  renderCatalog(`/products/${productId}`)

  await user.click(await screen.findByRole('button', { name: 'เพิ่มรูปแบบสินค้า' }))
  await user.type(screen.getByRole('textbox', { name: 'SKU' }), 'MANGO-500G')
  await user.type(screen.getByRole('textbox', { name: 'ชื่อรูปแบบ' }), 'ครึ่งกิโลกรัม')
  await user.type(screen.getByRole('textbox', { name: 'หน่วย' }), 'กิโลกรัม')
  await user.type(screen.getByRole('textbox', { name: 'ราคา (บาท)' }), '99.90')
  await user.click(screen.getByRole('button', { name: 'บันทึกรูปแบบสินค้า' }))

  expect(await screen.findByText('โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณาลองโหลดอีกครั้งก่อนบันทึก')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'บันทึกรูปแบบสินค้า' }) as HTMLButtonElement).disabled).toBe(true)
  expect(createSpy).toHaveBeenCalledTimes(1)
  expect((screen.getByRole('textbox', { name: 'SKU' }) as HTMLInputElement).value).toBe('MANGO-500G')

  await user.click(screen.getByRole('button', { name: 'โหลดข้อมูลล่าสุด' }))
  expect(await screen.findByRole('button', { name: 'ตรวจสอบแล้ว ใช้ร่างเดิม' })).toBeTruthy()
  expect((screen.getByRole('textbox', { name: 'ชื่อรูปแบบ' }) as HTMLInputElement).value).toBe('ครึ่งกิโลกรัม')
  await user.click(screen.getByRole('button', { name: 'ตรวจสอบแล้ว ใช้ร่างเดิม' }))
  await user.click(screen.getByRole('button', { name: 'บันทึกรูปแบบสินค้า' }))

  await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(2))
})

test('blocks variant edits when the latest product state is archived', async () => {
  const user = userEvent.setup()
  const archivedProduct = { ...detail, status: 'archived' as const, archivedAt: updatedAt, variants: [{ ...variant, name: 'ชื่อรูปแบบล่าสุด' }] }
  const getSpy = stub('get', async () => detail)
  const updateSpy = stub('updateVariant', async () => { throw new ApiRequestError(409, 'VARIANT_STATE_CONFLICT', 'conflict') })
  getSpy.mockImplementationOnce(async () => detail).mockImplementationOnce(async () => archivedProduct)
  renderCatalog(`/products/${productId}`)

  await user.click(await screen.findByRole('button', { name: 'แก้ไขรูปแบบ MANGO-1KG' }))
  await user.clear(screen.getByRole('textbox', { name: 'ราคา (บาท)' }))
  await user.type(screen.getByRole('textbox', { name: 'ราคา (บาท)' }), '199.00')
  await user.click(screen.getByRole('button', { name: 'บันทึกรูปแบบสินค้า' }))

  expect(await screen.findByText('สินค้านี้ถูกเก็บถาวรแล้วบนเซิร์ฟเวอร์')).toBeTruthy()
  expect((await screen.findAllByText('ชื่อรูปแบบล่าสุด')).length).toBeGreaterThan(1)
  expect((screen.getByRole('textbox', { name: 'ราคา (บาท)' }) as HTMLInputElement).value).toBe('199.00')
  expect((screen.getByRole('button', { name: 'บันทึกรูปแบบสินค้า' }) as HTMLButtonElement).disabled).toBe(true)
  expect(updateSpy).toHaveBeenCalledTimes(1)
})

test('archives a nonfinal active variant only after confirmation', async () => {
  const user = userEvent.setup()
  const archiveVariantSpy = stub('archiveVariant', async () => undefined)
  stub('get', async () => detail)
  renderCatalog(`/products/${productId}`)

  await user.click(await screen.findByRole('button', { name: 'เก็บรูปแบบสินค้า MANGO-1KG' }))
  expect(await screen.findByRole('heading', { name: 'ยืนยันเก็บรูปแบบสินค้า' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'เก็บรูปแบบสินค้า', exact: true }))
  await waitFor(() => expect(archiveVariantSpy).toHaveBeenCalledWith(productId, variantId))
})

test('distinguishes archived variants and does not offer their edit action', async () => {
  stub('get', async () => ({ ...detail, variants: [{ ...variant, archivedAt: updatedAt }] }))
  renderCatalog(`/products/${productId}`)

  await screen.findByText('MANGO-1KG')
  expect(screen.getByText('เก็บถาวร')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'แก้ไขรูปแบบ MANGO-1KG' })).toBeNull()
})

test('shows a fallback image when a product image cannot load', async () => {
  stub('get', async () => detail)
  renderCatalog(`/products/${productId}`)

  const image = await screen.findByRole('img', { name: 'ผลมะม่วงน้ำดอกไม้' })
  fireEvent.error(image)
  expect(await screen.findByRole('img', { name: 'โหลดรูปภาพไม่ได้' })).toBeTruthy()
})

test('keeps fulfillment catalog access read-only, including product and variant actions', async () => {
  stub('get', async () => detail)
  renderCatalog(`/products/${productId}`, ['catalog:read'])

  await screen.findByText('MANGO-1KG')
  expect(screen.queryByRole('button', { name: /แก้ไขสินค้า|บันทึกสินค้า|เพิ่มรูปแบบสินค้า|เผยแพร่|เก็บถาวร/i })).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.getByText('฿189.00')).toBeTruthy()
})

test('shows a safe not-found state with a route back to the catalog', async () => {
  stub('get', async () => { throw new ApiRequestError(404, 'PRODUCT_NOT_FOUND', 'not found') })
  renderCatalog(`/products/${productId}`)

  expect(await screen.findByRole('heading', { name: 'ไม่พบสินค้า' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'กลับไปหน้าสินค้า' })).toBeTruthy()
})

test('rejects malformed product IDs before requesting product details', async () => {
  const getSpy = stub('get', async () => detail)
  renderCatalog('/products/not-a-uuid')

  expect(await screen.findByRole('heading', { name: 'รหัสสินค้าไม่ถูกต้อง' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'กลับไปหน้าสินค้า' })).toBeTruthy()
  expect(getSpy).not.toHaveBeenCalled()
})
