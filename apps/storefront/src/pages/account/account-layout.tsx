import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { authSessionQuery } from '@/lib/auth-session'
import { signOut } from '@/lib/auth-client'
import { performSignOut } from './customer-security'
import { ButtonSpinner } from '@/components/loading/button-spinner'

const navigation = [
  { to: '/account', label: 'ภาพรวม', end: true },
  { to: '/account/orders', label: 'คำสั่งซื้อ', end: false },
  { to: '/account/addresses', label: 'ที่อยู่', end: true },
  { to: '/account/profile', label: 'ข้อมูลส่วนตัว', end: true },
  { to: '/account/security', label: 'ความปลอดภัย', end: true },
]

// Fades whichever edge of the tab strip has more tabs beyond it.
const edgeMasks = {
  both: '[mask-image:linear-gradient(to_right,transparent,black_2.5rem,black_calc(100%-2.5rem),transparent)]',
  start: '[mask-image:linear-gradient(to_right,transparent,black_2.5rem)]',
  end: '[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]',
}

// Below lg the tabs scroll sideways: keep the current tab in view and hint at the hidden ones.
function useTabStrip() {
  const strip = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()
  const [edges, setEdges] = useState({ start: false, end: false })
  const sync = useCallback(() => {
    const element = strip.current
    if (!element) return
    setEdges({ start: element.scrollLeft > 1, end: element.scrollLeft + element.clientWidth < element.scrollWidth - 1 })
  }, [])

  useEffect(() => {
    const element = strip.current
    const active = element?.querySelector<HTMLElement>('[aria-current="page"]')
    if (element && active && element.scrollWidth > element.clientWidth) {
      element.scrollLeft = active.offsetLeft - (element.clientWidth - active.offsetWidth) / 2
    }
    sync()
  }, [pathname, sync])

  useEffect(() => {
    const element = strip.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(sync)
    observer.observe(element)
    return () => observer.disconnect()
  }, [sync])

  const mask = edges.start && edges.end ? edgeMasks.both : edges.start ? edgeMasks.start : edges.end ? edgeMasks.end : undefined
  return { strip, sync, mask }
}

export function AccountLayout() {
  const session = useQuery(authSessionQuery).data
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { strip, sync, mask } = useTabStrip()
  const signOutMutation = useMutation({
    mutationFn: () => performSignOut(queryClient, signOut),
    onSuccess: () => navigate('/sign-in', { replace: true }),
  })

  return (
      <div className="w-full min-w-0">
        <div className="mb-8 border-b pb-6 md:mb-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="mb-2 text-sm font-medium text-primary-ink">พื้นที่ของคุณในสวน</p>
              <h1 className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl">บัญชีของคุณ</h1>
            </div>
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-4 gap-y-2">
              {session && <p className="min-w-0 max-w-full truncate text-sm text-muted-foreground">{session.user.email}</p>}
              <Button type="button" variant="outline" disabled={signOutMutation.isPending} onClick={() => signOutMutation.mutate()}><ButtonSpinner show={signOutMutation.isPending} />ออกจากระบบ</Button>
            </div>
          </div>
          {signOutMutation.isError && <p role="alert" className="mt-3 text-sm text-destructive">ออกจากระบบไม่ได้ กรุณาลองใหม่</p>}
        </div>
        <div className="grid items-start gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
          <nav aria-label="เมนูบัญชี" className="min-w-0">
            <div ref={strip} onScroll={sync} className={cn('relative flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0 lg:[mask-image:none]', mask)}>
              {navigation.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => cn(
                    'shrink-0 whitespace-nowrap rounded-control px-4 py-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none',
                    isActive ? 'bg-accent text-primary-ink' : 'text-muted-foreground',
                  )}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </nav>
          <div className="account-area min-w-0"><Outlet /></div>
        </div>
      </div>
  )
}
