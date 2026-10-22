import { Empty, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { QueryState } from '@/components/query-state'
import { ApiRequestError } from '@/lib/api-result'

// Missing PostHog read credentials is a setup state, not a failure.
export function PosthogState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  if (error instanceof ApiRequestError && error.code === 'POSTHOG_READ_NOT_CONFIGURED') {
    return (
      <Empty className="min-h-32 border border-dashed">
        <EmptyHeader>
          <EmptyTitle className="text-sm font-normal text-muted-foreground">ยังไม่ได้เชื่อม PostHog สำหรับอ่านข้อมูล — ดูวิธีตั้งค่าใน README หัวข้อ Marketing page</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  return <QueryState kind="error" message={error.message} onRetry={onRetry} />
}
