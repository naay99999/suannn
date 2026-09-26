import { describe, expect, it } from 'bun:test'
import { DomainError, mapDomainError } from '../../src/shared/domain-error'
import {
  assertPublishable,
  assertVariantArchivable,
  normalizeProductCreate,
  normalizeProductUpdate,
  normalizeSlug,
  normalizeSku,
  normalizeVariantCreate,
  normalizeVariantUpdate,
} from '../../src/modules/products/policy'
import type { AdminProduct, AdminVariant, CreateProductInput } from '../../src/modules/products/types'

const createProductInput: CreateProductInput = {
  slug: 'fresh-tomato',
  name: 'Fresh tomato',
  category: 'fresh',
}

function publishedProduct(overrides: Partial<AdminProduct> = {}): AdminProduct {
  return {
    id: 'product-1',
    slug: 'fresh-tomato',
    name: 'Fresh tomato',
    englishName: null,
    description: 'Sweet tomatoes grown in Chiang Mai.',
    category: 'fresh',
    originStory: null,
    storageInstructions: null,
    imageUrl: 'https://images.example.test/tomato.jpg',
    imageAlt: 'Fresh tomatoes',
    status: 'published',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    archivedAt: null,
    ...overrides,
  }
}

function activeVariant(overrides: Partial<AdminVariant> = {}): AdminVariant {
  return {
    id: 'variant-1',
    productId: 'product-1',
    sku: 'FRESH-TOMATO-500G',
    name: '500 g bag',
    unit: 'bag',
    priceSatang: 4500,
    salesEnabled: true,
    displayOrder: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    archivedAt: null,
    ...overrides,
  }
}

describe('product catalog policy', () => {
  it('maps catalog errors to safe not-found, conflict, and validation responses', () => {
    const cases = [
      ['PRODUCT_NOT_FOUND', 404],
      ['VARIANT_NOT_FOUND', 404],
      ['PRODUCT_SLUG_CONFLICT', 409],
      ['SKU_CONFLICT', 409],
      ['PRODUCT_STATE_CONFLICT', 409],
      ['INVALID_PRODUCT', 422],
    ] as const
    for (const [code, status] of cases) {
      const response = mapDomainError(new DomainError(code))
      expect(response?.status).toBe(status)
      expect(response?.body.code).toBe(code)
      expect(response?.body.message).not.toContain('http')
    }
  })

  it('normalizes slugs and SKUs while rejecting malformed syntax', () => {
    expect(normalizeSlug('  Fresh-Tomato-1Kg  ')).toBe('fresh-tomato-1kg')
    expect(normalizeSku('  fresh.tomato_1kg-a  ')).toBe('FRESH.TOMATO_1KG-A')
    expect(() => normalizeSlug('fresh--tomato')).toThrow('INVALID_PRODUCT')
    expect(() => normalizeSlug('fresh tomato')).toThrow('INVALID_PRODUCT')
    expect(() => normalizeSku('tomato/500g')).toThrow('INVALID_PRODUCT')
  })

  it('trims product create and update text and requires valid HTTPS image URLs', () => {
    expect(normalizeProductCreate({
      ...createProductInput,
      name: '  Fresh tomato  ',
      englishName: '  Tomato  ',
      description: '  A local crop.  ',
      originStory: '  Grown nearby.  ',
      storageInstructions: '  Keep cool.  ',
      imageUrl: '  https://images.example.test/tomato.jpg  ',
      imageAlt: '  Ripe tomatoes  ',
    })).toMatchObject({
      name: 'Fresh tomato',
      englishName: 'Tomato',
      description: 'A local crop.',
      originStory: 'Grown nearby.',
      storageInstructions: 'Keep cool.',
      imageUrl: 'https://images.example.test/tomato.jpg',
      imageAlt: 'Ripe tomatoes',
    })
    expect(normalizeProductUpdate({ description: '  Updated copy  ' })).toEqual({ description: 'Updated copy' })
    expect(() => normalizeProductCreate({ ...createProductInput, imageUrl: 'http://images.example.test/tomato.jpg' }))
      .toThrow('INVALID_PRODUCT')
  })

  it('enforces product text limits, nonblank required fields, and known input fields', () => {
    expect(() => normalizeProductCreate({ ...createProductInput, name: ' '.repeat(2) })).toThrow('INVALID_PRODUCT')
    expect(() => normalizeProductCreate({ ...createProductInput, name: 'x'.repeat(161) })).toThrow('INVALID_PRODUCT')
    expect(() => normalizeProductCreate({ ...createProductInput, slug: `a${'b'.repeat(100)}` })).toThrow('INVALID_PRODUCT')
    expect(() => normalizeProductCreate({ ...createProductInput, description: 'x'.repeat(5001) })).toThrow('INVALID_PRODUCT')
    expect(() => normalizeProductCreate({ ...createProductInput, imageAlt: 'x'.repeat(201) })).toThrow('INVALID_PRODUCT')
    expect(() => normalizeProductCreate({ ...createProductInput, imageUrl: `https://${'x'.repeat(2040)}.test` })).toThrow('INVALID_PRODUCT')
    expect(() => normalizeProductCreate({ ...createProductInput, id: 'caller-id' } as never)).toThrow('INVALID_PRODUCT')
    expect(() => normalizeProductUpdate({ slug: 'changed-slug' } as never)).toThrow('INVALID_PRODUCT')
    expect(() => normalizeProductUpdate({ id: 'caller-id' } as never)).toThrow('INVALID_PRODUCT')
    expect(() => normalizeProductCreate({ ...createProductInput, englishName: 'x'.repeat(161) })).toThrow('INVALID_PRODUCT')
    expect(() => normalizeProductCreate({ ...createProductInput, originStory: 'x'.repeat(5001) })).toThrow('INVALID_PRODUCT')
    expect(() => normalizeProductCreate({ ...createProductInput, storageInstructions: 'x'.repeat(5001) })).toThrow('INVALID_PRODUCT')
  })

  it('accepts product text and image values at their exact maximum lengths', () => {
    const urlPrefix = 'https://images.example.test/'
    const input = normalizeProductCreate({
      slug: `a${'b'.repeat(99)}`,
      name: 'n'.repeat(160),
      englishName: 'e'.repeat(160),
      description: 'd'.repeat(5000),
      originStory: 'o'.repeat(5000),
      storageInstructions: 's'.repeat(5000),
      imageUrl: `${urlPrefix}${'x'.repeat(2048 - urlPrefix.length)}`,
      imageAlt: 'a'.repeat(200),
      category: 'processed',
    })
    expect(input.slug).toHaveLength(100)
    expect(input.name).toHaveLength(160)
    expect(input.englishName).toHaveLength(160)
    expect(input.description).toHaveLength(5000)
    expect(input.originStory).toHaveLength(5000)
    expect(input.storageInstructions).toHaveLength(5000)
    expect(input.imageUrl).toHaveLength(2048)
    expect(input.imageAlt).toHaveLength(200)
  })

  it('normalizes variant create and update text and rejects immutable SKU or IDs', () => {
    expect(normalizeVariantCreate({
      sku: ' fresh-tomato-500g ', name: ' 500 g bag ', unit: ' bag ', priceSatang: 4500,
    })).toEqual({ sku: 'FRESH-TOMATO-500G', name: '500 g bag', unit: 'bag', priceSatang: 4500 })
    expect(normalizeVariantUpdate({ name: ' 1 kg bag ', displayOrder: 2 })).toEqual({ name: '1 kg bag', displayOrder: 2 })
    expect(() => normalizeVariantCreate({ sku: 'X'.repeat(65), name: 'Bag', unit: 'bag', priceSatang: 1 })).toThrow('INVALID_PRODUCT')
    expect(() => normalizeVariantCreate({ sku: 'SKU', name: 'x'.repeat(121), unit: 'bag', priceSatang: 1 })).toThrow('INVALID_PRODUCT')
    expect(() => normalizeVariantCreate({ sku: 'SKU', name: 'Bag', unit: 'x'.repeat(41), priceSatang: 1 })).toThrow('INVALID_PRODUCT')
    expect(() => normalizeVariantCreate({ sku: 'SKU', name: 'Bag', unit: 'bag', priceSatang: 0 })).toThrow('INVALID_PRODUCT')
    expect(() => normalizeVariantCreate({ sku: 'SKU', name: 'Bag', unit: 'bag', priceSatang: 1.5 })).toThrow('INVALID_PRODUCT')
    expect(() => normalizeVariantCreate({ sku: 'SKU', name: 'Bag', unit: 'bag', priceSatang: 1_000_000_001 })).toThrow('INVALID_PRODUCT')
    expect(normalizeVariantCreate({
      sku: 's'.repeat(64), name: 'n'.repeat(120), unit: 'u'.repeat(40),
      priceSatang: 1_000_000_000, salesEnabled: false, displayOrder: 1_000_000,
    })).toEqual({
      sku: 'S'.repeat(64), name: 'n'.repeat(120), unit: 'u'.repeat(40),
      priceSatang: 1_000_000_000, salesEnabled: false, displayOrder: 1_000_000,
    })
    expect(() => normalizeVariantUpdate({ sku: 'OTHER-SKU' } as never)).toThrow('INVALID_PRODUCT')
    expect(() => normalizeVariantUpdate({ id: 'caller-id' } as never)).toThrow('INVALID_PRODUCT')
  })

  it('enforces display order bounds and rejects empty or unknown updates', () => {
    expect(() => normalizeVariantCreate({ sku: 'SKU', name: 'Bag', unit: 'bag', priceSatang: 1, displayOrder: -1 }))
      .toThrow('INVALID_PRODUCT')
    expect(() => normalizeVariantUpdate({ displayOrder: 1_000_001 })).toThrow('INVALID_PRODUCT')
    expect(() => normalizeProductUpdate({ unexpected: true } as never)).toThrow('INVALID_PRODUCT')
    expect(() => normalizeVariantUpdate({ unexpected: true } as never)).toThrow('INVALID_PRODUCT')
    expect(() => normalizeProductUpdate({})).toThrow('INVALID_PRODUCT')
    expect(() => normalizeVariantUpdate({})).toThrow('INVALID_PRODUCT')
  })

  it('requires complete product content and one valid active variant to publish', () => {
    expect(() => assertPublishable(publishedProduct({ description: '  ' }), [activeVariant()])).toThrow('INVALID_PRODUCT')
    expect(() => assertPublishable(publishedProduct({ imageAlt: null }), [activeVariant()])).toThrow('INVALID_PRODUCT')
    expect(() => assertPublishable(publishedProduct(), [])).toThrow('INVALID_PRODUCT')
    expect(() => assertPublishable(publishedProduct(), [activeVariant({ archivedAt: new Date() })])).toThrow('INVALID_PRODUCT')
  })

  it('allows a published coming-soon product when every active variant has sales disabled', () => {
    expect(() => assertPublishable(publishedProduct(), [activeVariant({ salesEnabled: false })])).not.toThrow()
  })

  it('rejects a merged published edit that leaves the product unpublishable', () => {
    const current = publishedProduct()
    const merged = { ...current, description: '' }
    expect(() => assertPublishable(merged, [activeVariant()])).toThrow('INVALID_PRODUCT')
  })

  it('protects the last active variant of a published product', () => {
    expect(() => assertVariantArchivable('published', 1)).toThrow('PRODUCT_STATE_CONFLICT')
    expect(() => assertVariantArchivable('published', 2)).not.toThrow()
    expect(() => assertVariantArchivable('draft', 1)).not.toThrow()
  })
})
