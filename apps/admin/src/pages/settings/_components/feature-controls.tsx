import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { getSecuritySettings, setStaffMfaRequired } from './system-settings-api'

const securitySettingsKey = ['system-settings', 'security'] as const

export function FeatureControls() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: securitySettingsKey, queryFn: getSecuritySettings, retry: false })
  const [reauthNotice, setReauthNotice] = useState(false)
  const [savedNotice, setSavedNotice] = useState('')
  const update = useMutation({
    mutationFn: setStaffMfaRequired,
    onSuccess(result) {
      queryClient.setQueryData(securitySettingsKey, result)
      setReauthNotice(result.staffMfaRequired)
      setSavedNotice(result.staffMfaRequired
        ? ''
        : 'MFA requirement is off. Staff can sign in with email and password.')
    },
  })

  if (settings.isPending) {
    return <p className="text-sm text-muted-foreground" role="status">Loading security settings…</p>
  }

  if (settings.isError || !settings.data) {
    return <p className="text-sm text-destructive" role="alert">Could not load security settings. Refresh and try again.</p>
  }

  const required = settings.data.staffMfaRequired

  return (
    <Card>
      <CardHeader>
        <CardTitle>Staff MFA</CardTitle>
        <CardDescription>Require an authenticator code when staff sign in.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="font-medium">Require MFA for all staff</p>
            <p className="text-sm text-muted-foreground">
              {required
                ? 'Staff must verify with their authenticator. Staff without an enrollment will be asked to set one up.'
                : 'Staff can sign in with email and password. Existing authenticator enrollments are kept.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="Require MFA for all staff"
            aria-checked={required}
            disabled={update.isPending}
            onClick={() => {
              setSavedNotice('')
              setReauthNotice(false)
              update.mutate(!required)
            }}
            className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-checked:bg-primary"
          >
            <span className="pointer-events-none inline-block size-5 translate-x-0.5 rounded-full bg-background shadow transition-transform data-[checked=true]:translate-x-[22px]" data-checked={required} />
          </button>
        </div>
        {update.isError && <p className="text-sm text-destructive" role="alert">{update.error.message || 'Could not update MFA settings. Try again.'}</p>}
        {savedNotice && <p className="text-sm text-muted-foreground" role="status">{savedNotice}</p>}
        {reauthNotice && (
          <div className="flex flex-col items-start gap-3 rounded-md border p-4" role="status">
            <p className="text-sm">MFA is enabled. All staff sessions have ended. Sign in again to continue.</p>
            <Button onClick={() => navigate('/login', {
              replace: true,
              state: { reason: 'MFA is enabled. Sign in again to continue.' },
            })}>Sign in again</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
