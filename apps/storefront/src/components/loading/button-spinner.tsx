import { Spinner } from '@workspace/ui/components/spinner'

/** Leading spinner for a shared `Button` while its action is pending; the button keeps its accessible name. */
export function ButtonSpinner({ show }: { show: boolean }) {
  return show ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null
}
