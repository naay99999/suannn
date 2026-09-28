import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router'
import { Button } from '@workspace/ui/components/button'
import { authSessionQuery, clearCustomerQueries } from '@/lib/auth-session'
import { classifyAccountError } from './account-state'

export function AccountQueryFeedback({ error, retry }: { error: unknown; retry: () => void }) {
  const queryClient = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const kind = classifyAccountError(error)

  useEffect(() => {
    if (kind !== 'signed-out') return
    clearCustomerQueries(queryClient)
    queryClient.setQueryData(authSessionQuery.queryKey, null)
    const returnTo = encodeURIComponent(`${location.pathname}${location.search}`)
    navigate(`/sign-in?returnTo=${returnTo}`, { replace: true })
  }, [kind, location.pathname, location.search, navigate, queryClient])

  if (kind === 'signed-out') {
    return <p role="status" className="py-12 text-muted-foreground">กรุณาเข้าสู่ระบบอีกครั้ง...</p>
  }
  if (kind === 'not-found') return <p role="status" className="py-12 text-muted-foreground">ไม่พบข้อมูลนี้</p>
  if (kind === 'forbidden') return <p role="alert" className="py-12 text-destructive">บัญชีนี้ยังไม่สามารถเปิดข้อมูลส่วนนี้ได้ กรุณาตรวจสอบการยืนยันอีเมล</p>
  return <div role="alert" className="flex flex-col items-start gap-4 py-12"><p>โหลดข้อมูลไม่ได้ กรุณาลองอีกครั้ง</p><Button onClick={retry}>ลองอีกครั้ง</Button></div>
}
