import { afterEach, expect, spyOn, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AuthRequestError } from '../src/lib/auth-client'

let acceptedInput: unknown
let acceptCount = 0
let acceptResult: () => Promise<unknown> = async () => ({ accepted: true, next: 'mfa-enrollment' })
let onboardingResult: () => Promise<unknown> = async () => ({ required: true, userId: 'staff-1', totpEnrollmentVerified: false })
let beginResult: () => Promise<unknown> = async () => ({ totpURI: 'otpauth://totp/Suannn:Sam?secret=ABC', backupCodes: ['code-1', 'code-2'] })
let verifyResult: () => Promise<unknown> = async () => ({ verified: true })
let refreshed = false
let refreshResult: () => Promise<string> = async () => 'active'
const activeSpies: Array<{ mockRestore: () => void }> = []

class FakeAuthError extends AuthRequestError {}

function authErrorResponse(error: unknown): Response {
  const authError = error instanceof AuthRequestError ? error : new AuthRequestError(500, 'SERVER_ERROR', 'Request failed')
  return Response.json({ code: authError.code, message: authError.message }, { status: authError.status || 500 })
}

const { Component: InvitationPage } = await import('../src/pages/staff/invitation-page')
const { Component: OnboardingPage } = await import('../src/pages/staff/onboarding-page')

function renderPage(initialPath: string) {
  let sessionRequests = 0
  activeSpies.push(spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null
    if (url.pathname.endsWith('/auth/get-session')) {
      sessionRequests++
      if (sessionRequests > 1) {
        try {
          const state = await refreshResult()
          refreshed = true
          return Response.json({
            session: { id: 'session-1', expiresAt: '2026-10-22T10:00:00Z' },
            user: { id: 'staff-1', name: 'Staff', email: 'staff@example.com', emailVerified: true, image: null, accountType: 'staff' },
            ...(state === 'active' ? { staff: { role: 'owner', permissions: [] } } : {}),
          })
        } catch (error) {
          return authErrorResponse(error)
        }
      }
      return Response.json({
        session: { id: 'session-1', expiresAt: '2026-10-22T10:00:00Z' },
        user: { id: 'staff-1', name: 'Staff', email: 'staff@example.com', emailVerified: true, image: null, accountType: 'staff' },
      })
    }
    if (url.pathname.endsWith('/auth/staff/invitations/accept')) {
      acceptedInput = body
      acceptCount++
      try { return Response.json(await acceptResult()) } catch (error) { return authErrorResponse(error) }
    }
    if (url.pathname.endsWith('/auth/staff/onboarding')) {
      try { return Response.json(await onboardingResult()) } catch (error) { return authErrorResponse(error) }
    }
    if (url.pathname.endsWith('/auth/staff/onboarding/totp/verify')) {
      try { return Response.json(await verifyResult()) } catch (error) { return authErrorResponse(error) }
    }
    if (url.pathname.endsWith('/auth/staff/onboarding/totp')) {
      try { return Response.json(await beginResult()) } catch (error) { return authErrorResponse(error) }
    }
    return Response.json({ code: 'NOT_FOUND', message: 'not found' }, { status: 404 })
  }))
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
  activeSpies.splice(0).forEach((spy) => spy.mockRestore())
  acceptedInput = undefined
  acceptCount = 0
  refreshed = false
  onboardingResult = async () => ({ required: true, userId: 'staff-1', totpEnrollmentVerified: false })
  refreshResult = async () => 'active'
  localStorage.clear()
  sessionStorage.clear()
  Reflect.deleteProperty(navigator, 'clipboard')
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

test('skips MFA onboarding after accepting an invitation when system enforcement is disabled', async () => {
  acceptResult = async () => ({ accepted: true, next: 'dashboard' })
  const router = renderPage('/staff/invitations/accept?token=secret-token-123456')
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Name'), 'Sam')
  await user.type(screen.getByLabelText('New password'), 'strong-password-123')
  await user.click(screen.getByRole('button', { name: 'Accept invitation' }))

  expect(await screen.findByText('Dashboard')).toBeTruthy()
  expect(router.state.location.pathname).toBe('/dashboard')
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

test('shows a responsive QR, hides the manual key, and displays backup codes', async () => {
  beginResult = async () => ({ totpURI: 'otpauth://totp/Suannn:Sam?secret=ABC', backupCodes: ['code-1', 'code-2'] })
  renderPage('/staff/onboarding')
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Current password'), 'strong-password-123')
  await user.click(screen.getByRole('button', { name: 'Start setup' }))
  expect(await screen.findByTitle('Authenticator setup QR code')).toBeTruthy()
  expect(screen.queryByText('otpauth://totp/Suannn:Sam?secret=ABC')).toBeNull()
  expect(screen.getByRole('button', { name: 'Show setup key' })).toBeTruthy()
  expect(screen.getByText('code-1')).toBeTruthy()
  expect(screen.getByText('code-2')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Verify setup' }).hasAttribute('disabled')).toBe(true)
  expect(localStorage.length).toBe(0)
  expect(sessionStorage.length).toBe(0)
})

test('reveals and copies the setup key and backup codes with confirmation', async () => {
  const copied: string[] = []
  beginResult = async () => ({ totpURI: 'otpauth://totp/Suannn:Sam?secret=ABC', backupCodes: ['code-1', 'code-2'] })
  renderPage('/staff/onboarding')
  const user = userEvent.setup()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (value: string) => { copied.push(value) } },
  })
  await user.type(screen.getByLabelText('Current password'), 'strong-password-123')
  await user.click(screen.getByRole('button', { name: 'Start setup' }))
  await user.click(await screen.findByRole('button', { name: 'Show setup key' }))
  expect(screen.getByText('ABC')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Copy setup key' }))
  expect(copied).toContain('ABC')
  expect(await screen.findByText('Setup key copied.')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Copy backup codes' }))
  expect(copied).toContain('code-1\ncode-2')
  expect(await screen.findByText('Backup codes copied.')).toBeTruthy()
})

test('keeps an invalid TOTP code on the setup form', async () => {
  beginResult = async () => ({ totpURI: 'otpauth://totp/Suannn:Sam?secret=ABC', backupCodes: ['code-1'] })
  verifyResult = async () => { throw new FakeAuthError(400, 'INVALID_CODE', 'Invalid code') }
  renderPage('/staff/onboarding')
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Current password'), 'strong-password-123')
  await user.click(screen.getByRole('button', { name: 'Start setup' }))
  await user.click(await screen.findByRole('checkbox', { name: 'I saved my backup codes' }))
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
  await user.click(await screen.findByRole('checkbox', { name: 'I saved my backup codes' }))
  await user.type(screen.getByLabelText('Authenticator code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Verify setup' }))
  expect(await screen.findByText('Dashboard')).toBeTruthy()
  expect(router.state.location.pathname).toBe('/dashboard')
  expect(refreshed).toBe(true)
})

test('resumes activation when the authenticator code was verified before the session update failed', async () => {
  onboardingResult = async () => ({ required: true, userId: 'staff-1', totpEnrollmentVerified: true })
  verifyResult = async () => ({ verified: true })
  const router = renderPage('/staff/onboarding')
  const user = userEvent.setup()
  expect(await screen.findByText(/Your authenticator is already paired/)).toBeTruthy()
  expect(screen.queryByLabelText('Current password')).toBeNull()
  expect(screen.queryByTitle('Authenticator setup QR code')).toBeNull()
  await user.type(screen.getByLabelText('Authenticator code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Complete setup' }))
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
