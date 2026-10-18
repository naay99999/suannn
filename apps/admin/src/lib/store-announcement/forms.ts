import { z } from 'zod'
import type { StoreAnnouncement, StoreAnnouncementInput } from './api'

function isSafeLink(value: string) {
  if (value.startsWith('/')) return !value.startsWith('//') && !value.includes('\\')
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

const localDateTime = z.string().refine((value) => !value || !Number.isNaN(new Date(value).getTime()), 'วันที่และเวลาไม่ถูกต้อง')

export const storeAnnouncementSchema = z.object({
  enabled: z.boolean(),
  message: z.string().trim().max(160, 'ข้อความต้องไม่เกิน 160 ตัวอักษร'),
  linkLabel: z.string().trim().max(60, 'ข้อความลิงก์ต้องไม่เกิน 60 ตัวอักษร'),
  linkUrl: z.string().trim().max(2048, 'URL ยาวเกินไป').refine((value) => !value || isSafeLink(value), 'ใช้ path ในเว็บ เช่น /products หรือ URL ที่ขึ้นต้นด้วย https://'),
  details: z.string().trim().max(500, 'รายละเอียดต้องไม่เกิน 500 ตัวอักษร'),
  startsAt: localDateTime,
  endsAt: localDateTime,
}).superRefine((values, context) => {
  if (values.enabled && !values.message) {
    context.addIssue({ code: 'custom', path: ['message'], message: 'กรุณาระบุข้อความก่อนเปิดแสดงแถบโปรโมชัน' })
  }
  if (values.linkLabel && !values.linkUrl) {
    context.addIssue({ code: 'custom', path: ['linkUrl'], message: 'กรุณาระบุ URL ของลิงก์' })
  }
  if (values.linkUrl && !values.linkLabel) {
    context.addIssue({ code: 'custom', path: ['linkLabel'], message: 'กรุณาระบุข้อความลิงก์' })
  }
  if (values.startsAt && values.endsAt && new Date(values.endsAt) <= new Date(values.startsAt)) {
    context.addIssue({ code: 'custom', path: ['endsAt'], message: 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม' })
  }
})

export type StoreAnnouncementFormValues = z.infer<typeof storeAnnouncementSchema>

function toLocalDateTime(value: string | Date | null) {
  if (!value) return ''
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function fromStoreAnnouncement(announcement: StoreAnnouncement): StoreAnnouncementFormValues {
  return {
    enabled: announcement.enabled,
    message: announcement.message ?? '',
    linkLabel: announcement.linkLabel ?? '',
    linkUrl: announcement.linkUrl ?? '',
    details: announcement.details ?? '',
    startsAt: toLocalDateTime(announcement.startsAt),
    endsAt: toLocalDateTime(announcement.endsAt),
  }
}

export function toStoreAnnouncementInput(values: StoreAnnouncementFormValues): StoreAnnouncementInput {
  const text = (value: string) => value.trim() || null
  const timestamp = (value: string) => value ? new Date(value).toISOString() : null
  return {
    enabled: values.enabled,
    message: text(values.message),
    linkLabel: text(values.linkLabel),
    linkUrl: text(values.linkUrl),
    details: text(values.details),
    startsAt: timestamp(values.startsAt),
    endsAt: timestamp(values.endsAt),
  }
}
