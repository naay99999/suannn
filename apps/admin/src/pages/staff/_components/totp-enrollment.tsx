import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { AuthRequestError, beginTotp, verifyEnrollment } from '@/lib/auth-client'
import { refreshAuthSession } from '@/lib/auth-session'

interface SetupData {
  totpURI: string
  backupCodes: string[]
}

export function TotpEnrollment() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [setup, setSetup] = useState<SetupData | null>(null)
  const [saved, setSaved] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      const result = await beginTotp(password)
      setSetup(result)
      setPassword('')
    } catch (caught) {
      setError(caught instanceof AuthRequestError ? caught.message : 'Could not start setup. Try again.')
    } finally {
      setPending(false)
    }
  }

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!saved || code.length !== 6) return
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

  if (!setup) {
    return (
      <form onSubmit={(event) => void start(event)}>
        <FieldGroup>
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm">Open this setup link in your authenticator app, or copy the URI into it:</p>
        <a className="break-all text-sm text-primary underline" href={setup.totpURI}>{setup.totpURI}</a>
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="font-medium">Save your backup codes</h2>
        <p className="text-sm text-muted-foreground">Each code works once. Store them somewhere private before continuing.</p>
        <ul className="rounded-md border bg-muted p-4 font-mono text-sm">
          {setup.backupCodes.map((backupCode) => <li key={backupCode}>{backupCode}</li>)}
        </ul>
        <Button type="button" variant="outline" onClick={() => void navigator.clipboard?.writeText(setup.backupCodes.join('\n'))}>Copy backup codes</Button>
      </div>
      <form onSubmit={(event) => void verify(event)}>
        <FieldGroup>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
            I saved my backup codes
          </label>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="setup-code">Authenticator code</FieldLabel>
            <Input id="setup-code" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required aria-invalid={!!error} />
            {error && <FieldError>{error}</FieldError>}
          </Field>
          <Field><Button type="submit" disabled={!saved || code.length !== 6 || pending}>{pending ? 'Verifying…' : 'Verify setup'}</Button></Field>
        </FieldGroup>
      </form>
    </div>
  )
}
