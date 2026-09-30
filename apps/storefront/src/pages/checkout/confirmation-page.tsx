import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Link, useLocation } from 'react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkCircle01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@workspace/ui/components/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { getCartSummary } from '@/lib/cart'
import { OrderSummary } from './order-summary'
import type { ConfirmationState } from './checkout-types'

gsap.registerPlugin(ScrollTrigger, useGSAP)

export function Component() {
  const scope = useRef<HTMLDivElement>(null)
  const { state } = useLocation() as { state: ConfirmationState | null }
  const hasPreview = Boolean(state?.details && state?.cart && getCartSummary(state.cart).lines.length)

  useGSAP(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    gsap.utils.toArray<HTMLElement>('[data-confirm-card]').forEach((card) => {
      gsap.fromTo(card, { y: 18, opacity: 0.88 }, {
        y: 0,
        opacity: 1,
        ease: 'none',
        scrollTrigger: { trigger: card, start: 'top 95%', end: 'top 72%', scrub: 0.4 },
      })
    })
  }, { scope, dependencies: [hasPreview] })

  if (!hasPreview || !state) {
    return (
      <div className="w-full max-w-full overflow-x-hidden">
        <title>ตัวอย่างคำสั่งซื้อ | suannn</title>
        <Empty className="rounded-3xl border bg-card py-20">
          <EmptyHeader>
            <EmptyTitle>ยังไม่มีรายการให้แสดง</EmptyTitle>
            <EmptyDescription>กลับไปตรวจสอบตะกร้าและกรอกข้อมูลจัดส่งเพื่อดูตัวอย่างหน้านี้</EmptyDescription>
          </EmptyHeader>
          <EmptyContent><Button render={<Link to="/checkout" />} nativeButton={false} size="storefront">กลับไปหน้า checkout</Button></EmptyContent>
        </Empty>
      </div>
    )
  }

  const { details, cart } = state

  return (
    <div ref={scope} className="w-full max-w-full overflow-x-hidden">
      <title>ตัวอย่างหน้ายืนยันคำสั่งซื้อ | suannn</title>
      <div className="max-w-5xl pb-12 md:pb-16">
        <div className="mb-6 flex size-14 items-center justify-center rounded-full bg-accent text-primary-ink" aria-hidden="true">
          <HugeiconsIcon icon={CheckmarkCircle01Icon} className="size-8" />
        </div>
        <p className="mb-4 text-sm font-medium text-primary-ink">ตัวอย่างหน้ายืนยัน</p>
        <h1 className="max-w-5xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl md:text-6xl">รายการของคุณ พร้อมให้ตรวจสอบ</h1>
        <p className="mt-5 max-w-2xl text-base leading-8 text-muted-foreground">นี่เป็นตัวอย่างหลังตรวจสอบรายการเท่านั้น ร้านยังไม่ได้รับคำสั่งซื้อ และยังไม่มีการชำระเงินหรือจัดส่ง</p>
      </div>

      <div className="grid grid-flow-dense items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.78fr)] lg:gap-12">
        <div className="flex min-w-0 flex-col gap-6">
          <section data-confirm-card aria-labelledby="shipping-title" className="rounded-3xl border bg-card p-5 md:p-8">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="shipping-title" className="text-2xl font-semibold">ข้อมูลจัดส่งที่กรอกไว้</h2>
              <Link to="/checkout" state={{ details }} className="text-sm font-medium text-primary-ink underline underline-offset-4 hover:text-foreground">แก้ไขข้อมูล</Link>
            </div>
            <dl className="mt-6 grid gap-5 text-sm sm:grid-cols-2">
              <div className="flex flex-col gap-1"><dt className="text-muted-foreground">ผู้รับ</dt><dd className="font-medium">{details.name}</dd></div>
              <div className="flex flex-col gap-1"><dt className="text-muted-foreground">เบอร์โทรศัพท์</dt><dd className="font-medium">{details.phone}</dd></div>
              <div className="flex flex-col gap-1 sm:col-span-2"><dt className="text-muted-foreground">อีเมล</dt><dd className="font-medium break-all">{details.email}</dd></div>
              <div className="flex flex-col gap-1 sm:col-span-2"><dt className="text-muted-foreground">ที่อยู่</dt><dd className="font-medium leading-7">{details.addressLine1}{details.addressLine2 ? ` ${details.addressLine2}` : ''}<br />{details.subdistrict} {details.district} {details.province} {details.postalCode}</dd></div>
            </dl>
          </section>
          <section data-confirm-card aria-labelledby="next-title" className="rounded-3xl bg-accent p-5 md:p-8">
            <h2 id="next-title" className="text-2xl font-semibold">เมื่อร้านเปิดรับคำสั่งซื้อ</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">ระบบจะแจ้งยอดรวมพร้อมค่าจัดส่ง และส่งรายละเอียดคำสั่งซื้อให้ตรวจสอบอีกครั้งก่อนยืนยันจริง</p>
          </section>
          <Button render={<Link to="/products" />} nativeButton={false} size="storefront" className="self-start">
            เลือกสินค้าเพิ่มเติม <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
          </Button>
        </div>
        <div data-confirm-card><OrderSummary cart={cart} /></div>
      </div>
    </div>
  )
}
