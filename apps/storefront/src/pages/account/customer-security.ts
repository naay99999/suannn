import type { QueryClient } from '@tanstack/react-query'
import { AuthRequestError } from '@/lib/auth-client'
import { authSessionQuery, clearCustomerQueries } from '@/lib/auth-session'
import { AccountRequestError } from './account-api'

export const verificationSentMessage = 'หากอีเมลนี้ยังต้องยืนยัน เราจะส่งลิงก์ยืนยันให้ กรุณาตรวจกล่องจดหมาย'

export interface CustomerSessionRow {
  id: string
  token: string
  userAgent: string | null
  createdAt: string
  updatedAt: string
  ipAddress: string | null
}

export function parseCustomerSessions(value: unknown): CustomerSessionRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.token !== 'string') return []
    return [{
      id: row.id, token: row.token,
      userAgent: typeof row.userAgent === 'string' ? row.userAgent : null,
      createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
      ipAddress: typeof row.ipAddress === 'string' && row.ipAddress ? row.ipAddress : null,
    }]
  })
}

const browsers: [RegExp, string][] = [
  [/Edg\//, 'Edge'], [/OPR\/|Opera/, 'Opera'], [/SamsungBrowser/, 'Samsung Internet'], [/Line\//, 'LINE'],
  [/FBAN|FBAV/, 'Facebook'], [/Firefox\/|FxiOS/, 'Firefox'], [/CriOS|Chrome\//, 'Chrome'], [/Safari\//, 'Safari'],
]
const systems: [RegExp, string][] = [
  [/iPhone/, 'iPhone'], [/iPad/, 'iPad'], [/Android/, 'Android'], [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'], [/CrOS/, 'ChromeOS'], [/Linux/, 'Linux'],
]

// Turns a raw user agent into something a customer recognises, e.g. "Chrome บน macOS".
export function describeUserAgent(userAgent: string | null) {
  if (!userAgent) return 'อุปกรณ์ที่ไม่ระบุชื่อ'
  const browser = browsers.find(([pattern]) => pattern.test(userAgent))?.[1]
  const system = systems.find(([pattern]) => pattern.test(userAgent))?.[1]
  if (browser && system) return `${browser} บน ${system}`
  return browser ?? system ?? 'อุปกรณ์ที่ไม่ระบุชื่อ'
}

const lastActive = (row: CustomerSessionRow) => Date.parse(row.updatedAt || row.createdAt) || 0

// The current device first, then the most recently active.
export function sortSessions(rows: CustomerSessionRow[], currentId: string | undefined) {
  return [...rows].sort((a, b) => Number(b.id === currentId) - Number(a.id === currentId) || lastActive(b) - lastActive(a))
}

function rateLimitedOrOffline(error: unknown) {
  if (error instanceof AuthRequestError || error instanceof AccountRequestError) {
    if (error.status === 429) return 'ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่'
    if (error.status === 0) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'
  }
  return null
}

export function securityFailureMessage(error: unknown) {
  return rateLimitedOrOffline(error) ?? 'ดำเนินการไม่ได้ กรุณาลองใหม่'
}

export type FieldFailure<F extends string> = { field?: F; message: string }

export function passwordChangeFailure(error: unknown): FieldFailure<'currentPassword' | 'newPassword'> {
  if (error instanceof AuthRequestError) {
    if (error.code === 'INVALID_PASSWORD') return { field: 'currentPassword', message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' }
    if (error.code === 'PASSWORD_TOO_SHORT') return { field: 'newPassword', message: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 12 ตัวอักษร' }
    if (error.code === 'PASSWORD_TOO_LONG') return { field: 'newPassword', message: 'รหัสผ่านใหม่ยาวเกินไป' }
  }
  return { message: rateLimitedOrOffline(error) ?? 'เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาลองใหม่' }
}

export function emailChangeRequestFailure(error: unknown): FieldFailure<'newEmail' | 'currentPassword'> {
  if (error instanceof AccountRequestError) {
    if (error.code === 'INVALID_CURRENT_PASSWORD') return { field: 'currentPassword', message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' }
    if (error.code === 'EMAIL_UNAVAILABLE') return { field: 'newEmail', message: 'ใช้อีเมลนี้ไม่ได้ อาจเป็นอีเมลเดิมหรือมีบัญชีอื่นใช้อยู่' }
    if (error.code === 'VALIDATION_ERROR') return { field: 'newEmail', message: 'กรุณากรอกอีเมลให้ถูกต้อง' }
    if (error.status === 429) return { message: 'ขอรหัสครบจำนวนแล้ว กรุณารอประมาณ 1 ชั่วโมงแล้วลองใหม่' }
  }
  return { message: rateLimitedOrOffline(error) ?? 'ส่งรหัสยืนยันไม่สำเร็จ กรุณาลองใหม่' }
}

export function emailChangeConfirmFailure(error: unknown): { expired: boolean; message: string } {
  if (error instanceof AccountRequestError) {
    if (error.code === 'EMAIL_CHANGE_CODE_EXPIRED' || error.status === 410) return { expired: true, message: 'รหัสหมดอายุแล้ว ขอรหัสใหม่เพื่อดำเนินการต่อ' }
    if (error.code === 'EMAIL_UNAVAILABLE') return { expired: true, message: 'มีบัญชีอื่นใช้อีเมลนี้ไปแล้ว กรุณาใช้อีเมลอื่น' }
    if (error.status === 422) return { expired: false, message: 'รหัสไม่ถูกต้อง ตรวจรหัส 8 หลักในอีเมลแล้วลองใหม่' }
    if (error.status === 429) return { expired: false, message: 'ลองหลายครั้งเกินไป กรุณารอประมาณ 10 นาทีแล้วลองใหม่' }
  }
  return { expired: false, message: rateLimitedOrOffline(error) ?? 'ยืนยันอีเมลไม่สำเร็จ กรุณาลองใหม่' }
}

function clearSession(queryClient: QueryClient) {
  clearCustomerQueries(queryClient)
  queryClient.setQueryData(authSessionQuery.queryKey, null)
}

export function expireSecuritySession(queryClient: QueryClient, error: unknown) {
  if (!(error instanceof AuthRequestError) || error.status !== 401) return false
  clearSession(queryClient)
  return true
}

export async function performAccountDeletion(queryClient: QueryClient, deleteAccount: () => Promise<unknown>) {
  await deleteAccount()
  clearSession(queryClient)
}

export function accountDeletionFailureMessage(error: unknown) {
  if (error instanceof AccountRequestError) {
    if (error.code === 'INVALID_CURRENT_PASSWORD') return 'รหัสผ่านไม่ถูกต้อง'
    if (error.code === 'ACCOUNT_HAS_OPEN_ORDERS') return 'ยังมีคำสั่งซื้อที่ยังไม่เสร็จสิ้น รอให้ได้รับสินค้าหรือยกเลิกคำสั่งซื้อก่อนลบบัญชี'
    if (error.status === 429) return 'ลองใหม่อีกครั้งในภายหลัง'
  }
  return 'ลบบัญชีไม่สำเร็จ กรุณาลองใหม่'
}

export async function performSignOut(queryClient: QueryClient, signOut: () => Promise<void>) {
  await signOut()
  clearSession(queryClient)
}

export async function performRevokeSession(
  queryClient: QueryClient,
  token: string,
  current: boolean,
  revoke: (token: string) => Promise<void>,
) {
  await revoke(token)
  if (current) clearSession(queryClient)
  return current
}
