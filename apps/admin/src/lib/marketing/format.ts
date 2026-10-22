import { formatMoney } from '../format'

const DAY_MS = 86_400_000
const BANGKOK_OFFSET_MS = 7 * 3_600_000

export type RangePreset = 'today' | '7d' | '30d' | 'month' | 'custom'
export interface DateRange { from: string; to: string }

export const presetLabels: Record<RangePreset, string> = {
  today: 'วันนี้',
  '7d': '7 วันล่าสุด',
  '30d': '30 วันล่าสุด',
  month: 'เดือนนี้',
  custom: 'กำหนดเอง',
}

export const formatBaht = formatMoney

export function formatRoas(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}x`
}

// Eden parses date-like strings into Date objects at runtime, despite the string type.
export function dateKey(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10)
}

export function isDateKey(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

// Bangkok has no DST, so a fixed UTC+7 offset matches the API's day boundaries.
export function bangkokToday(now: number = Date.now()): string {
  return new Date(now + BANGKOK_OFFSET_MS).toISOString().slice(0, 10)
}

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

export const MAX_RANGE_DAYS = 366

// Inclusive day count of a YYYY-MM-DD range.
export function rangeDays(range: DateRange): number {
  return Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / DAY_MS) + 1
}

export function presetRange(preset: Exclude<RangePreset, 'custom'>, now: number = Date.now()): DateRange {
  const today = bangkokToday(now)
  if (preset === 'today') return { from: today, to: today }
  if (preset === '7d') return { from: addDays(today, -6), to: today }
  if (preset === '30d') return { from: addDays(today, -29), to: today }
  return { from: `${today.slice(0, 8)}01`, to: today }
}

export function platformLabel(platform: string): string {
  return platform === 'meta' ? 'Meta' : platform === 'tiktok' ? 'TikTok' : platform === 'google' ? 'Google Ads' : platform
}

export function warningText(warning: { code: string; platform?: string; date?: string | Date }): string {
  const platform = platformLabel(warning.platform ?? '')
  switch (warning.code) {
    case 'NON_THB_CURRENCY': return `บัญชีโฆษณา ${platform} ไม่ได้ใช้สกุลเงินบาท จึงไม่นำค่าโฆษณามาคิด ROAS`
    case 'NO_PLATFORM_CONFIGURED': return 'ยังไม่ได้เชื่อมบัญชีโฆษณา'
    case 'SPEND_DATA_STARTS_LATE': return `ค่าโฆษณาของ ${platform} เริ่มมีตั้งแต่วันที่ ${warning.date ? dateKey(warning.date) : ''}`
    case 'NON_BANGKOK_TIMEZONE': return `บัญชีโฆษณา ${platform} ไม่ได้ตั้งเขตเวลาเป็น Asia/Bangkok วันที่อาจคลาดเคลื่อน`
    default: return warning.code
  }
}

export function syncResultText(result: { status: string; errorCode?: string }): string {
  switch (result.status) {
    case 'succeeded': return 'สำเร็จ'
    case 'failed': return `ไม่สำเร็จ (${result.errorCode ?? 'UNKNOWN'})`
    case 'already_running': return 'กำลังซิงก์อยู่'
    case 'not_configured': return 'ยังไม่ได้เชื่อม'
    default: return result.status
  }
}
