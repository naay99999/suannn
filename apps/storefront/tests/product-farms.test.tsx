import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { ReactNode } from 'react'
import { ProductFarms } from '../src/components/farms/product-farms'
import { FarmGrowerCarousel } from '../src/pages/farms/_components/farm-grower-carousel'
import type { StoreProductDetail } from '../src/lib/store-products'
import type { StoreFarmSummary } from '../src/lib/store-farms'

const farms: StoreFarmSummary[] = [
  { id: 'farm-1', slug: 'mae-rim', name: 'สวนแม่ริม', farmerName: 'คุณใจดี', province: 'เชียงใหม่', district: 'แม่ริม', summary: 'สวนผลไม้', coverImageUrl: null, coverImageAlt: null, isDemo: false },
  { id: 'farm-2', slug: 'lamphun', name: 'สวนลำพูน', farmerName: null, province: 'ลำพูน', district: null, summary: null, coverImageUrl: null, coverImageAlt: null, isDemo: true },
]

afterEach(cleanup)

function mount(element: ReactNode) {
  const router = createMemoryRouter([{ path: '*', element }], { initialEntries: ['/'] })
  render(<RouterProvider router={router} />)
  return router
}

test('product provenance links each contributing farm without claiming lot-level origin', () => {
  const product = { farms: farms.map((farm, displayOrder) => ({ ...farm, displayOrder })) } as StoreProductDetail
  mount(<ProductFarms farms={product.farms} />)
  expect(screen.getByRole('heading', { name: 'แหล่งผลิตของสินค้านี้' })).toBeTruthy()
  expect(screen.getByRole('link', { name: /สวนแม่ริม/ }).getAttribute('href')).toBe('/farms/mae-rim')
  expect(screen.getByRole('link', { name: /สวนลำพูน/ }).getAttribute('href')).toBe('/farms/lamphun')
  expect(screen.getByText(/ยังไม่ระบุสวนของล็อตที่จัดส่ง/)).toBeTruthy()
})

test('grower carousel supports manual controls and opens the selected profile', async () => {
  mount(<FarmGrowerCarousel farms={farms} />)
  expect(screen.getByRole('heading', { name: 'สวนแม่ริม' })).toBeTruthy()
  await userEvent.setup().click(screen.getByRole('button', { name: 'สวนถัดไป' }))
  expect(screen.getByRole('heading', { name: 'สวนลำพูน' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'อ่านเรื่องราวของสวน' }).getAttribute('href')).toBe('/farms/lamphun')
})
