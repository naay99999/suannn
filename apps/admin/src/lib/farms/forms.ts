import { z } from 'zod'
import { mediaImageSchema, toMediaImageValue } from '../media/value'
import type { Farm, FarmCreateInput, FarmUpdateInput } from './api'

const farmFields = {
  slug: z.string().trim().min(1, 'กรุณาระบุชื่อ URL ฟาร์ม').max(100, 'ชื่อ URL ต้องไม่เกิน 100 ตัวอักษร').regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'ใช้ตัวอักษรภาษาอังกฤษตัวเล็ก ตัวเลข และขีดกลาง'),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อฟาร์ม').max(160, 'ชื่อต้องไม่เกิน 160 ตัวอักษร'),
  farmerName: z.string().trim().max(160, 'ชื่อเกษตรกรต้องไม่เกิน 160 ตัวอักษร'),
  province: z.string().trim().max(100, 'จังหวัดต้องไม่เกิน 100 ตัวอักษร'),
  district: z.string().trim().max(100, 'อำเภอต้องไม่เกิน 100 ตัวอักษร'),
  summary: z.string().trim().max(300, 'สรุปต้องไม่เกิน 300 ตัวอักษร'),
  story: z.string().trim().max(5000, 'เรื่องราวต้องไม่เกิน 5,000 ตัวอักษร'),
  growingPractices: z.string().trim().max(5000, 'วิธีการปลูกต้องไม่เกิน 5,000 ตัวอักษร'),
  coverImage: mediaImageSchema.nullable(),
  portraitImage: mediaImageSchema.nullable(),
}

export const farmSchema = z.object(farmFields)

export type FarmFormValues = z.infer<typeof farmSchema>

export const emptyFarmValues: FarmFormValues = {
  slug: '',
  name: '',
  farmerName: '',
  province: '',
  district: '',
  summary: '',
  story: '',
  growingPractices: '',
  coverImage: null,
  portraitImage: null,
}

function optionalText(value: string): string | null {
  return value.trim() || null
}

export function fromFarm(farm: Farm): FarmFormValues {
  return {
    slug: farm.slug,
    name: farm.name,
    farmerName: farm.farmerName ?? '',
    province: farm.province ?? '',
    district: farm.district ?? '',
    summary: farm.summary ?? '',
    story: farm.story ?? '',
    growingPractices: farm.growingPractices ?? '',
    coverImage: farm.coverImage ? toMediaImageValue(farm.coverImage) : null,
    portraitImage: farm.portraitImage ? toMediaImageValue(farm.portraitImage) : null,
  }
}

export function toFarmUpdateInput(values: FarmFormValues): FarmUpdateInput {
  return {
    name: values.name.trim(),
    farmerName: optionalText(values.farmerName),
    province: optionalText(values.province),
    district: optionalText(values.district),
    summary: optionalText(values.summary),
    story: optionalText(values.story),
    growingPractices: optionalText(values.growingPractices),
    coverMediaId: values.coverImage?.id ?? null,
    portraitMediaId: values.portraitImage?.id ?? null,
  }
}

export function toFarmCreateInput(values: FarmFormValues): FarmCreateInput {
  return { ...toFarmUpdateInput(values), slug: values.slug.trim(), name: values.name.trim() }
}
