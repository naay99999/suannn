import { afterEach, expect, test } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { ProductGallery } from '../src/pages/products/_components/product-gallery'
import type { StoreProductDetail } from '../src/lib/store-products'

const image = (n: number, alt: string | null = `Mango ${n}`) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  url: `https://cdn.example.com/m${n}/full.webp`,
  thumbUrl: `https://cdn.example.com/m${n}/thumb.webp`,
  alt, width: 1600, height: 1200,
})
const product = (images: StoreProductDetail['images']) => ({
  id: 'p1', slug: 'mango', name: 'Test mango', images,
}) as StoreProductDetail

afterEach(cleanup)

test('renders every gallery image in order with thumbnails', () => {
  const { container } = render(<ProductGallery product={product([image(1), image(2), image(3)])} />)
  const slides = container.querySelectorAll('.swiper-slide')
  expect(slides).toHaveLength(3)
  const mains = [...slides].map(slide => slide.querySelector('img')!.getAttribute('src'))
  expect(mains).toEqual([1, 2, 3].map(n => `https://cdn.example.com/m${n}/full.webp`))
  const thumbs = [...container.querySelectorAll('button[aria-label^="แสดงภาพที่"] img')]
  expect(thumbs).toHaveLength(3)
  for (const thumb of thumbs) expect(thumb.getAttribute('src')!.endsWith('thumb.webp')).toBe(true)
  expect(slides[0]!.querySelector('img')!.getAttribute('width')).toBe('1600')
})

test('falls back to product name for missing alt', () => {
  const { container } = render(<ProductGallery product={product([image(1, null)])} />)
  expect(container.querySelector('.swiper-slide img')!.getAttribute('alt')).toBe('Test mango')
})
