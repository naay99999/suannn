import { z } from 'zod'
import type {
  ProductCreateInput,
  ProductUpdateInput,
  VariantCreateInput,
  VariantUpdateInput,
} from './api'
import { parseBahtToSatang } from '../format'

const productFields = {
  slug: z.string().trim().min(1, 'กรุณาระบุชื่อ URL สินค้า').max(100, 'ชื่อ URL ต้องไม่เกิน 100 ตัวอักษร').regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'ใช้ตัวอักษรภาษาอังกฤษตัวเล็ก ตัวเลข และขีดกลาง'),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อสินค้า').max(160, 'ชื่อต้องไม่เกิน 160 ตัวอักษร'),
  category: z.enum(['fresh', 'processed'], { error: 'กรุณาเลือกหมวดหมู่' }),
  englishName: z.string().trim().max(160, 'ชื่อต้องไม่เกิน 160 ตัวอักษร'),
  description: z.string().trim().max(5000, 'คำอธิบายต้องไม่เกิน 5,000 ตัวอักษร'),
  originStory: z.string().trim().max(5000, 'เรื่องราวต้องไม่เกิน 5,000 ตัวอักษร'),
  storageInstructions: z.string().trim().max(5000, 'วิธีเก็บรักษาต้องไม่เกิน 5,000 ตัวอักษร'),
  imageUrl: z.string().trim().max(2048, 'URL รูปภาพยาวเกินไป').refine((value) => {
    if (!value) return true
    try {
      return new URL(value).protocol === 'https:'
    } catch {
      return false
    }
  }, 'URL รูปภาพต้องขึ้นต้นด้วย HTTPS'),
  imageAlt: z.string().trim().max(200, 'คำอธิบายรูปภาพต้องไม่เกิน 200 ตัวอักษร'),
}

export const productCreateSchema = z.object(productFields)
export const productEditSchema = z.object(productFields)

export const variantCreateSchema = z.object({
  sku: z.string().trim().min(1, 'กรุณาระบุ SKU').max(64, 'SKU ต้องไม่เกิน 64 ตัวอักษร').regex(/^[a-zA-Z0-9._-]+$/, 'SKU ใช้ได้เฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข จุด ขีด และขีดล่าง'),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อรูปแบบสินค้า').max(120, 'ชื่อต้องไม่เกิน 120 ตัวอักษร'),
  unit: z.string().trim().min(1, 'กรุณาระบุหน่วย').max(40, 'หน่วยต้องไม่เกิน 40 ตัวอักษร'),
  priceBaht: z.string().trim().refine((value) => {
    try {
      const satang = parseBahtToSatang(value)
      return satang >= 1 && satang <= 1_000_000_000
    } catch {
      return false
    }
  }, 'ราคาต้องมากกว่า 0 และไม่เกิน 10,000,000 บาท'),
  salesEnabled: z.boolean(),
  displayOrder: z.number().int().min(0, 'ลำดับต้องไม่ต่ำกว่า 0').max(1_000_000, 'ลำดับต้องไม่เกิน 1,000,000'),
  minRemainingShelfLifeDays: z.number().int().min(0, 'จำนวนวันต้องไม่ต่ำกว่า 0').max(365, 'จำนวนวันต้องไม่เกิน 365'),
})

export const variantEditSchema = z.object({
  ...variantCreateSchema.shape,
})

export type ProductCreateValues = z.infer<typeof productCreateSchema>
export type ProductEditValues = z.infer<typeof productEditSchema>
export type VariantCreateValues = z.infer<typeof variantCreateSchema>
export type VariantEditValues = z.infer<typeof variantEditSchema>

function optionalText(value: string): string | null {
  return value.trim() || null
}

export function toProductCreateInput(values: ProductCreateValues): ProductCreateInput {
  return {
    slug: values.slug,
    name: values.name,
    category: values.category,
    englishName: optionalText(values.englishName),
    description: optionalText(values.description),
    originStory: optionalText(values.originStory),
    storageInstructions: optionalText(values.storageInstructions),
    imageUrl: optionalText(values.imageUrl),
    imageAlt: optionalText(values.imageAlt),
  }
}

export function toProductUpdateInput(values: ProductEditValues): ProductUpdateInput {
  return {
    name: values.name,
    category: values.category,
    englishName: optionalText(values.englishName),
    description: optionalText(values.description),
    originStory: optionalText(values.originStory),
    storageInstructions: optionalText(values.storageInstructions),
    imageUrl: optionalText(values.imageUrl),
    imageAlt: optionalText(values.imageAlt),
  }
}

function priceSatang(priceBaht: string): number {
  return parseBahtToSatang(priceBaht)
}

export function toVariantCreateInput(values: VariantCreateValues): VariantCreateInput {
  return {
    sku: values.sku.trim().toUpperCase(),
    name: values.name,
    unit: values.unit,
    priceSatang: priceSatang(values.priceBaht),
    salesEnabled: values.salesEnabled,
    displayOrder: values.displayOrder,
    minRemainingShelfLifeDays: values.minRemainingShelfLifeDays,
  }
}

export function toVariantUpdateInput(values: VariantEditValues): VariantUpdateInput {
  return {
    name: values.name,
    unit: values.unit,
    priceSatang: priceSatang(values.priceBaht),
    salesEnabled: values.salesEnabled,
    displayOrder: values.displayOrder,
    minRemainingShelfLifeDays: values.minRemainingShelfLifeDays,
  }
}
