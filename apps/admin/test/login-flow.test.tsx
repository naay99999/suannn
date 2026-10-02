import { afterEach, expect, spyOn, test } from 'bun:test'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AuthRequestError } from '../src/lib/auth-client'
import type { AuthSession, AuthState } from '../src/lib/auth-session'

let signInResult: () => Promise<'challenge' | 'session'> = async () => 'challenge'
let refreshResult: () => Promise<string> = async () => 'active'
let initialAuthState: 'anonymous' | 'customer' | 'onboarding' | 'active' = 'anonymous'
let verifyResult: () => Promise<void> = async () => undefined
let backupResult: () => Promise<void> = async () => undefined
let backupCodesSubmitted: string[] = []
const activeSpies: Array<{ mockRestore: () => void }> = []

class FakeAuthError extends AuthRequestError {}

function sessionForState(state: AuthState): AuthSession | null {
  if (state === 'anonymous') return null
  return {
    session: { id: 'session-1', expiresAt: '2026-10-22T10:00:00Z' },
    user: {
      id: 'staff-1', name: 'Staff', email: 'sam@example.com', emailVerified: true,
      image: null, accountType: state === 'customer' ? 'customer' : 'staff',
    },
    ...(state === 'active' ? { staff: { role: 'owner', permissions: [] } } : {}),
  }
}

const { LoginForm } = await import('../src/pages/login/_components/login-form')
const { Component: LoginPage } = await import('../src/pages/login/login-page')
const { MfaForm } = await import('../src/pages/login/_components/mfa-form')

function installAuthBoundary() {
  let afterSignIn = false
  activeSpies.push(spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null
    if (url.pathname.endsWith('/auth/get-session')) {
      return Response.json(sessionForState(afterSignIn ? await refreshResult() as AuthState : initialAuthState))
    }
    if (url.pathname.endsWith('/auth/sign-in/email')) {
      afterSignIn = true
      try {
        return Response.json(await signInResult() === 'challenge' ? { twoFactorRedirect: true } : {})
      } catch (error) {
        return authErrorResponse(error)
      }
    }
    if (url.pathname.endsWith('/auth/two-factor/verify-totp')) {
      try {
        await verifyResult()
        return Response.json({})
      } catch (error) {
        return authErrorResponse(error)
      }
    }
    if (url.pathname.endsWith('/auth/two-factor/verify-backup-code')) {
      backupCodesSubmitted.push(String(body?.code ?? ''))
      try {
        await backupResult()
        return Response.json({})
      } catch (error) {
        return authErrorResponse(error)
      }
    }
    return Response.json({ code: 'NOT_FOUND', message: 'not found' }, { status: 404 })
  }))
}

function renderFlow(from?: string) {
  installAuthBoundary()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([
    { path: '/login', element: <LoginForm /> },
    { path: '/login/mfa', element: <MfaForm /> },
    { path: '/staff/onboarding', element: <div>Set up your authenticator</div> },
    { path: '/dashboard', element: <div>Dashboard</div> },
    { path: '/orders', element: <div>Orders</div> },
  ], { initialEntries: [{ pathname: '/login', state: from ? { from } : undefined }] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}

afterEach(() => {
  cleanup()
  activeSpies.splice(0).forEach((spy) => spy.mockRestore())
  signInResult = async () => 'challenge'
  verifyResult = async () => undefined
  backupResult = async () => undefined
  backupCodesSubmitted = []
  refreshResult = async () => 'active'
  initialAuthState = 'anonymous'
})

function authErrorResponse(error: unknown): Response {
  const authError = error instanceof AuthRequestError ? error : new AuthRequestError(500, 'SERVER_ERROR', 'Request failed')
  return Response.json({ code: authError.code, message: authError.message }, { status: authError.status || 500 })
}

async function enterPassword() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), 'sam@example.com')
  await user.type(screen.getByLabelText('Password'), 'password')
  await user.click(screen.getByRole('button', { name: 'Login' }))
  return user
}

test('moves a password sign-in challenge to the MFA page', async () => {
  signInResult = async () => 'challenge'
  const router = renderFlow('/orders')
  await enterPassword()
  expect(await screen.findByLabelText('Authenticator code')).toBeTruthy()
  expect(router.state.location.pathname).toBe('/login/mfa')
})

test('opens a safe deep link after an active staff login', async () => {
  signInResult = async () => 'session'
  refreshResult = async () => 'active'
  const router = renderFlow('/orders')
  await enterPassword()
  expect(await screen.findByText('Orders')).toBeTruthy()
  expect(router.state.location.pathname).toBe('/orders')
})

test('does not enter admin for a customer session', async () => {
  signInResult = async () => 'session'
  refreshResult = async () => 'customer'
  renderFlow()
  await enterPassword()
  expect(await screen.findByText('Use a staff account to sign in.')).toBeTruthy()
  expect(screen.queryByText('Dashboard')).toBeNull()
})

test('redirects an already signed-in staff member from login to the dashboard', async () => {
  initialAuthState = 'active'
  installAuthBoundary()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([
    { path: '/login', element: <LoginPage /> },
    { path: '/dashboard', element: <div>Dashboard</div> },
    { path: '/staff/onboarding', element: <div>Set up your authenticator</div> },
  ], { initialEntries: ['/login'] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)

  expect(await screen.findByText('Dashboard')).toBeTruthy()
  expect(router.state.location.pathname).toBe('/dashboard')
  expect(screen.queryByLabelText('Email')).toBeNull()
})

test('sends an already signed-in owner with incomplete onboarding to setup', async () => {
  initialAuthState = 'onboarding'
  installAuthBoundary()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([
    { path: '/login', element: <LoginPage /> },
    { path: '/dashboard', element: <div>Dashboard</div> },
    { path: '/staff/onboarding', element: <div>Set up your authenticator</div> },
  ], { initialEntries: ['/login'] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)

  expect(await screen.findByText('Set up your authenticator')).toBeTruthy()
  expect(router.state.location.pathname).toBe('/staff/onboarding')
})

test('shows an invalid-credentials error on the login form', async () => {
  signInResult = async () => { throw new FakeAuthError(401, 'INVALID_EMAIL_OR_PASSWORD', 'Invalid email or password') }
  renderFlow()
  await enterPassword()
  expect(await screen.findByText('Invalid email or password')).toBeTruthy()
})

test('verifies a TOTP challenge and returns to the intended page', async () => {
  signInResult = async () => 'challenge'
  refreshResult = async () => 'active'
  verifyResult = async () => undefined
  const router = renderFlow('/orders')
  const user = await enterPassword()
  await user.type(await screen.findByLabelText('Authenticator code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Verify' }))
  expect(await screen.findByText('Orders')).toBeTruthy()
  expect(router.state.location.pathname).toBe('/orders')
})

test('continues to MFA onboarding when sign-in succeeds for an unfinished owner', async () => {
  signInResult = async () => 'challenge'
  refreshResult = async () => 'onboarding'
  verifyResult = async () => undefined
  const router = renderFlow()
  const user = await enterPassword()
  await user.type(await screen.findByLabelText('Authenticator code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Verify' }))
  expect(await screen.findByText('Set up your authenticator')).toBeTruthy()
  expect(router.state.location.pathname).toBe('/staff/onboarding')
})

test('accepts a backup code and keeps invalid codes on the MFA form', async () => {
  signInResult = async () => 'challenge'
  backupResult = async () => { throw new FakeAuthError(400, 'INVALID_CODE', 'Invalid backup code') }
  renderFlow()
  const user = await enterPassword()
  await user.click(await screen.findByRole('button', { name: 'Use a backup code' }))
  await user.type(screen.getByLabelText('Backup code'), 'backup-123')
  await user.click(screen.getByRole('button', { name: 'Verify' }))
  expect(await screen.findByText('Invalid backup code')).toBeTruthy()
  expect(screen.getByLabelText('Backup code')).toBeTruthy()
})

test('lets the user choose one code from a downloaded backup-codes file', async () => {
  signInResult = async () => 'challenge'
  backupResult = async () => undefined
  renderFlow()
  const user = await enterPassword()
  await user.click(await screen.findByRole('button', { name: 'Use a backup code' }))
  await user.upload(screen.getByLabelText('Choose backup codes file'), new File([
    '# Suannn admin backup codes\n# Keep this file private.\n\nbackup-0123\nbackup-4567\n',
  ], 'backup-codes.txt', { type: 'text/plain' }))
  await user.click(await screen.findByRole('button', { name: 'Use backup code 1 ending 0123' }))
  expect((screen.getByLabelText('Backup code') as HTMLInputElement).value).toBe('backup-0123')
  await user.click(screen.getByRole('button', { name: 'Verify' }))
  expect(backupCodesSubmitted).toEqual(['backup-0123'])
  expect(await screen.findByText('Dashboard')).toBeTruthy()
})

test('ignores an older backup-codes file read that finishes after a newer selection', async () => {
  signInResult = async () => 'challenge'
  renderFlow()
  const user = await enterPassword()
  await user.click(await screen.findByRole('button', { name: 'Use a backup code' }))
  const input = screen.getByLabelText('Choose backup codes file')
  let finishFirstRead!: (text: string) => void
  const firstFile = new File([''], 'first.txt', { type: 'text/plain' })
  Object.defineProperty(firstFile, 'text', {
    value: () => new Promise<string>((resolve) => { finishFirstRead = resolve }),
  })

  await user.upload(input, firstFile)
  await user.upload(input, new File(['backup-2222'], 'second.txt', { type: 'text/plain' }))
  expect(await screen.findByRole('button', { name: 'Use backup code 1 ending 2222' })).toBeTruthy()

  await act(async () => {
    finishFirstRead('backup-1111')
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(screen.queryByRole('button', { name: 'Use backup code 1 ending 1111' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Use backup code 1 ending 2222' })).toBeTruthy()
})

test('keeps malformed backup-codes files local and reports an error', async () => {
  signInResult = async () => 'challenge'
  renderFlow()
  const user = await enterPassword()
  await user.click(await screen.findByRole('button', { name: 'Use a backup code' }))
  await user.upload(screen.getByLabelText('Choose backup codes file'), new File(['# no backup codes'], 'empty.txt', { type: 'text/plain' }))
  expect((await screen.findByRole('alert')).textContent).toContain('This file does not contain valid backup codes.')
  expect(screen.getByLabelText('Choose backup codes file').getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByLabelText('Backup code').getAttribute('aria-invalid')).toBe('false')
  expect(screen.queryByRole('button', { name: /Use backup code/ })).toBeNull()
  expect(backupCodesSubmitted).toEqual([])
})

test('returns to login when the MFA challenge has expired', async () => {
  signInResult = async () => 'challenge'
  verifyResult = async () => { throw new FakeAuthError(400, 'INVALID_TWO_FACTOR_CHALLENGE', 'Invalid two-factor challenge') }
  renderFlow()
  const user = await enterPassword()
  await user.type(await screen.findByLabelText('Authenticator code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Verify' }))
  expect(await screen.findByText('Your verification session expired. Sign in again.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Login' })).toBeTruthy()
})

test('restarts login when Better Auth rejects a stale TOTP challenge cookie', async () => {
  signInResult = async () => 'challenge'
  verifyResult = async () => { throw new FakeAuthError(401, 'INVALID_TWO_FACTOR_COOKIE', 'Invalid two-factor cookie') }
  renderFlow()
  const user = await enterPassword()
  await user.type(await screen.findByLabelText('Authenticator code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Verify' }))
  expect(await screen.findByText('Your verification session expired. Sign in again.')).toBeTruthy()
})

test('restarts login when Better Auth rejects a stale backup-code challenge cookie', async () => {
  signInResult = async () => 'challenge'
  backupResult = async () => { throw new FakeAuthError(401, 'INVALID_TWO_FACTOR_COOKIE', 'Invalid two-factor cookie') }
  renderFlow()
  const user = await enterPassword()
  await user.click(await screen.findByRole('button', { name: 'Use a backup code' }))
  await user.type(screen.getByLabelText('Backup code'), 'backup-123')
  await user.click(screen.getByRole('button', { name: 'Verify' }))
  expect(await screen.findByText('Your verification session expired. Sign in again.')).toBeTruthy()
})
