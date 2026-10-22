import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { ApiRequestError } from '@/lib/api-result'
import { platformLabel, syncResultText } from '@/lib/marketing/format'
import { useSyncSpendMutation } from '@/lib/marketing/queries'

export function SyncButton() {
  const sync = useSyncSpendMutation()
  const error = sync.error
  return (
    <div className="flex flex-col items-end gap-2">
      <Button disabled={sync.isPending} onClick={() => sync.mutate()} variant="outline">
        {sync.isPending && <Spinner data-icon="inline-start" />}
        ซิงก์ตอนนี้
      </Button>
      <div aria-live="polite" className="text-sm">
        {sync.data && (
          <ul className="flex flex-col items-end gap-0.5 text-muted-foreground">
            {sync.data.results.map((result) => <li key={result.platform}>{platformLabel(result.platform)}: {syncResultText(result)}</li>)}
          </ul>
        )}
        {error && (
          <p className="text-destructive">
            {error instanceof ApiRequestError && error.status === 429 ? 'ซิงก์บ่อยเกินไป กรุณารอสักครู่' : error.message}
          </p>
        )}
      </div>
    </div>
  )
}
