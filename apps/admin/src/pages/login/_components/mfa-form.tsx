import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { AuthRequestError, verifyBackupCode, verifyTotp } from '@/lib/auth-client'
import { refreshAuthSession } from '@/lib/auth-session'
import { safeReturnTo } from '@/lib/return-to'

export function MfaForm() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const routeState = location.state as { challenge?: boolean; from?: string } | null
  const [mode, setMode] = useState<'totp' | 'backup'>('totp')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!routeState?.challenge) {
      navigate('/login', { replace: true, state: { reason: 'Sign in before entering a verification code.' } })
    }
  }, [navigate, routeState?.challenge])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      if (mode === 'totp') await verifyTotp(code)
      else await verifyBackupCode(code)
      const state = await refreshAuthSession(queryClient)
      if (state !== 'active') throw new AuthRequestError(401, 'SESSION_EXPIRED', 'Session expired')
      navigate(safeReturnTo(routeState?.from), { replace: true })
    } catch (caught) {
      if (caught instanceof AuthRequestError && ['INVALID_TWO_FACTOR_CHALLENGE', 'SESSION_EXPIRED'].includes(caught.code)) {
        navigate('/login', { replace: true, state: { reason: 'Your verification session expired. Sign in again.' } })
      } else {
        setError(caught instanceof AuthRequestError ? caught.message : 'Could not verify the code. Try again.')
      }
    } finally {
      setPending(false)
    }
  }

  if (!routeState?.challenge) return null

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-xl font-bold">Verify your sign in</h1>
        <p className="text-sm text-muted-foreground">Enter a code from your authenticator or a saved backup code.</p>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <FieldGroup>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="mfa-code">{mode === 'totp' ? 'Authenticator code' : 'Backup code'}</FieldLabel>
            <Input
              id="mfa-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              inputMode={mode === 'totp' ? 'numeric' : 'text'}
              aria-invalid={!!error}
              required
              minLength={mode === 'totp' ? 6 : 1}
              maxLength={mode === 'totp' ? 6 : 100}
            />
            {error && <FieldError>{error}</FieldError>}
          </Field>
          <Field><Button type="submit" disabled={pending}>{pending ? 'Verifying…' : 'Verify'}</Button></Field>
        </FieldGroup>
      </form>
      <Button
        variant="ghost"
        type="button"
        onClick={() => { setMode(mode === 'totp' ? 'backup' : 'totp'); setCode(''); setError(null) }}
      >
        {mode === 'totp' ? 'Use a backup code' : 'Use authenticator code'}
      </Button>
    </div>
  )
}
