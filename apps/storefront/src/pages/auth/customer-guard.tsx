import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, Outlet, useLocation } from 'react-router'
import { Button } from '@workspace/ui/components/button'
import { authSessionQuery, classifyCustomerSession, reconcileCustomerQueries } from '@/lib/auth-session'
import { PageLoading } from '@/components/loading/page-loading'

export function CustomerGuard() {
  const { pathname, search } = useLocation()
  const sessionQuery = useQuery(authSessionQuery)
  const queryClient = useQueryClient()
  const userId = sessionQuery.data?.user.id

  useEffect(() => {
    if (sessionQuery.isSuccess) reconcileCustomerQueries(queryClient, sessionQuery.data)
  }, [queryClient, sessionQuery.data, sessionQuery.isSuccess, userId])

  if (sessionQuery.isPending) {
    return <PageLoading label="กำลังตรวจสอบบัญชี..." className="min-h-80" />
  }
  if (sessionQuery.isError) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-start gap-4 py-20" role="alert">
        <h1 className="text-2xl font-semibold">ตรวจสอบบัญชีไม่ได้</h1>
        <p className="text-muted-foreground">กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง</p>
        <Button onClick={() => void sessionQuery.refetch()}>ลองอีกครั้ง</Button>
      </div>
    )
  }

  const state = classifyCustomerSession(sessionQuery.data)
  if (state === 'anonymous') {
    const returnTo = encodeURIComponent(`${pathname}${search}`)
    return <Navigate to={`/sign-in?returnTo=${returnTo}`} replace />
  }
  return <Outlet key={userId} />
}
