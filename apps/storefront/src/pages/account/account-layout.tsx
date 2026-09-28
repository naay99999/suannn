import { NavLink, Outlet, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { authSessionQuery } from '@/lib/auth-session'
import { signOut } from '@/lib/auth-client'
import { performSignOut } from './customer-security'

const navigation = [
  { to: '/account', label: 'ภาพรวม', end: true },
  { to: '/account/orders', label: 'คำสั่งซื้อ', end: false },
  { to: '/account/addresses', label: 'ที่อยู่', end: true },
  { to: '/account/profile', label: 'ข้อมูลส่วนตัว', end: true },
  { to: '/account/security', label: 'ความปลอดภัย', end: true },
]

export function AccountLayout() {
  const session = useQuery(authSessionQuery).data
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const signOutMutation = useMutation({
    mutationFn: () => performSignOut(queryClient, signOut),
    onSuccess: () => navigate('/sign-in', { replace: true }),
  })

  return (
      <div className="w-full max-w-full overflow-x-hidden">
        <div className="mb-10 max-w-5xl md:mb-14">
          <p className="mb-4 text-sm font-medium text-primary-ink">พื้นที่ของคุณในสวน</p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl md:text-6xl">บัญชีของคุณ</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">รวมรายการที่สนใจและข้อมูลสำหรับการสั่งซื้อไว้ในที่เดียว</p>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            {session && <p className="text-sm text-muted-foreground">{session.user.email}</p>}
            <Button type="button" variant="outline" size="sm" disabled={signOutMutation.isPending} onClick={() => signOutMutation.mutate()}>ออกจากระบบ</Button>
          </div>
          {signOutMutation.isError && <p role="alert" className="mt-3 text-sm text-destructive">ออกจากระบบไม่ได้ กรุณาลองใหม่</p>}
        </div>
        <div className="grid items-start gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
          <nav aria-label="เมนูบัญชี" className="-mx-5 overflow-x-auto px-5 lg:mx-0 lg:overflow-visible lg:px-0">
            <div className="flex w-max gap-2 pb-2 lg:w-full lg:flex-col">
              {navigation.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => cn(
                    'whitespace-nowrap rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none',
                    isActive ? 'bg-accent text-primary-ink' : 'text-muted-foreground',
                  )}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </nav>
          <div className="min-w-0"><Outlet /></div>
        </div>
      </div>
  )
}
