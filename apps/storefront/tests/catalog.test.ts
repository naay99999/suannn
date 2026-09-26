import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { products, filterProducts, readCatalogFilters } from '../src/lib/catalog'

const select = (query: string) => filterProducts(new URLSearchParams(query))

describe('mock catalog', () => {
  test('provides six unique products with stable existing IDs', () => {
    expect(products).toHaveLength(6)
    expect(new Set(products.map(product => product.id)).size).toBe(6)
    expect(products.map(product => product.id)).toEqual(expect.arrayContaining(['mango', 'orange', 'avocado', 'dried-mango']))
    expect(select('category=fresh')).toHaveLength(3)
    expect(select('category=processed')).toHaveLength(3)
  })
  test('combines Thai search, category and availability', () => {
    expect(select('q=มะม่วง&category=processed&availability=in-season').map(product => product.id)).toEqual(['dried-mango'])
    expect(select('q=มะม่วง&category=processed&availability=coming-soon')).toHaveLength(0)
  })
  test('handles empty searches and unmatched text', () => {
    expect(select('q=%20%20')).toHaveLength(6)
    expect(select('q=missing-product')).toHaveLength(0)
    expect(select('q=SUNSHINE')[0]?.id).toBe('mango')
  })
  test('invalid URL values fall back to the default catalog', () => {
    expect(readCatalogFilters(new URLSearchParams('category=unknown&availability=unknown&sort=unknown'))).toEqual({ q: '', category: 'all', availability: 'all', sort: 'recommended' })
    expect(select('category=unknown&availability=unknown&sort=unknown')).toEqual(products)
  })
  test('sorts prices without mutating recommendation order', () => {
    const original = products.map(product => product.id)
    expect(select('sort=price-asc').map(product => product.price)).toEqual([89, 99, 119, 129, 139, 159])
    expect(select('sort=price-desc').map(product => product.price)).toEqual([159, 139, 129, 119, 99, 89])
    expect(select('').map(product => product.id)).toEqual(original)
  })
})

describe('product galleries', () => {
  test('provides three distinct illustrated images with accessible descriptions for every product', () => {
    for (const product of products) {
      expect(product.images).toHaveLength(3)
      expect(new Set(product.images.map(image => image.src)).size).toBe(product.images.length)
      for (const image of product.images) {
        expect(image.alt.trim()).not.toBe('')
        expect(image.caption.trim()).not.toBe('')
        expect(existsSync(new URL(`../public${image.src}`, import.meta.url))).toBe(true)
        if (image.thumbnailSrc) {
          expect(existsSync(new URL(`../public${image.thumbnailSrc}`, import.meta.url))).toBe(true)
        }
      }
    }
  })
})
