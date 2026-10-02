import { afterEach, expect, spyOn, test } from 'bun:test'
import { act, cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { AuthSession } from '../src/lib/auth-session'

let sessionResult: () => Promise<AuthSession | null> = async () => null
let onboardingResult: () => Promise<{ required: true; userId: string }> = async () => ({ required: true, userId: 'user-1' })
let sessionRequests = 0
const activeSpies: Array<{ mockRestore: () => void }> = []

const { ActiveStaffGate, OnboardingStaffGate } = await import('../src/components/auth/auth-gate')

const staffSession: AuthSession = {
  session: { id: 'session-1', expiresAt: '2026-09-24T12:00:00.000Z' },
  user: { id: 'user-1', name: 'Sam', email: 'sam@example.com', emailVerified: true, image: null, accountType: 'staff' },
  staff: { role: 'owner', permissions: ['staff:read'] },
}

function renderRoute(path = '/dashboard') {
  activeSpies.push(spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname.endsWith('/auth/get-session')) {
      sessionRequests++
      return Response.json(await sessionResult())
    }
    if (url.pathname.endsWith('/auth/staff/onboarding')) {
      try {
        return Response.json(await onboardingResult())
      } catch (error) {
        const status = typeof error === 'object' && error !== null && 'status' in error
          && typeof error.status === 'number' ? error.status : 0
        if (status < 400) throw error
        return Response.json({ code: status === 401 ? 'SESSION_EXPIRED' : 'FORBIDDEN', message: 'denied' }, { status })
      }
    }
    return Response.json({ code: 'NOT_FOUND', message: 'not found' }, { status: 404 })
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([
    { path: '/login', element: <div>Login screen</div> },
    { path: '/staff/onboarding', element: <OnboardingStaffGate />, children: [{ index: true, element: <div>MFA setup</div> }] },
    { element: <ActiveStaffGate />, children: [
      { path: '/dashboard', element: <div>Admin content</div> },
      { path: '/orders', element: <div>Orders content</div> },
    ] },
  ], { initialEntries: [path] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return { client, router }
}

afterEach(() => {
  cleanup()
  activeSpies.splice(0).forEach((spy) => spy.mockRestore())
})

test('waits for session result before showing admin content', async () => {
  sessionResult = () => new Promise(() => {})
  renderRoute()
  expect(screen.queryByText('Admin content')).toBeNull()
  expect(screen.getByText('Checking staff access…')).toBeTruthy()
})

test('allows active staff into a protected route', async () => {
  sessionResult = async () => staffSession
  renderRoute()
  expect(await screen.findByText('Admin content')).toBeTruthy()
})

test('rejects customer session from the admin tree', async () => {
  sessionResult = async () => ({ ...staffSession, user: { ...staffSession.user, accountType: 'customer' }, staff: undefined })
  renderRoute()
  expect(await screen.findByText('Login screen')).toBeTruthy()
  expect(screen.queryByText('Admin content')).toBeNull()
})

test('routes limited staff to confirmed onboarding', async () => {
  sessionResult = async () => ({ ...staffSession, staff: undefined })
  onboardingResult = async () => ({ required: true, userId: 'user-1' })
  renderRoute()
  expect(await screen.findByText('MFA setup')).toBeTruthy()
  expect(screen.queryByText('Admin content')).toBeNull()
})

test('retains an internal deep link for anonymous staff', async () => {
  sessionResult = async () => null
  const { router } = renderRoute('/dashboard?tab=recent')
  expect(await screen.findByText('Login screen')).toBeTruthy()
  expect(router.state.location.state?.from).toBe('/dashboard?tab=recent')
})

test('shows retry after a session network error', async () => {
  sessionResult = async () => { throw new Error('offline') }
  renderRoute()
  expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy()
  expect(screen.queryByText('Login screen')).toBeNull()
})

test('rejects onboarding when the server denies the limited session', async () => {
  sessionResult = async () => ({ ...staffSession, staff: undefined })
  onboardingResult = async () => { throw Object.assign(new Error('expired'), { status: 401 }) }
  renderRoute('/staff/onboarding')
  expect(await screen.findByText('Login screen')).toBeTruthy()
})

test('rechecks staff access before showing another protected page', async () => {
  sessionRequests = 0
  sessionResult = async () => staffSession
  const { router } = renderRoute('/dashboard')
  expect(await screen.findByText('Admin content')).toBeTruthy()
  sessionResult = async () => null
  await act(async () => { await router.navigate('/orders') })
  expect(screen.queryByText('Orders content')).toBeNull()
  expect(await screen.findByText('Login screen')).toBeTruthy()
  expect(sessionRequests).toBeGreaterThanOrEqual(2)
})

test('offers retry for a temporary onboarding status failure', async () => {
  sessionResult = async () => ({ ...staffSession, staff: undefined })
  onboardingResult = async () => { throw Object.assign(new Error('offline'), { status: 0 }) }
  renderRoute('/staff/onboarding')
  expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy()
  expect(screen.queryByText('Login screen')).toBeNull()
})
