import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProductInformation } from '../src/pages/products/_components/product-information'
import { formatStorePrice, readStoreCategorySlug, storeProductDetailQueryKey, storeProductQueryKey } from '../src/lib/store-products'

describe('store product API helpers', () => {
  test('rejects category slugs that are not supported by the API', () => {
    expect(readStoreCategorySlug('fresh')).toBe('fresh')
    expect(readStoreCategorySlug('orchard')).toBeUndefined()
    expect(readStoreCategorySlug(undefined)).toBeUndefined()
  })

  test('builds stable query keys from server filters and slug', () => {
    expect(storeProductQueryKey({ category: 'fresh', limit: 4 })).toEqual(['store-products', { category: 'fresh', limit: 4 }])
    expect(storeProductDetailQueryKey('mango')).toEqual(['store-product', 'mango'])
  })

  test('formats API satang as Thai baht', () => {
    expect(formatStorePrice(12550)).toBe('฿125.50')
  })

  test('renders no invented information when API descriptions are absent', () => {
    const html = renderToStaticMarkup(createElement(ProductInformation, {
      product: {
        description: null,
        originStory: null,
        storageInstructions: null,
      } as never,
    }))

    expect(html).toBe('')
    expect(html).not.toContain('ฟาร์ม')
    expect(html).not.toContain('ฤดูกาล')
  })
})
