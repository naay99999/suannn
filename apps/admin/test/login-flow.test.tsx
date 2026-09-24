import { afterEach, expect, mock, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'

let signInResult: () => Promise<'challenge' | 'session'> = async () => 'challenge'
let refreshResult: () => Promise<string> = async () => 'active'
let verifyResult: () => Promise<void> = async () => undefined
let backupResult: () => Promise<void> = async () => undefined

class FakeAuthError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

mock.module('../src/lib/auth-client', () => ({
  signIn: () => signInResult(),
  verifyTotp: () => verifyResult(),
  verifyBackupCode: () => backupResult(),
  AuthRequestError: FakeAuthError,
}))
mock.module('../src/lib/auth-session', () => ({ refreshAuthSession: () => refreshResult() }))

const { LoginForm } = await import('../src/pages/login/_components/login-form')
const { MfaForm } = await import('../src/pages/login/_components/mfa-form')

function renderFlow(from?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([
    { path: '/login', element: <LoginForm /> },
    { path: '/login/mfa', element: <MfaForm /> },
    { path: '/dashboard', element: <div>Dashboard</div> },
    { path: '/orders', element: <div>Orders</div> },
  ], { initialEntries: [{ pathname: '/login', state: from ? { from } : undefined }] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}

afterEach(() => cleanup())

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
