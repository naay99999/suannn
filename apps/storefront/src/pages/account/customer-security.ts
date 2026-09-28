import type { QueryClient } from '@tanstack/react-query'
import { AuthRequestError } from '@/lib/auth-client'
import { authSessionQuery, clearCustomerQueries } from '@/lib/auth-session'

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
