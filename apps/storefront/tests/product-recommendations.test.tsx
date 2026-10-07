import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ProductRecommendations } from '../src/components/product-recommendations'
import type { StoreProductSummary } from '../src/lib/store-products'

const originalMatchMedia = window.matchMedia
const products: StoreProductSummary[] = Array.from({ length: 10 }, (_, index) => ({
  id: `product-${index}`, slug: `product-${index}`, name: `Product ${index}`,
  englishName: null, category: 'fresh', imageUrl: null, imageAlt: null,
  minPriceSatang: 1000, canPurchase: true,
}))

function show(width: number, portrait = false) {
  window.matchMedia = ((query: string) => ({
    matches: !portrait && width >= (query.includes('1280') ? 1280 : 1024),
    media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true,
  })) as typeof window.matchMedia
  render(<MemoryRouter><ProductRecommendations products={products} label="สินค้าแนะนำ" /></MemoryRouter>)
  return screen.getByRole('region', { name: 'สินค้าแนะนำ' })
}

afterEach(() => { cleanup(); window.matchMedia = originalMatchMedia })

test('large landscape recommendations show at most eight cards with no carousel controls', () => {
  const region = show(1440)
  expect(within(region).getAllByRole('article')).toHaveLength(8)
  expect(within(region).queryByRole('button', { name: 'สินค้าถัดไป' })).toBeNull()
})

test('medium landscape recommendations cap the grid at six cards', () => {
  expect(within(show(1100)).getAllByRole('article')).toHaveLength(6)
})

for (const [name, width] of [['mobile', 390], ['portrait tablet', 1100]] as const) {
  test(`${name} uses a carousel with up to eight cards`, () => {
    const region = show(width, true)
    expect(region.getAttribute('aria-roledescription')).toBe('carousel')
    expect(within(region).getAllByRole('article')).toHaveLength(8)
    expect(within(region).getByRole('button', { name: 'สินค้าถัดไป' })).toBeTruthy()
  })
}
