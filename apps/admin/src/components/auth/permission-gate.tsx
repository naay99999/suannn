import { useQuery } from '@tanstack/react-query'
import { Outlet } from 'react-router'
import { QueryState } from '@/components/query-state'
import { authSessionQuery } from '@/lib/auth-session'
import { hasPermission } from '@/lib/permissions'

export function PermissionGate({ permission }: { permission: string }) {
  const sessionQuery = useQuery(authSessionQuery)

  if (sessionQuery.isPending) return <QueryState kind="loading" />
  if (sessionQuery.isError) {
    return <QueryState kind="error" message="ไม่สามารถตรวจสอบสิทธิ์ได้ กรุณาลองอีกครั้ง" onRetry={() => void sessionQuery.refetch()} />
  }
  if (!hasPermission(sessionQuery.data, permission)) return <QueryState kind="forbidden" />

  return <Outlet />
}
