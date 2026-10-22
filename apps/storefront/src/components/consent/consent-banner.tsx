import { useLayoutEffect, useRef } from 'react'
import { Link } from 'react-router'
import { Button } from '@workspace/ui/components/button'

const OFFSET_VAR = '--consent-banner-offset'

export function ConsentBanner({ onAccept, onReject, onSettings }: { onAccept: () => void; onReject: () => void; onSettings: () => void }) {
  const ref = useRef<HTMLElement>(null)

  // Sticky mobile CTAs sit above the banner by reading this variable.
  useLayoutEffect(() => {
    const element = ref.current
    const root = document.documentElement
    if (!element) return
    const publish = () => root.style.setProperty(OFFSET_VAR, `${element.offsetHeight}px`)
    publish()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish)
    observer?.observe(element)
    return () => {
      observer?.disconnect()
      root.style.setProperty(OFFSET_VAR, '0px')
    }
  }, [])

  return (
    <section
      ref={ref}
      aria-label="ความยินยอมคุกกี้"
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-background pb-[env(safe-area-inset-bottom)]"
    >
      <div className="page-width flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between md:gap-6 md:py-4">
        <p className="text-sm leading-6 text-muted-foreground">
          เราใช้คุกกี้เพื่อวิเคราะห์การใช้งานและการตลาด คุณเลือกได้ว่าจะอนุญาตหรือไม่{' '}
          <Link className="underline underline-offset-4" to="/privacy">นโยบายความเป็นส่วนตัว</Link>
        </p>
        <div className="grid shrink-0 grid-cols-3 gap-2">
          <Button variant="outline" onClick={onAccept}>ยอมรับทั้งหมด</Button>
          <Button variant="outline" onClick={onReject}>ปฏิเสธ</Button>
          <Button variant="outline" onClick={onSettings}>ตั้งค่า</Button>
        </div>
      </div>
    </section>
  )
}
