import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { parseBackupCodesFile } from '@/lib/backup-codes'
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
  const [fileCodes, setFileCodes] = useState<string[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const fileReadId = useRef(0)

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
      if (state === 'onboarding') {
        navigate('/staff/onboarding', { replace: true })
        return
      }
      if (state !== 'active') throw new AuthRequestError(401, 'SESSION_EXPIRED', 'Session expired')
      navigate(safeReturnTo(routeState?.from), { replace: true })
    } catch (caught) {
      if (caught instanceof AuthRequestError && ['INVALID_TWO_FACTOR_CHALLENGE', 'INVALID_TWO_FACTOR_COOKIE', 'SESSION_EXPIRED'].includes(caught.code)) {
        navigate('/login', { replace: true, state: { reason: 'Your verification session expired. Sign in again.' } })
      } else {
        setError(caught instanceof AuthRequestError ? caught.message : 'Could not verify the code. Try again.')
      }
    } finally {
      setPending(false)
    }
  }

  async function loadBackupCodes(event: React.ChangeEvent<HTMLInputElement>) {
    const currentReadId = ++fileReadId.current
    const file = event.currentTarget.files?.[0]
    setFileCodes([])
    setCode('')
    setError(null)
    setFileError(null)
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.txt') || file.size > 32 * 1024) {
      setFileError(file.size > 32 * 1024
        ? 'This file is too large to read.'
        : 'Choose a .txt backup-codes file.')
      event.currentTarget.value = ''
      return
    }

    try {
      const codes = parseBackupCodesFile(await file.text())
      if (currentReadId !== fileReadId.current) return
      setFileCodes(codes)
    } catch (caught) {
      if (currentReadId !== fileReadId.current) return
      setFileError(caught instanceof Error ? caught.message : 'Could not read this backup-codes file.')
    }
  }

  function changeMode() {
    fileReadId.current += 1
    setMode(mode === 'totp' ? 'backup' : 'totp')
    setCode('')
    setFileCodes([])
    setError(null)
    setFileError(null)
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
          {mode === 'backup' && (
            <Field data-invalid={!!fileError}>
              <FieldLabel htmlFor="backup-codes-file">Choose backup codes file</FieldLabel>
              <Input
                id="backup-codes-file"
                type="file"
                accept=".txt,text/plain"
                onChange={(event) => void loadBackupCodes(event)}
                aria-invalid={!!fileError}
              />
              <p className="text-sm text-muted-foreground">The file is read on this device. Only the code you select is sent for verification.</p>
              {fileError && <FieldError>{fileError}</FieldError>}
            </Field>
          )}
          {fileCodes.length > 0 && (
            <div className="flex flex-col gap-2" aria-label="Codes from selected file">
              <p className="text-sm font-medium">Choose an unused code</p>
              <div className="flex flex-wrap gap-2">
                {fileCodes.map((backupCode, index) => (
                  <Button
                    key={`${backupCode}-${index}`}
                    type="button"
                    size="sm"
                    variant={code === backupCode ? 'secondary' : 'outline'}
                    aria-pressed={code === backupCode}
                    onClick={() => { setCode(backupCode); setError(null) }}
                  >
                    Use backup code {index + 1} ending {backupCode.slice(-4)}
                  </Button>
                ))}
              </div>
            </div>
          )}
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
        onClick={changeMode}
      >
        {mode === 'totp' ? 'Use a backup code' : 'Use authenticator code'}
      </Button>
    </div>
  )
}
