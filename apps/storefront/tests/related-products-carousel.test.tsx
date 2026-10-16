import { afterEach, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Swiper as SwiperInstance } from 'swiper'
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

test('navigation follows the swiper position and reaches the last card', () => {
  render(<MemoryRouter><RelatedProductsCarousel products={products} /></MemoryRouter>)
  const container = screen.getByLabelText('เลื่อนดูสินค้า')
  const swiper = (container.querySelector('.swiper') as HTMLElement & { swiper: SwiperInstance }).swiper
  const moves: string[] = []
  swiper.slideNext = () => { moves.push('next'); return true }
  swiper.slidePrev = () => { moves.push('prev'); return true }
  const next = screen.getByRole('button', { name: 'สินค้าถัดไป' })
  const previous = screen.getByRole('button', { name: 'สินค้าก่อนหน้า' })

  act(() => {
    Object.assign(swiper, { isLocked: false, isBeginning: true, isEnd: false, activeIndex: 0 })
    swiper.emit('slideChange')
  })
  fireEvent.click(next)
  fireEvent.keyDown(container, { key: 'ArrowRight' })
  expect(moves).toEqual(['next', 'next'])
  expect(previous.hasAttribute('disabled')).toBe(true)

  act(() => {
    Object.assign(swiper, { isBeginning: false, isEnd: true, activeIndex: 4 })
    swiper.emit('slideChange')
  })
  expect(screen.getByText('8 / 8')).toBeTruthy()
  expect(next.hasAttribute('disabled')).toBe(true)
  fireEvent.click(previous)
  expect(moves).toEqual(['next', 'next', 'prev'])
})
