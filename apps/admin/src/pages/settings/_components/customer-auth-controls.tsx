import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { getCustomerAuthSettings, setCustomerEmailVerificationRequired } from './customer-auth-settings-api'

const customerAuthSettingsKey = ['system-settings', 'customer-auth'] as const

export function CustomerAuthControls() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: customerAuthSettingsKey, queryFn: getCustomerAuthSettings, retry: false })
  const [savedNotice, setSavedNotice] = useState('')
  const update = useMutation({
    mutationFn: setCustomerEmailVerificationRequired,
    onSuccess(result) {
      queryClient.setQueryData(customerAuthSettingsKey, result)
      setSavedNotice(result.emailVerificationRequired
        ? 'Email verification is required. Unverified customers were signed out and must verify before signing in again.'
        : 'Email verification is optional. New customers are signed in right after registering.')
    },
  })

  if (settings.isPending) {
    return <p className="text-sm text-muted-foreground" role="status">Loading customer sign-in settings…</p>
  }

  if (settings.isError || !settings.data) {
    return <p className="text-sm text-destructive" role="alert">Could not load customer sign-in settings. Refresh and try again.</p>
  }

  const required = settings.data.emailVerificationRequired

  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer email verification</CardTitle>
        <CardDescription>Control whether storefront customers must confirm their email before signing in.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="font-medium">Require verified email to sign in</p>
            <p className="text-sm text-muted-foreground">
              {required
                ? 'Customers must open the verification link before they can sign in.'
                : 'Customers can sign in right after registering. Cash on delivery still needs a verified email.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="Require verified email to sign in"
            aria-checked={required}
            disabled={update.isPending}
            onClick={() => {
              setSavedNotice('')
              update.mutate(!required)
            }}
            className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-checked:bg-primary"
          >
            <span className="pointer-events-none inline-block size-5 translate-x-0.5 rounded-full bg-background shadow transition-transform data-[checked=true]:translate-x-[22px]" data-checked={required} />
          </button>
        </div>
        {update.isError && <p className="text-sm text-destructive" role="alert">{update.error.message || 'Could not update the verification setting. Try again.'}</p>}
        {savedNotice && <p className="text-sm text-muted-foreground" role="status">{savedNotice}</p>}
      </CardContent>
    </Card>
  )
}
