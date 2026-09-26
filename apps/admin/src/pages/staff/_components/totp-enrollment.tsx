import { useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '@workspace/ui/components/button'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { BackupCodesPanel } from '@/components/auth/backup-codes-panel'
import { AuthRequestError, beginTotp, getOnboarding, verifyEnrollment } from '@/lib/auth-client'
import { authSessionQuery, refreshAuthSession } from '@/lib/auth-session'

interface SetupData {
  totpURI: string
  backupCodes: string[]
}

export function TotpEnrollment() {
  const queryClient = useQueryClient()
  const sessionQuery = useQuery(authSessionQuery)
  const onboardingQuery = useQuery({
    queryKey: ['auth', 'onboarding', sessionQuery.data?.session.id],
    queryFn: getOnboarding,
    enabled: !!sessionQuery.data?.session.id,
    retry: false,
  })
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [setup, setSetup] = useState<SetupData | null>(null)
  const [saved, setSaved] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [showSetupKey, setShowSetupKey] = useState(false)
  const [feedback, setFeedback] = useState('')
  const alreadyVerified = onboardingQuery.data?.totpEnrollmentVerified === true

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      const result = await beginTotp(password)
      setSetup(result)
      setPassword('')
      setFeedback('')
      setShowSetupKey(false)
    } catch (caught) {
      setError(caught instanceof AuthRequestError ? caught.message : 'Could not start setup. Try again.')
    } finally {
      setPending(false)
    }
  }

  async function copyText(value: string, successMessage: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE')
      await navigator.clipboard.writeText(value)
      setFeedback(successMessage)
    } catch {
      setFeedback('Clipboard is unavailable. Select the text and copy it manually.')
    }
  }

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if ((!alreadyVerified && !saved) || code.length !== 6) return
    setError(null)
    setPending(true)
    try {
      await verifyEnrollment(code)
      const state = await refreshAuthSession(queryClient)
      if (state !== 'active') throw new AuthRequestError(401, 'SESSION_EXPIRED', 'Session expired. Sign in again.')
      setSetup(null)
      navigate('/dashboard', { replace: true })
    } catch (caught) {
      setError(caught instanceof AuthRequestError ? caught.message : 'Could not verify the code. Try again.')
    } finally {
      setPending(false)
    }
  }

  if (alreadyVerified) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm">Your authenticator is already paired. Enter its current code to finish activating your admin account.</p>
        <form onSubmit={(event) => void verify(event)}>
          <FieldGroup>
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor="setup-code">Authenticator code</FieldLabel>
              <Input id="setup-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required aria-invalid={!!error} />
              {error && <FieldError>{error}</FieldError>}
            </Field>
            <Field><Button type="submit" disabled={code.length !== 6 || pending}>{pending ? 'Verifying…' : 'Complete setup'}</Button></Field>
          </FieldGroup>
        </form>
      </div>
    )
  }

  if (!setup) {
    return (
      <form onSubmit={(event) => void start(event)}>
        <FieldGroup>
          <p className="text-sm text-muted-foreground">Keep this page open while pairing your authenticator. If the page reloads, start setup again; codes shown here are available only during this setup.</p>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="setup-password">Current password</FieldLabel>
            <Input id="setup-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} aria-invalid={!!error} />
            {error && <FieldError>{error}</FieldError>}
          </Field>
          <Field><Button type="submit" disabled={pending}>{pending ? 'Starting…' : 'Start setup'}</Button></Field>
        </FieldGroup>
      </form>
    )
  }

  let setupKey = ''
  try {
    setupKey = new URL(setup.totpURI).searchParams.get('secret') ?? ''
  } catch {
    setupKey = ''
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-center text-sm">Scan this QR code with your authenticator app.</p>
        <div className="mx-auto w-fit max-w-full rounded-md border p-2 sm:p-3">
          <QRCodeSVG className="block h-auto w-[min(64vw,16rem)] max-w-full" value={setup.totpURI} size={256} level="M" marginSize={4} title="Authenticator setup QR code" />
        </div>
        <p className="text-center text-sm text-muted-foreground">Keep this screen private until setup is complete.</p>
        <Button type="button" variant="outline" className="self-center" onClick={() => setShowSetupKey((visible) => !visible)} disabled={!setupKey}>
          {showSetupKey ? 'Hide setup key' : 'Show setup key'}
        </Button>
        {showSetupKey && setupKey && (
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <p className="break-all font-mono text-sm" aria-label="Authenticator setup key">{setupKey}</p>
            <Button type="button" variant="outline" onClick={() => void copyText(setupKey, 'Setup key copied.')}>Copy setup key</Button>
          </div>
        )}
        <p className="min-h-5 text-center text-sm text-muted-foreground" role="status" aria-live="polite">{feedback}</p>
      </div>
      <BackupCodesPanel codes={setup.backupCodes} />
      <form onSubmit={(event) => void verify(event)}>
        <FieldGroup>
          <Field orientation="horizontal">
            <Checkbox id="saved-backup-codes" checked={saved} onCheckedChange={(value) => setSaved(value === true)} />
            <FieldLabel htmlFor="saved-backup-codes">I saved my backup codes</FieldLabel>
          </Field>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="setup-code">Authenticator code</FieldLabel>
          <Input id="setup-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required aria-invalid={!!error} />
            {error && <FieldError>{error}</FieldError>}
          </Field>
          <Field><Button type="submit" disabled={!saved || code.length !== 6 || pending}>{pending ? 'Verifying…' : 'Verify setup'}</Button></Field>
        </FieldGroup>
      </form>
    </div>
  )
}
