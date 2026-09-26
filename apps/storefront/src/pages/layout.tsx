import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowUpRight01Icon, Cancel01Icon, Menu01Icon } from '@hugeicons/core-free-icons'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

import { CartProvider } from '@/components/cart/cart-provider'
import { CartTrigger, SideCart } from '@/components/cart/side-cart'

const navigation = [
  { label: 'เลือกซื้อสินค้า', to: '/products' },
  { label: 'จากสวนถึงคุณ', to: '/#from-the-farm' },
  { label: 'รู้จัก suannn', to: '/#our-story' },
]

export function StorefrontLayout() {
  return <CartProvider><StorefrontShell /></CartProvider>
}

function StorefrontShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (!hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname, hash])

  return (
    <div className="suannn-store flex min-h-svh flex-col bg-background text-foreground">
      <a className="skip-link" href="#main-content">
        ข้ามไปเนื้อหาหลัก
      </a>
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
          <nav aria-label="เมนูหลัก" className="hidden items-center gap-9 text-sm md:flex">
            {navigation.map((item) => (
              <Link key={item.to} className="nav-link" to={item.to}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <CartTrigger />
            <Link
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'hidden h-11 rounded-full px-5 sm:inline-flex',
              )}
              to="/products"
            >
              เข้าไปเดินสวน <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" />
            </Link>
            <Button
              variant="ghost"
              size="icon-lg"
              className="md:hidden"
              aria-label={menuOpen ? 'ปิดเมนู' : 'เปิดเมนู'}
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <HugeiconsIcon icon={menuOpen ? Cancel01Icon : Menu01Icon} />
            </Button>
          </div>
        </div>
        {menuOpen && (
          <nav
            id="mobile-navigation"
            aria-label="เมนูมือถือ"
            className="page-width flex flex-col gap-1 pb-5 md:hidden"
          >
            {navigation.map((item) => (
              <Link
                key={item.to}
                className="rounded-xl px-3 py-3 hover:bg-muted"
                to={item.to}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
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
