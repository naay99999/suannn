import { describe, expect, it } from 'bun:test'
import { buildCatalogFeed, formatFeedPrice } from '../../src/modules/catalog-feed/items'
import type { CatalogFeedInput, CatalogVariantRow } from '../../src/modules/catalog-feed/types'

const row = (overrides: Partial<CatalogVariantRow> = {}): CatalogVariantRow => ({
  productId: 'p1',
  slug: 'mango',
  productName: 'มะม่วง',
  description: 'หวานฉ่ำ',
  category: 'fresh',
  variantId: 'v1',
  variantName: '1 กก.',
  priceSatang: 12000,
  salesEnabled: true,
  sellable: true,
  images: [{ url: 'https://img.test/a.webp', alt: 'mango' }],
  ...overrides,
})

const input = (rows: CatalogVariantRow[], overrides: Partial<CatalogFeedInput> = {}): CatalogFeedInput => ({
  rows,
  storefrontUrl: 'https://shop.test',
  brandName: 'suannn',
  shippingFeeSatang: 5000,
  checkoutEnabled: true,
  ...overrides,
})

describe('formatFeedPrice', () => {
  it('formats satang', () => {
    expect(formatFeedPrice(5)).toBe('0.05 THB')
    expect(formatFeedPrice(100)).toBe('1.00 THB')
    expect(formatFeedPrice(12345)).toBe('123.45 THB')
    expect(formatFeedPrice(0)).toBe('0.00 THB')
  })
})

describe('buildCatalogFeed', () => {
  it('derives availability from sellable, salesEnabled and checkoutEnabled', () => {
    expect(buildCatalogFeed(input([row()])).items[0]!.availability).toBe('in_stock')
    expect(buildCatalogFeed(input([row({ sellable: false })])).items[0]!.availability).toBe('out_of_stock')
    expect(buildCatalogFeed(input([row({ salesEnabled: false })])).items[0]!.availability).toBe('out_of_stock')
    expect(buildCatalogFeed(input([row()], { checkoutEnabled: false })).items[0]!.availability).toBe('out_of_stock')
  })

  it('warns when checkout is disabled', () => {
    const feed = buildCatalogFeed(input([row(), row({ variantId: 'v2' })], { checkoutEnabled: false }))
    expect(feed.items.every((i) => i.availability === 'out_of_stock')).toBe(true)
    expect(feed.warnings).toContain('checkout_disabled')
  })

  it('marks every item out of stock when the shipping fee is unset', () => {
    const feed = buildCatalogFeed(input([row(), row({ variantId: 'v2' })], { shippingFeeSatang: null }))
    expect(feed.items.every((i) => i.availability === 'out_of_stock')).toBe(true)
    expect(feed.counts.inStock).toBe(0)
    expect(feed.warnings).toContain('shipping_fee_unset')
  })

  it('warns when no item is in the feed', () => {
    const empty = buildCatalogFeed(input([row({ images: [] })]))
    expect(empty.counts).toMatchObject({ total: 1, inFeed: 0 })
    expect(empty.warnings).toContain('no_items_in_feed')
    expect(buildCatalogFeed(input([])).warnings).not.toContain('no_items_in_feed')
    expect(buildCatalogFeed(input([row()])).warnings).not.toContain('no_items_in_feed')
  })

  it('handles shipping', () => {
    const none = buildCatalogFeed(input([row()], { shippingFeeSatang: null }))
    expect(none.shipping).toBeNull()
    expect(none.warnings).toContain('shipping_fee_unset')
    const some = buildCatalogFeed(input([row()]))
    expect(some.shipping).toEqual({ country: 'TH', price: '50.00 THB' })
    expect(some.warnings).toEqual([])
  })

  it('excludes variants without images even when sales are disabled', () => {
    const feed = buildCatalogFeed(input([row({ images: [], salesEnabled: false, description: null })]))
    expect(feed.items).toEqual([])
    expect(feed.problems).toHaveLength(1)
    expect(feed.problems[0]).toMatchObject({ code: 'no_image', excluded: true, productId: 'p1', variantId: 'v1' })
    expect(feed.counts.excluded).toBe(1)
  })

  it('builds link and title', () => {
    const item = buildCatalogFeed(input([row()])).items[0]!
    expect(item.link).toBe('https://shop.test/products/mango?variant=v1')
    expect(item.title).toBe('มะม่วง 1 กก.')
    expect(item.id).toBe('v1')
    expect(item.itemGroupId).toBe('p1')
    expect(item.price).toBe('120.00 THB')
  })

  it('does not double slashes in link', () => {
    const item = buildCatalogFeed(input([row()], { storefrontUrl: 'https://shop.test/' })).items[0]!
    expect(item.link).toBe('https://shop.test/products/mango?variant=v1')
  })

  it('truncates long titles by code points', () => {
    const feed = buildCatalogFeed(input([row({ productName: 'x'.repeat(200) })]))
    expect(Array.from(feed.items[0]!.title)).toHaveLength(150)
    expect(feed.problems).toContainEqual(expect.objectContaining({ code: 'title_truncated', excluded: false }))
    const emoji = buildCatalogFeed(input([row({ productName: '🥭'.repeat(200) })]))
    expect(Array.from(emoji.items[0]!.title)).toHaveLength(150)
  })

  it('falls back to title for blank description and trims long ones', () => {
    for (const description of [null, '  ']) {
      const feed = buildCatalogFeed(input([row({ description })]))
      expect(feed.items[0]!.description).toBe(feed.items[0]!.title)
      expect(feed.problems).toContainEqual(expect.objectContaining({ code: 'no_description', excluded: false }))
    }
    const long = buildCatalogFeed(input([row({ description: 'd'.repeat(6000) })]))
    expect(Array.from(long.items[0]!.description)).toHaveLength(5000)
  })

  it('limits additional images to 10 and flags missing alt on the cover', () => {
    const images = 'abcdefghijkl'.split('').map((c) => ({ url: `https://img.test/${c}.webp`, alt: 'x' }))
    const item = buildCatalogFeed(input([row({ images })])).items[0]!
    expect(item.imageLink).toBe(images[0]!.url)
    expect(item.additionalImageLinks).toHaveLength(10)
    expect(item.additionalImageLinks[0]).toBe(images[1]!.url)

    const feed = buildCatalogFeed(input([row({ images: [{ url: 'https://img.test/a.webp', alt: null }] })]))
    expect(feed.items).toHaveLength(1)
    expect(feed.problems).toContainEqual(expect.objectContaining({ code: 'image_missing_alt', excluded: false }))
  })

  it('maps categories', () => {
    const fresh = buildCatalogFeed(input([row()])).items[0]!
    expect(fresh.googleProductCategory).toBe('Food, Beverages & Tobacco > Food Items > Fruits & Vegetables > Fresh & Frozen Fruits')
    expect(fresh.productType).toBe('ผลไม้สด')
    const processed = buildCatalogFeed(input([row({ category: 'processed' })])).items[0]!
    expect(processed.googleProductCategory).toBe('Food, Beverages & Tobacco > Food Items')
    expect(processed.productType).toBe('ผลิตภัณฑ์แปรรูป')
  })

  it('counts rows', () => {
    const feed = buildCatalogFeed(input([
      row(),
      row({ variantId: 'v2', sellable: false }),
      row({ variantId: 'v3', images: [] }),
    ]))
    expect(feed.counts).toEqual({ total: 3, inFeed: 2, inStock: 1, outOfStock: 1, excluded: 1 })
  })

  it('keeps group id across variants', () => {
    const feed = buildCatalogFeed(input([row(), row({ variantId: 'v2', sellable: false })]))
    expect(feed.items.map((i) => i.availability)).toEqual(['in_stock', 'out_of_stock'])
    expect(feed.items[0]!.itemGroupId).toBe(feed.items[1]!.itemGroupId)
  })

  it('handles empty rows', () => {
    const feed = buildCatalogFeed(input([]))
    expect(feed.items).toEqual([])
    expect(feed.counts).toEqual({ total: 0, inFeed: 0, inStock: 0, outOfStock: 0, excluded: 0 })
  })
})
