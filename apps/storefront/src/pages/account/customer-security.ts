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
    }]
  })
}

export function securityFailureMessage(_error: unknown) {
  return 'ดำเนินการไม่ได้ กรุณาลองใหม่'
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
