import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ProductCard } from '../src/components/product-card'
import type { StoreProductSummary } from '../src/lib/store-products'

const base: StoreProductSummary = {
  id: 'p1', slug: 'mango', name: 'Mango', englishName: null, category: 'fresh',
  coverImage: null, minPriceSatang: 1000, canPurchase: true,
}

afterEach(cleanup)

test('uses the cover thumb', () => {
  const coverImage = { id: 'i1', url: 'https://cdn.example.com/i1/full.webp', thumbUrl: 'https://cdn.example.com/i1/thumb.webp', alt: 'Cover alt', width: 800, height: 600 }
  render(<MemoryRouter><ProductCard product={{ ...base, coverImage }} /></MemoryRouter>)
  const img = screen.getByRole('img', { name: 'Cover alt' })
  expect(img.getAttribute('src')).toBe(coverImage.thumbUrl)
  expect(img.getAttribute('width')).toBe('800')
})

test('renders the placeholder when coverImage is null', () => {
  render(<MemoryRouter><ProductCard product={base} /></MemoryRouter>)
  expect(screen.getByText('ไม่มีรูปสินค้า')).toBeTruthy()
  expect(document.querySelector('article img')).toBeNull()
})
