import { expect, test } from 'bun:test'
import {
  formatDateOnly,
  formatMoney,
  formatTimestamp,
  parseBahtToSatang,
} from '../src/lib/format'
import {
  defaultVatTreatment,
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
    vatTreatment: 'exempt',
    englishName: '',
    description: '',
    originStory: '  ',
    storageInstructions: '',
    images: [],
  })

  expect(toProductCreateInput(values)).toEqual({
    slug: 'nam-dok-mai',
    name: 'มะม่วงน้ำดอกไม้',
    category: 'fresh',
    vatTreatment: 'exempt',
    englishName: null,
    description: null,
    originStory: null,
    storageInstructions: null,
    imageIds: [],
  })
})

test('clears optional product fields with null and sends the slug only when it changes', () => {
  const values = productEditSchema.parse({
    slug: 'unchangeable-slug',
    name: 'สินค้าใหม่',
    category: 'processed',
    vatTreatment: 'standard',
    englishName: '',
    description: '',
    originStory: 'เรื่องราว',
    storageInstructions: '',
    images: [{ id: 'media-1', thumbUrl: 'https://example.test/t1.webp', alt: null }, { id: 'media-2', thumbUrl: 'https://example.test/t2.webp', alt: 'ผล' }],
  })

  expect(toProductUpdateInput(values, 'unchangeable-slug')).toEqual({
    name: 'สินค้าใหม่',
    category: 'processed',
    vatTreatment: 'standard',
    englishName: null,
    description: null,
    originStory: 'เรื่องราว',
    storageInstructions: null,
    imageIds: ['media-1', 'media-2'],
  })
  expect(toProductUpdateInput(values, 'unchangeable-slug')).not.toHaveProperty('slug')
  expect(toProductUpdateInput(values, 'previous-slug')).toMatchObject({ slug: 'unchangeable-slug' })
})

test('maps vatTreatment into create and update inputs', () => {
  const base = { slug: 'jam', name: 'แยม', category: 'fresh', englishName: '', description: '', originStory: '', storageInstructions: '', images: [] }
  const created = productCreateSchema.parse({ ...base, vatTreatment: 'standard' })
  expect(toProductCreateInput(created).vatTreatment).toBe('standard')
  const edited = productEditSchema.parse({ ...base, vatTreatment: 'exempt' })
  expect(toProductUpdateInput(edited, 'jam').vatTreatment).toBe('exempt')
  expect(defaultVatTreatment('fresh')).toBe('exempt')
  expect(defaultVatTreatment('processed')).toBe('standard')
  expect(() => productCreateSchema.parse({ ...base, vatTreatment: 'zero' })).toThrow()
})

test('validates the gallery limit and product field limits', () => {
  expect(() => productCreateSchema.parse({ slug: 'sample', name: 'สินค้า', category: 'fresh', vatTreatment: 'exempt', images: Array.from({ length: 13 }, (_, index) => ({ id: `media-${index}`, thumbUrl: 'https://example.test/t.webp', alt: null })) })).toThrow()
  expect(() => productCreateSchema.parse({ slug: 'bad slug', name: 'สินค้า', category: 'fresh', vatTreatment: 'exempt' })).toThrow()
  expect(() => productCreateSchema.parse({ slug: 'sample', name: '', category: 'fresh', vatTreatment: 'exempt' })).toThrow()
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
