import { DomainError } from '../../shared/domain-error'
import type {
  AdminProduct,
  AdminVariant,
  CreateProductInput,
  CreateVariantInput,
  ProductCategory,
  ProductStatus,
  UpdateProductInput,
  UpdateVariantInput,
} from './types'

const productTextLimits = {
  name: 160,
  englishName: 160,
  description: 5000,
  originStory: 5000,
  storageInstructions: 5000,
  imageAlt: 200,
} as const

const variantTextLimits = { name: 120, unit: 40 } as const
const productCreateFields = ['slug', 'name', 'category', ...Object.keys(productTextLimits), 'imageUrl']
const productUpdateFields = ['name', 'category', ...Object.keys(productTextLimits), 'imageUrl']
const variantCreateFields = ['sku', 'name', 'unit', 'priceSatang', 'salesEnabled', 'displayOrder']
const variantUpdateFields = ['name', 'unit', 'priceSatang', 'salesEnabled', 'displayOrder']

function invalidProduct(): never {
  throw new DomainError('INVALID_PRODUCT')
}

function assertKnownFields(input: object, fields: string[]) {
  if (Object.keys(input).some((field) => !fields.includes(field))) invalidProduct()
}

function textLength(value: string) {
  return Array.from(value).length
}

function normalizeText(value: unknown, maxLength: number, required = false): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null && !required) return null
  if (typeof value !== 'string') return invalidProduct()
  const normalized = value.trim()
  if ((required && !normalized) || textLength(normalized) > maxLength) return invalidProduct()
  return normalized
}

function normalizeOptionalTextFields(
  input: object,
  limits: Record<string, number>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [field, limit] of Object.entries(limits)) {
    const value = (input as Record<string, unknown>)[field]
    if (value !== undefined) result[field] = normalizeText(value, limit)
  }
  return result
}

function isHttpsUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.hostname)
  } catch {
    return false
  }
}

function normalizeImageUrl(value: unknown): string | null | undefined {
  const normalized = normalizeText(value, 2048)
  if (typeof normalized === 'string' && !isHttpsUrl(normalized)) invalidProduct()
  return normalized
}

function assertCategory(value: unknown): asserts value is ProductCategory {
  if (value !== 'fresh' && value !== 'processed') invalidProduct()
}

function assertPrice(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1_000_000_000) invalidProduct()
}

function assertDisplayOrder(value: unknown) {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 1_000_000) invalidProduct()
}

export function normalizeSlug(value: string): string {
  if (typeof value !== 'string') return invalidProduct()
  const slug = value.trim().toLowerCase()
  if (textLength(slug) > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) invalidProduct()
  return slug
}

export function normalizeSku(value: string): string {
  if (typeof value !== 'string') return invalidProduct()
  const sku = value.trim().toUpperCase()
  if (textLength(sku) > 64 || !/^[A-Z0-9._-]+$/.test(sku)) invalidProduct()
  return sku
}

export function normalizeProductCreate(input: CreateProductInput): CreateProductInput {
  assertKnownFields(input, productCreateFields)
  const slug = normalizeSlug(input.slug)
  const name = normalizeText(input.name, productTextLimits.name, true)
  assertCategory(input.category)
  const imageUrl = normalizeImageUrl(input.imageUrl)
  const optionalText = normalizeOptionalTextFields(input, productTextLimits)
  return {
    slug,
    name: name as string,
    category: input.category,
    ...optionalText,
    ...(imageUrl !== undefined ? { imageUrl } : {}),
  } as CreateProductInput
}

export function normalizeProductUpdate(input: UpdateProductInput): UpdateProductInput {
  assertKnownFields(input, productUpdateFields)
  if (!Object.keys(input).length) invalidProduct()
  const optionalText = normalizeOptionalTextFields(input, productTextLimits)
  if (input.name !== undefined) optionalText.name = normalizeText(input.name, productTextLimits.name, true) as string
  if (input.category !== undefined) assertCategory(input.category)
  const imageUrl = normalizeImageUrl(input.imageUrl)
  return {
    ...optionalText,
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(imageUrl !== undefined ? { imageUrl } : {}),
  }
}

export function normalizeVariantCreate(input: CreateVariantInput): CreateVariantInput {
  assertKnownFields(input, variantCreateFields)
  const sku = normalizeSku(input.sku)
  const name = normalizeText(input.name, variantTextLimits.name, true) as string
  const unit = normalizeText(input.unit, variantTextLimits.unit, true) as string
  assertPrice(input.priceSatang)
  if (input.salesEnabled !== undefined && typeof input.salesEnabled !== 'boolean') invalidProduct()
  if (input.displayOrder !== undefined) assertDisplayOrder(input.displayOrder)
  return {
    sku,
    name,
    unit,
    priceSatang: input.priceSatang,
    ...(input.salesEnabled !== undefined ? { salesEnabled: input.salesEnabled } : {}),
    ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
  }
}

export function normalizeVariantUpdate(input: UpdateVariantInput): UpdateVariantInput {
  assertKnownFields(input, variantUpdateFields)
  if (!Object.keys(input).length) invalidProduct()
  const result: UpdateVariantInput = {}
  if (input.name !== undefined) result.name = normalizeText(input.name, variantTextLimits.name, true) as string
  if (input.unit !== undefined) result.unit = normalizeText(input.unit, variantTextLimits.unit, true) as string
  if (input.priceSatang !== undefined) {
    assertPrice(input.priceSatang)
    result.priceSatang = input.priceSatang
  }
  if (input.salesEnabled !== undefined) {
    if (typeof input.salesEnabled !== 'boolean') invalidProduct()
    result.salesEnabled = input.salesEnabled
  }
  if (input.displayOrder !== undefined) {
    assertDisplayOrder(input.displayOrder)
    result.displayOrder = input.displayOrder
  }
  return result
}

export function assertPublishable(product: AdminProduct, activeVariants: AdminVariant[]) {
  if (!product.name.trim() || !product.description?.trim() || !product.imageAlt?.trim()
    || !product.imageUrl || !isHttpsUrl(product.imageUrl)) invalidProduct()
  assertCategory(product.category)
  const validVariant = activeVariants.some((variant) =>
    variant.archivedAt === null && variant.productId === product.id
      && Number.isSafeInteger(variant.priceSatang)
      && variant.priceSatang >= 1 && variant.priceSatang <= 1_000_000_000)
  if (!validVariant) invalidProduct()
}

export function assertVariantArchivable(productStatus: ProductStatus, activeVariantCount: number) {
  if (!Number.isInteger(activeVariantCount) || activeVariantCount < 1) invalidProduct()
  if (productStatus === 'published' && activeVariantCount === 1) throw new DomainError('PRODUCT_STATE_CONFLICT')
}
