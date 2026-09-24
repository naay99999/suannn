import { afterEach, expect, mock, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'

let acceptedInput: unknown
let acceptCount = 0
let acceptResult: () => Promise<unknown> = async () => ({ accepted: true, next: 'mfa-enrollment' })
let beginResult: () => Promise<unknown> = async () => ({ totpURI: 'otpauth://totp/Suannn:Sam?secret=ABC', backupCodes: ['code-1', 'code-2'] })
let verifyResult: () => Promise<unknown> = async () => ({ verified: true })
let refreshed = false
let refreshResult: () => Promise<string> = async () => 'active'

class FakeAuthError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

mock.module('../src/lib/auth-client', () => ({
  acceptInvitation: (input: unknown) => { acceptedInput = input; acceptCount++; return acceptResult() },
  beginTotp: () => beginResult(),
  verifyEnrollment: () => verifyResult(),
  AuthRequestError: FakeAuthError,
}))
mock.module('../src/lib/auth-session', () => ({
  authSessionQuery: { queryKey: ['auth', 'session'] },
  refreshAuthSession: async () => { refreshed = true; return refreshResult() },
}))

const { Component: InvitationPage } = await import('../src/pages/staff/invitation-page')
const { Component: OnboardingPage } = await import('../src/pages/staff/onboarding-page')

function renderPage(initialPath: string) {
  const client = new QueryClient()
  const router = createMemoryRouter([
    { path: '/staff/invitations/accept', element: <InvitationPage /> },
    { path: '/staff/onboarding', element: <OnboardingPage /> },
    { path: '/dashboard', element: <div>Dashboard</div> },
  ], { initialEntries: [initialPath] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}

afterEach(() => {
  cleanup()
  acceptedInput = undefined
  acceptCount = 0
  refreshed = false
  refreshResult = async () => 'active'
  localStorage.clear()
  sessionStorage.clear()
})

test('removes invitation token from the URL and accepts the supplied account', async () => {
  acceptResult = async () => ({ accepted: true, next: 'mfa-enrollment' })
  const router = renderPage('/staff/invitations/accept?token=secret-token-123456')
  expect(router.state.location.search).toBe('')
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Name'), 'Sam')
  await user.type(screen.getByLabelText('New password'), 'strong-password-123')
  await user.click(screen.getByRole('button', { name: 'Accept invitation' }))
  expect(acceptedInput).toEqual({ token: 'secret-token-123456', name: 'Sam', password: 'strong-password-123' })
  expect(await screen.findByText('Set up your authenticator')).toBeTruthy()
  expect(localStorage.length).toBe(0)
  expect(sessionStorage.length).toBe(0)
})

test('explains a missing or expired invitation link', async () => {
  renderPage('/staff/invitations/accept')
  expect(screen.getByText('Reopen the invitation link in your email.')).toBeTruthy()
  cleanup()
  acceptResult = async () => { throw new FakeAuthError(410, 'INVITATION_EXPIRED', 'Invitation expired') }
  renderPage('/staff/invitations/accept?token=secret-token-123456')
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Name'), 'Sam')
  await user.type(screen.getByLabelText('New password'), 'strong-password-123')
  await user.click(screen.getByRole('button', { name: 'Accept invitation' }))
  expect(await screen.findByText('This invitation expired. Ask an administrator for a new invitation.')).toBeTruthy()
})

test('shows TOTP URI and backup codes after password confirmation', async () => {
  beginResult = async () => ({ totpURI: 'otpauth://totp/Suannn:Sam?secret=ABC', backupCodes: ['code-1', 'code-2'] })
  renderPage('/staff/onboarding')
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Current password'), 'strong-password-123')
  await user.click(screen.getByRole('button', { name: 'Start setup' }))
  expect(await screen.findByText('otpauth://totp/Suannn:Sam?secret=ABC')).toBeTruthy()
  expect(screen.getByText('code-1')).toBeTruthy()
  expect(screen.getByText('code-2')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Verify setup' }).hasAttribute('disabled')).toBe(true)
  expect(localStorage.length).toBe(0)
  expect(sessionStorage.length).toBe(0)
})

test('keeps an invalid TOTP code on the setup form', async () => {
  beginResult = async () => ({ totpURI: 'otpauth://totp/Suannn:Sam?secret=ABC', backupCodes: ['code-1'] })
  verifyResult = async () => { throw new FakeAuthError(400, 'INVALID_CODE', 'Invalid code') }
  renderPage('/staff/onboarding')
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Current password'), 'strong-password-123')
  await user.click(screen.getByRole('button', { name: 'Start setup' }))
  await user.click(await screen.findByLabelText('I saved my backup codes'))
  await user.type(screen.getByLabelText('Authenticator code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Verify setup' }))
  expect(await screen.findByText('Invalid code')).toBeTruthy()
  expect(refreshed).toBe(false)
})

test('refreshes the active staff session after successful TOTP enrollment', async () => {
  beginResult = async () => ({ totpURI: 'otpauth://totp/Suannn:Sam?secret=ABC', backupCodes: ['code-1'] })
  verifyResult = async () => ({ verified: true })
  const router = renderPage('/staff/onboarding')
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Current password'), 'strong-password-123')
  await user.click(screen.getByRole('button', { name: 'Start setup' }))
  await user.click(await screen.findByLabelText('I saved my backup codes'))
  await user.type(screen.getByLabelText('Authenticator code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Verify setup' }))
  expect(await screen.findByText('Dashboard')).toBeTruthy()
  expect(router.state.location.pathname).toBe('/dashboard')
  expect(refreshed).toBe(true)
})

test('delegates session recovery after acceptance without retrying the invitation', async () => {
  acceptResult = async () => ({ accepted: true, next: 'mfa-enrollment' })
  refreshResult = async () => { throw new FakeAuthError(0, 'NETWORK_ERROR', 'Offline') }
  renderPage('/staff/invitations/accept?token=secret-token-123456')
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Name'), 'Sam')
  await user.type(screen.getByLabelText('New password'), 'strong-password-123')
  await user.click(screen.getByRole('button', { name: 'Accept invitation' }))
  expect(await screen.findByText('Set up your authenticator')).toBeTruthy()
  expect(acceptCount).toBe(1)
  expect(refreshed).toBe(false)
  expect(screen.queryByRole('button', { name: 'Accept invitation' })).toBeNull()
})
