import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'

export function CopyableId({ value, label }: { value: string; label: string }) {
  const [feedback, setFeedback] = useState('')

  async function copy() {
    if (!navigator.clipboard?.writeText) {
      setFeedback('เบราว์เซอร์นี้ไม่รองรับการคัดลอก')
      return
    }
    try {
      await navigator.clipboard.writeText(value)
      setFeedback('คัดลอกแล้ว')
    } catch {
      setFeedback('คัดลอกไม่สำเร็จ')
    }
  }

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-2">
      <code className="break-all text-xs text-muted-foreground">{value}</code>
      <Button aria-label={`คัดลอก${label}`} onClick={() => void copy()} size="sm" type="button" variant="ghost">คัดลอก</Button>
      {feedback && <span aria-live="polite" className="sr-only" role="status">{feedback}</span>}
    </span>
  )
}
