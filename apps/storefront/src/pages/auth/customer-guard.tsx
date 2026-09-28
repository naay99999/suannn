import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, Outlet, useLocation } from 'react-router'
import { Button } from '@workspace/ui/components/button'
import { authSessionQuery, classifyCustomerSession, reconcileCustomerQueries } from '@/lib/auth-session'
import { staffSignInUrl } from '@/lib/auth-navigation'

export function CustomerGuard() {
  const { pathname, search } = useLocation()
  const sessionQuery = useQuery(authSessionQuery)
  const queryClient = useQueryClient()
  const userId = sessionQuery.data?.user.id
  const accountType = sessionQuery.data?.user.accountType

  useEffect(() => {
    if (sessionQuery.isSuccess) reconcileCustomerQueries(queryClient, sessionQuery.data)
  }, [accountType, queryClient, sessionQuery.data, sessionQuery.isSuccess, userId])

  if (sessionQuery.isPending) {
    return <div className="grid min-h-80 place-items-center text-muted-foreground" role="status">กำลังตรวจสอบบัญชี...</div>
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
  if (state === 'staff') {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4 py-20">
        <h1 className="text-2xl font-semibold">พื้นที่นี้สำหรับบัญชีลูกค้า</h1>
        <p className="text-muted-foreground">บัญชีพนักงานไม่สามารถเปิดพื้นที่บัญชีลูกค้าได้</p>
        <a className="font-medium text-primary-ink underline underline-offset-4" href={staffSignInUrl(import.meta.env.VITE_ADMIN_URL || 'http://localhost:5184')}>ไปหน้าเข้าสู่ระบบผู้ดูแล</a>
        <Link className="font-medium text-primary-ink underline underline-offset-4" to="/">กลับหน้าแรก</Link>
      </div>
    )
  }
  return <Outlet key={userId} />
}
