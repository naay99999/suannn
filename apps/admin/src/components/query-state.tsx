import { Button } from '@workspace/ui/components/button'
import { Empty, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Skeleton } from '@workspace/ui/components/skeleton'

type QueryStateKind = 'loading' | 'error' | 'not-found' | 'forbidden' | 'empty'

const defaultMessages: Record<Exclude<QueryStateKind, 'loading' | 'error' | 'empty'>, string> = {
  'not-found': 'ไม่พบข้อมูลที่ต้องการ',
  forbidden: 'ไม่มีสิทธิ์เข้าถึง',
}

export function QueryState({ kind, message, onRetry }: {
  kind: QueryStateKind
  message?: string
  onRetry?: () => void
}) {
  if (kind === 'loading') {
    return (
      <div aria-busy="true" aria-live="polite" className="flex flex-col gap-3" role="status">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-3/4" />
        <span className="sr-only">กำลังโหลดข้อมูล...</span>
      </div>
    )
  }

  if (kind === 'empty') {
    return (
      <Empty className="min-h-48 border-0">
        <EmptyHeader>
          <EmptyTitle>{message ?? 'ยังไม่มีข้อมูล'}</EmptyTitle>
        </EmptyHeader>
        {onRetry && <Button onClick={onRetry} variant="outline">ลองอีกครั้ง</Button>}
      </Empty>
    )
  }

  const content = message ?? (kind === 'error' ? 'ไม่สามารถโหลดข้อมูลได้ กรุณาลองอีกครั้ง' : defaultMessages[kind])
  return (
    <div aria-live="polite" className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center" role={kind === 'forbidden' || kind === 'not-found' ? 'status' : 'alert'}>
      {kind === 'forbidden' || kind === 'not-found'
        ? <h2 className="text-lg font-semibold">{content}</h2>
        : <p className="text-sm text-muted-foreground">{content}</p>}
      {onRetry && <Button onClick={onRetry} variant="outline">ลองอีกครั้ง</Button>}
    </div>
  )
}
