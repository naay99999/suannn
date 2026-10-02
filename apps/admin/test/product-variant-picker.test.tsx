import { afterEach, expect, spyOn, test } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProductVariantPicker } from '../src/components/product-variant-picker'
import { catalogApi, type ProductDetail, type ProductSummary } from '../src/lib/catalog/api'
import type { VariantSelection } from '../src/components/product-variant-picker'

const productId = '00000000-0000-4000-8000-000000000010'
const variantId = '00000000-0000-4000-8000-000000000020'
const date = new Date('2026-09-01T08:00:00.000Z')
const product: ProductSummary = {
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
}
const detail: ProductDetail = {
  ...product,
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
      createdAt: date,
      updatedAt: date,
      archivedAt: null,
    },
    {
      id: '00000000-0000-4000-8000-000000000021',
      productId,
      sku: 'MANGO-OLD',
      name: 'แบบเก็บถาวร',
      unit: 'ชิ้น',
      priceSatang: 10000,
      salesEnabled: false,
      displayOrder: 1,
      minRemainingShelfLifeDays: 0,
      createdAt: date,
      updatedAt: date,
      archivedAt: date,
    },
  ],
}

const activeSpies: Array<{ mockRestore: () => void }> = []

function renderPicker(onChange: (value: VariantSelection | null) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={queryClient}><ProductVariantPicker onChange={onChange} value={null} /></QueryClientProvider>)
}

afterEach(() => {
  cleanup()
  activeSpies.splice(0).forEach((spy) => spy.mockRestore())
})

test('searches products first, loads only the selected detail, and supports keyboard selection', async () => {
  const listSpy = spyOn(catalogApi, 'list').mockResolvedValue({ items: [product], nextCursor: null })
  const detailSpy = spyOn(catalogApi, 'get').mockResolvedValue(detail)
  activeSpies.push(listSpy, detailSpy)
  const onChange = spyOn({ onChange: (_value: VariantSelection | null) => undefined }, 'onChange')
  const user = userEvent.setup()
  renderPicker(onChange)

  const search = await screen.findByRole('searchbox', { name: 'ค้นหาสินค้าเพื่อเลือกสต็อก' })
  await user.type(search, 'มะม่วง')
  await new Promise((resolve) => setTimeout(resolve, 320))
  await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'มะม่วง', limit: 25 })))

  await user.tab()
  await user.keyboard('{Enter}')
  await waitFor(() => expect(detailSpy).toHaveBeenCalledTimes(1))
  expect(detailSpy).toHaveBeenCalledWith(productId)
  expect(await screen.findByRole('button', { name: /MANGO-1KG/ })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /MANGO-OLD/ })).toBeNull()
  await user.tab()
  await user.keyboard('{Enter}')

  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ productId, variant: detail.variants[0], productName: product.name }))
  expect(detailSpy).toHaveBeenCalledTimes(1)
})

test('loads another catalog search page only when requested', async () => {
  const nextProduct = { ...product, id: '00000000-0000-4000-8000-000000000011', name: 'มะม่วงแก้ว' }
  const listSpy = spyOn(catalogApi, 'list').mockImplementation(async (query) => query?.cursor
    ? { items: [nextProduct], nextCursor: null }
    : { items: [product], nextCursor: 'catalog-cursor' })
  activeSpies.push(listSpy)
  renderPicker(() => undefined)

  const user = userEvent.setup()
  await user.type(screen.getByRole('searchbox', { name: 'ค้นหาสินค้าเพื่อเลือกสต็อก' }), 'มะม่วง')
  await new Promise((resolve) => setTimeout(resolve, 320))
  await screen.findByRole('button', { name: /มะม่วงน้ำดอกไม้/ })
  await user.click(screen.getByRole('button', { name: 'โหลดสินค้าเพิ่มเติม' }))

  await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 25, cursor: 'catalog-cursor' })))
  expect(await screen.findByRole('button', { name: /มะม่วงแก้ว/ })).toBeTruthy()
})
