import { Spinner } from '@workspace/ui/components/spinner'
import { cn } from '@workspace/ui/lib/utils'

/**
 * Status for loads with no known layout to mirror (session checks, payment checks, quotes).
 * Fades in after a short delay so fast responses never flash a spinner.
 */
export function PageLoading({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" className={cn('flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground animate-in fade-in fill-mode-both delay-200 duration-300', className)}>
      <Spinner aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}
