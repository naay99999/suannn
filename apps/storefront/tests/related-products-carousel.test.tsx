import { afterEach, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { RelatedProductsCarousel } from '../src/pages/products/_components/related-products-carousel'
import type { StoreProductSummary } from '../src/lib/store-products'

const products: StoreProductSummary[] = Array.from({ length: 8 }, (_, index) => ({
  id: `related-${index}`, slug: `related-${index}`, name: `Related ${index}`,
  englishName: null, category: 'fresh', imageUrl: null, imageAlt: null,
  minPriceSatang: 1000, canPurchase: true,
}))

afterEach(cleanup)

test('related products always keep every recommendation in a carousel with navigation', () => {
  render(<MemoryRouter><RelatedProductsCarousel products={products} /></MemoryRouter>)
  const region = screen.getByRole('region', { name: 'สินค้าอื่นที่น่าสนใจ' })
  expect(region.getAttribute('aria-roledescription')).toBe('carousel')
  expect(within(region).getAllByRole('article')).toHaveLength(8)
  expect(within(region).getAllByRole('group')).toHaveLength(8)
  expect(within(region).getByRole('button', { name: 'สินค้าถัดไป' })).toBeTruthy()
  expect(within(region).getByRole('button', { name: 'สินค้าก่อนหน้า' }).hasAttribute('disabled')).toBe(true)
})

test('an empty related list does not render navigation or an empty carousel', () => {
  render(<MemoryRouter><RelatedProductsCarousel products={[]} /></MemoryRouter>)
  expect(screen.queryByRole('region')).toBeNull()
})

test('desktop navigation reaches the last four cards and allows scrolling back', () => {
  render(<MemoryRouter><RelatedProductsCarousel products={products} /></MemoryRouter>)
  const track = screen.getByLabelText('เลื่อนดูสินค้า')
  Object.defineProperties(track, {
    clientWidth: { value: 1200 },
    scrollWidth: { value: 2400 },
  })
  Array.from(track.children).forEach((child, index) => {
    Object.defineProperty(child, 'offsetLeft', { value: index * 300 })
  })
  track.scrollTo = ((options: ScrollToOptions) => {
    track.scrollLeft = options.left ?? 0
    fireEvent.scroll(track)
  }) as typeof track.scrollTo
  fireEvent.scroll(track)
  const next = screen.getByRole('button', { name: 'สินค้าถัดไป' })
  for (let index = 0; index < 4; index++) fireEvent.click(next)
  expect(track.scrollLeft).toBe(1200)
  expect(next.hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'สินค้าก่อนหน้า' }))
  expect(track.scrollLeft).toBe(900)
  expect(next.hasAttribute('disabled')).toBe(false)
})
