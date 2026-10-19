import { useEffect, useState, type ReactNode } from 'react'
import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Button } from '@workspace/ui/components/button'

// Icon button that copies text and briefly confirms the result for sighted and screen-reader users.
export function CopyButton({ value, label, copiedMessage = 'คัดลอกแล้ว', size = 'icon-sm' }: { value: string; label: string; copiedMessage?: string; size?: 'icon-sm' | 'icon-xs' }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const timer = setTimeout(() => setState('idle'), 2000)
    return () => clearTimeout(timer)
  }, [state])
  async function copy() {
    try { await navigator.clipboard.writeText(value); setState('copied') }
    catch { setState('failed') }
  }
  return <span className="inline-flex items-center gap-1">
    <Button variant="ghost" size={size} className="text-muted-foreground hover:text-foreground" aria-label={label} title={label} onClick={() => void copy()}><HugeiconsIcon icon={state === 'copied' ? Tick02Icon : Copy01Icon} strokeWidth={2} /></Button>
    <span role="status" className={state === 'failed' ? 'text-xs text-destructive' : 'sr-only'}>{state === 'copied' ? copiedMessage : state === 'failed' ? 'คัดลอกไม่ได้' : ''}</span>
  </span>
}

// One copyable value per row, with the copy button aligned at the row's end.
export function CopyRow({ value, label, copiedMessage, children }: { value: string; label: string; copiedMessage?: string; children: ReactNode }) {
  return <div className="flex items-start justify-between gap-2">
    <div className="min-w-0 flex-1">{children}</div>
    <CopyButton value={value} label={label} copiedMessage={copiedMessage} size="icon-xs" />
  </div>
}
