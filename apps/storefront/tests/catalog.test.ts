import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'bun:test'
import { MemoryRouter } from 'react-router'
import * as catalog from '../src/lib/catalog'
import { ProductCard } from '../src/components/product-card'
import { ProductGalleryImage } from '../src/pages/products/_components/product-gallery-image'

describe('store catalog filters', () => {
  test('maps URL filters to only supported product API query fields', () => {
    expect(catalog.readCatalogFilters(new URLSearchParams('category=fresh&availability=unknown&cursor=old&sort=unknown')))
      .toEqual({ category: 'fresh', sort: undefined })
  })

  test('filter change resets the current pagination cursor', () => {
    expect(catalog.updateCatalogParams).toBeFunction()
    if (typeof catalog.updateCatalogParams !== 'function') return

    const next = catalog.updateCatalogParams(new URLSearchParams('category=fresh&cursor=page-2'), 'category', 'processed')
    expect(next.get('category')).toBe('processed')
    expect(next.has('cursor')).toBe(false)
  })
})

describe('API product fallbacks and URLs', () => {
  test('renders a neutral fallback when a product image is missing', () => {
    const html = renderToStaticMarkup(createElement(ProductGalleryImage, {
      src: '',
      alt: 'Mango product',
      failed: false,
      onImageError: () => undefined,
    }))

    expect(html).toContain('role="img"')
    expect(html).toContain('Mango product')
    expect(html).not.toContain('<img')
  })

  test('links product cards with the API slug', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(ProductCard, {
        product: {
          id: 'server-id',
          slug: 'mango-from-the-garden',
          name: 'Mango',
          englishName: null,
          category: 'fresh',
          imageUrl: null,
          imageAlt: null,
          minPriceSatang: 12000,
          canPurchase: true,
          images: [{ src: '', alt: 'Mango', caption: '' }],
          price: 120,
          unit: 'kg',
          availability: 'in-season',
          categoryLabel: 'ผลไม้สด',
        } as never,
      }),
    ))

    expect(html).toContain('href="/products/mango-from-the-garden"')
  })
})
