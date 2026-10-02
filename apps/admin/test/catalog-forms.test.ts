import { expect, test } from 'bun:test'
import {
  formatDateOnly,
  formatMoney,
  formatTimestamp,
  parseBahtToSatang,
} from '../src/lib/format'
import {
  productCreateSchema,
  productEditSchema,
  toProductCreateInput,
  toProductUpdateInput,
  toVariantCreateInput,
  toVariantUpdateInput,
  variantCreateSchema,
  variantEditSchema,
} from '../src/lib/catalog/forms'

test('converts baht decimal strings to exact satang without floating point rounding', () => {
  expect(parseBahtToSatang('19.90')).toBe(1990)
  expect(parseBahtToSatang('0.01')).toBe(1)
  expect(parseBahtToSatang('1')).toBe(100)
  expect(parseBahtToSatang('19.9')).toBe(1990)
})

test('rejects malformed, negative, over-precise, and unsafe baht values', () => {
  for (const value of ['', '-1', '+1', '1e3', '1.001', '1,000', '90071992547409.92']) {
    expect(() => parseBahtToSatang(value)).toThrow()
  }
})

test('formats money and dates in Thai baht, Gregorian years, and Bangkok time', () => {
  expect(formatMoney(1990)).toContain('19.90')
  expect(formatMoney(1990)).toContain('฿')
  expect(formatDateOnly('2026-10-02')).toContain('2026')
  expect(formatTimestamp('2026-10-02T01:15:00.000Z')).toContain('2026')
  expect(formatTimestamp('2026-10-02T01:15:00.000Z')).toContain('08:15')
})

test('normalizes blank product create fields to null and keeps slug create-only', () => {
  const values = productCreateSchema.parse({
    slug: 'nam-dok-mai',
    name: 'มะม่วงน้ำดอกไม้',
    category: 'fresh',
    englishName: '',
    description: '',
    originStory: '  ',
    storageInstructions: '',
    imageUrl: '',
    imageAlt: '',
  })

  expect(toProductCreateInput(values)).toEqual({
    slug: 'nam-dok-mai',
    name: 'มะม่วงน้ำดอกไม้',
    category: 'fresh',
    englishName: null,
    description: null,
    originStory: null,
    storageInstructions: null,
    imageUrl: null,
    imageAlt: null,
  })
})

test('clears optional product fields with null and never sends an edit slug', () => {
  const values = productEditSchema.parse({
    slug: 'unchangeable-slug',
    name: 'สินค้าใหม่',
    category: 'processed',
    englishName: '',
    description: '',
    originStory: 'เรื่องราว',
    storageInstructions: '',
    imageUrl: 'https://example.test/image.jpg',
    imageAlt: '',
  })

  expect(toProductUpdateInput(values)).toEqual({
    name: 'สินค้าใหม่',
    category: 'processed',
    englishName: null,
    description: null,
    originStory: 'เรื่องราว',
    storageInstructions: null,
    imageUrl: 'https://example.test/image.jpg',
    imageAlt: null,
  })
  expect(toProductUpdateInput(values)).not.toHaveProperty('slug')
})

test('validates HTTPS images and product field limits', () => {
  expect(() => productCreateSchema.parse({ slug: 'sample', name: 'สินค้า', category: 'fresh', imageUrl: 'http://example.test/image.jpg' })).toThrow()
  expect(() => productCreateSchema.parse({ slug: 'bad slug', name: 'สินค้า', category: 'fresh' })).toThrow()
  expect(() => productCreateSchema.parse({ slug: 'sample', name: '', category: 'fresh' })).toThrow()
})

test('converts variant baht input to satang and excludes SKU from updates', () => {
  const createValues = variantCreateSchema.parse({
    sku: 'MANGO-1KG',
    name: 'หนึ่งกิโลกรัม',
    unit: 'กิโลกรัม',
    priceBaht: '189.90',
    salesEnabled: true,
    displayOrder: 2,
    minRemainingShelfLifeDays: 3,
  })
  expect(toVariantCreateInput(createValues)).toEqual({
    sku: 'MANGO-1KG',
    name: 'หนึ่งกิโลกรัม',
    unit: 'กิโลกรัม',
    priceSatang: 18990,
    salesEnabled: true,
    displayOrder: 2,
    minRemainingShelfLifeDays: 3,
  })

  const editValues = variantEditSchema.parse({ ...createValues, sku: 'MANGO-1KG', priceBaht: '199.00' })
  expect(toVariantUpdateInput(editValues)).toEqual({
    name: 'หนึ่งกิโลกรัม',
    unit: 'กิโลกรัม',
    priceSatang: 19900,
    salesEnabled: true,
    displayOrder: 2,
    minRemainingShelfLifeDays: 3,
  })
  expect(toVariantUpdateInput(editValues)).not.toHaveProperty('sku')
})

test('rejects nonpositive or out-of-range variant prices and shelf-life values', () => {
  const base = { sku: 'SKU-1', name: 'ขนาดเล็ก', unit: 'ชิ้น', priceBaht: '0.00' }
  expect(() => variantCreateSchema.parse(base)).toThrow()
  expect(() => variantCreateSchema.parse({ ...base, priceBaht: '10000000.01' })).toThrow()
  expect(() => variantCreateSchema.parse({ ...base, priceBaht: '1', minRemainingShelfLifeDays: 366 })).toThrow()
})
