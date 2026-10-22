import { Button } from '@workspace/ui/components/button'

export function ConsentBanner({ onAccept, onReject, onSettings }: { onAccept: () => void; onReject: () => void; onSettings: () => void }) {
  return (
    <section
      aria-label="ความยินยอมคุกกี้"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)]"
    >
      <div className="page-width flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between md:gap-6 md:py-4">
        <p className="text-sm leading-6 text-muted-foreground">
          เราใช้คุกกี้เพื่อวิเคราะห์การใช้งานและการตลาด คุณเลือกได้ว่าจะอนุญาตหรือไม่
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
