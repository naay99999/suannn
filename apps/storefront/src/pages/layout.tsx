import { useEffect, useState } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { Link, Outlet, useLocation } from 'react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowUpRight01Icon, Cancel01Icon, Menu01Icon, UserCircleIcon } from '@hugeicons/core-free-icons'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@workspace/ui/components/dialog'
import { cn } from '@workspace/ui/lib/utils'

import { CartProvider } from '@/components/cart/cart-provider'
import { CartTrigger, SideCart } from '@/components/cart/side-cart'
import { authSessionQuery } from '@/lib/auth-session'
import { staffSignInUrl } from '@/lib/auth-navigation'
import type { CustomerSession, StaffSession } from '@/lib/auth-client'

const navigation = [
  { label: 'สินค้าทั้งหมด', to: '/products' },
  { label: 'ที่มาของสินค้า', to: '/#from-the-farm' },
  { label: 'สวนและคนปลูก', to: '/farms' },
  { label: 'เกี่ยวกับเรา', to: '/#our-story' },
]

function HeaderAccountAction({ session, className, onNavigate }: {
  session: UseQueryResult<CustomerSession | StaffSession | null>
  className: string
  onNavigate?: () => void
}) {
  if (session.isPending) {
    return <Button variant="outline" className={className} disabled aria-busy="true">กำลังตรวจสอบบัญชี</Button>
  }

  if (session.isError) {
    return (
      <Button variant="outline" className={className} title="ตรวจสอบบัญชีไม่ได้ กดลองอีกครั้ง" onClick={() => void session.refetch()}>
        ตรวจสอบบัญชีอีกครั้ง
      </Button>
    )
  }

  if (session.data?.user.accountType === 'staff') {
    return (
      <a className={cn(buttonVariants({ variant: 'outline' }), className)} href={staffSignInUrl(import.meta.env.VITE_ADMIN_URL || 'http://localhost:5184')} onClick={onNavigate}>
        ไปหน้าผู้ดูแล <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" />
      </a>
    )
  }

  const isCustomer = session.data?.user.accountType === 'customer'
  return (
    <Link
      className={cn(buttonVariants({ variant: isCustomer ? 'outline' : 'default' }), className)}
      to={isCustomer ? '/account' : '/sign-in'}
      onClick={onNavigate}
    >
      {isCustomer && <HugeiconsIcon icon={UserCircleIcon} data-icon="inline-start" />}
      {isCustomer ? 'บัญชีของฉัน' : 'เข้าสู่ระบบ'}
      {!isCustomer && <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" />}
    </Link>
  )
}

export function StorefrontLayout() {
  return <CartProvider><StorefrontShell /></CartProvider>
}

function StorefrontShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const session = useQuery(authSessionQuery)
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (!hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname, hash])

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)')
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false)
    }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  const authPath = pathname.replace(/\/+$/, '')
  const isAuthPage = ['/sign-in', '/sign-up', '/forgot-password', '/reset-password'].includes(authPath)
    || /^\/reset-password\/[^/]+$/.test(authPath)

  if (isAuthPage) {
    return (
      <div className="suannn-store flex min-h-dvh flex-col bg-background text-foreground">
        <a className="skip-link" href="#main-content">ข้ามไปเนื้อหาหลัก</a>
        <header className="page-width w-full">
          <nav aria-label="เมนูหลัก" className="flex min-h-22 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-4">
            <Link className="suannn-logo" to="/" aria-label="suannn หน้าแรก">suannn<span>.</span></Link>
            <Link className="inline-flex min-h-11 items-center text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" to="/products">กลับไปเลือกสินค้า</Link>
          </nav>
        </header>
        <main id="main-content" tabIndex={-1} className="flex w-full min-w-0 flex-1 outline-none">
          <Outlet />
        </main>
      </div>
    )
  }

  return (
    <div className="suannn-store flex min-h-svh flex-col bg-background text-foreground">
      <a className="skip-link" href="#main-content">
        ข้ามไปเนื้อหาหลัก
      </a>
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <header className="suannn-header">
          <div className="page-width flex h-22 items-center justify-between gap-6">
            <Link
              className="suannn-logo"
              to="/"
              aria-label="suannn หน้าแรก"
              onClick={() => setMenuOpen(false)}
            >
              suannn<span>.</span>
            </Link>
            <nav aria-label="เมนูหลัก" className="hidden items-center gap-6 text-sm md:flex lg:gap-9">
              {navigation.map((item) => (
                <Link key={item.to} className="nav-link" to={item.to}>
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <CartTrigger />
              <HeaderAccountAction session={session} className="hidden h-11 rounded-full px-5 sm:inline-flex" onNavigate={() => setMenuOpen(false)} />
              <DialogTrigger render={<Button variant="ghost" size="icon-lg" className="md:hidden" />} aria-label="เปิดเมนู">
                <HugeiconsIcon icon={Menu01Icon} />
              </DialogTrigger>
            </div>
          </div>
        </header>
        <DialogContent
          showCloseButton={false}
          className="suannn-store inset-0 top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-background p-0 text-foreground sm:max-w-none data-open:zoom-in-100 data-closed:zoom-out-100 motion-reduce:animate-none"
        >
          <DialogTitle className="sr-only">เมนูหลัก</DialogTitle>
          <DialogDescription className="sr-only">เลือกหน้าที่ต้องการ หรือจัดการบัญชีของคุณ</DialogDescription>
          <div className="page-width flex h-22 shrink-0 items-center justify-between gap-6 border-b">
            <Link className="suannn-logo" to="/" aria-label="suannn หน้าแรก" onClick={() => setMenuOpen(false)}>
              suannn<span>.</span>
            </Link>
            <DialogClose render={<Button variant="ghost" size="icon-lg" />} aria-label="ปิดเมนู">
              <HugeiconsIcon icon={Cancel01Icon} />
            </DialogClose>
          </div>
          <nav aria-label="เมนูมือถือ" className="page-width flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain py-8">
            {navigation.map((item) => (
              <Link
                key={item.to}
                className="flex items-center justify-between gap-4 rounded-xl px-3 py-5 text-2xl font-medium hover:bg-muted focus-visible:outline-ring"
                to={item.to}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
                <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-5 shrink-0" aria-hidden="true" />
              </Link>
            ))}
            <div className="mt-auto pt-8 pb-[env(safe-area-inset-bottom)]">
              <HeaderAccountAction session={session} className="h-12 w-full rounded-full px-5" onNavigate={() => setMenuOpen(false)} />
            </div>
          </nav>
        </DialogContent>
      </Dialog>
      <main
        id="main-content"
        tabIndex={-1}
        className={cn(
          'w-full max-w-full flex-1 overflow-x-clip outline-none',
          pathname !== '/' && 'page-width py-10 md:py-16',
        )}
      >
        <Outlet />
      </main>
      <footer className="page-width w-full pb-7 pt-20">
        <div className="flex flex-col justify-between gap-10 border-b pb-12 md:flex-row">
          <div>
            <Link to="/" className="suannn-logo text-5xl" aria-label="suannn หน้าแรก">
              suannn<span>.</span>
            </Link>
            <p className="mt-5 text-sm leading-7 text-muted-foreground">
              คัดจากสวน ส่งต่อด้วยความตั้งใจ
              <br />
              เชื่อมคนกิน กับคนปลูก
            </p>
          </div>
          <div className="flex flex-wrap gap-x-16 gap-y-8 text-sm">
            <div className="flex flex-col gap-4">
              <p className="font-semibold">เดินเล่นในสวน</p>
              <Link className="nav-link" to="/products">
                ผลไม้และของอร่อย
              </Link>
              <Link className="nav-link" to="/#collections">
                เลือกตามหมวดหมู่
              </Link>
            </div>
            <div className="flex flex-col gap-4">
              <p className="font-semibold">เรื่องของสวน</p>
              <Link className="nav-link" to="/#our-story">
                ความตั้งใจของเรา
              </Link>
              <Link className="nav-link" to="/#from-the-farm">
                ความโปร่งใสของสินค้า
              </Link>
              <Link className="nav-link" to="/farms">สวนและคนปลูก</Link>
            </div>
          </div>
        </div>
        <div className="flex flex-col justify-between gap-3 pt-6 text-xs text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} suannn. Grown with care, shared with you.</p>
          <p>ภาพและรายการสินค้าเป็นตัวอย่างสำหรับหน้าเว็บไซต์</p>
        </div>
      </footer>
      <SideCart />
    </div>
  )
}
