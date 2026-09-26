import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { BackupCodesPanel } from '@/components/auth/backup-codes-panel'
import { AuthRequestError, regenerateBackupCodes } from '@/lib/auth-client'

export function SecuritySettings() {
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setPending(true)
    try {
      const result = await regenerateBackupCodes(password)
      setCodes(result.backupCodes)
      setPassword('')
      setConfirmed(false)
    } catch (caught) {
      setError(caught instanceof AuthRequestError ? caught.message : 'Could not regenerate backup codes. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Card className="border-0 shadow-none ring-0">
      <CardHeader>
        <CardTitle>Security</CardTitle>
        <CardDescription>Manage recovery codes for your authenticator.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void submit(event)}>
          <FieldGroup>
            <p className="text-sm text-muted-foreground" role="note">Regenerating codes immediately invalidates every existing backup code. The new set is shown once, so save or download it before leaving this page.</p>
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor="mfa-regenerate-password">Current password</FieldLabel>
              <Input
                id="mfa-regenerate-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                aria-invalid={!!error}
              />
              {error && <FieldError>{error}</FieldError>}
            </Field>
            <Field orientation="horizontal">
              <Checkbox id="confirm-backup-code-regeneration" checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />
              <FieldLabel htmlFor="confirm-backup-code-regeneration">I understand my existing codes will stop working</FieldLabel>
            </Field>
            <Field>
              <Button type="submit" disabled={!password || !confirmed || pending}>
                {pending ? 'Regenerating…' : 'Regenerate backup codes'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
        {codes && (
          <div className="mt-6 flex flex-col gap-3">
            <p role="status" className="text-sm font-medium">Existing backup codes have been replaced. Save this new set now.</p>
            <BackupCodesPanel
              codes={codes}
              title="New backup codes"
              description="Each code works once. Store this set somewhere private; the previous set no longer works."
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
