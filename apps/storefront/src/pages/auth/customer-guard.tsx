import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, Outlet, useLocation } from 'react-router'
import { Button } from '@workspace/ui/components/button'
import { authSessionQuery, classifyCustomerSession } from '@/lib/auth-session'

export function CustomerGuard() {
  const { pathname, search } = useLocation()
  const sessionQuery = useQuery(authSessionQuery)

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
        <Link className="font-medium text-primary-ink underline underline-offset-4" to="/">กลับหน้าแรก</Link>
      </div>
    )
  }
  return <Outlet />
}
