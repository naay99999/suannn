import { afterEach, expect, spyOn, test } from 'bun:test'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { createApiClient } from '../src/lib/api'
import * as authClient from '../src/lib/auth-client'
import { authSessionQuery, type AuthSession } from '../src/lib/auth-session'
import { ActiveSessions } from '../src/pages/settings/_components/active-sessions'

const currentId = 'session-current'
const otherId = 'session-other'
const at = new Date('2026-10-16T03:00:00.000Z')
const expires = new Date('2026-10-16T11:00:00.000Z')

function ownSession(id: string, userAgent: string): authClient.OwnStaffSession {
  return { id, createdAt: at, updatedAt: at, expiresAt: expires, ipAddress: '203.0.113.5', userAgent }
}

const session: AuthSession = {
  session: { id: currentId, expiresAt: expires.toISOString() },
  user: { id: 'staff-1', name: 'เจ้าหน้าที่', email: 'staff@example.com', emailVerified: true, image: null, accountType: 'staff' },
  staff: { role: 'support', permissions: ['order:read'] },
}

const activeSpies: Array<{ mockRestore: () => void }> = []
function track<T extends { mockRestore: () => void }>(spy: T): T {
  activeSpies.push(spy)
  return spy
}

function renderSessions() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
  queryClient.setQueryData(authSessionQuery.queryKey, session, { updatedAt: Date.now() + 10_000 })
  const router = createMemoryRouter([
    { path: '/settings', element: <ActiveSessions /> },
    { path: '/login', element: <p>Login page</p> },
  ], { initialEntries: ['/settings'] })
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
  return { queryClient, router }
}

afterEach(() => {
  cleanup()
  activeSpies.splice(0).forEach((spy) => spy.mockRestore())
})

test('lists and revokes own sessions through the staff session routes', async () => {
  const requests: Array<{ url: string; method: string }> = []
  const client = createApiClient('https://api.example.test', async (input, init) => {
    requests.push({ url: String(input), method: init?.method ?? 'GET' })
    return init?.method === 'POST' ? new Response(null, { status: 200 }) : Response.json({ items: [], nextCursor: null })
  })
  const result = await client.auth.staff.sessions.get({ query: { limit: 50, cursor: 'c1' } })
  await client.auth.staff.sessions({ id: otherId }).revoke.post()

  expect(result.error).toBeNull()
  expect(requests.map(({ url, method }) => ({ path: new URL(url).pathname, method }))).toEqual([
    { path: '/api/v1/auth/staff/sessions', method: 'GET' },
    { path: `/api/v1/auth/staff/sessions/${otherId}/revoke`, method: 'POST' },
  ])
  expect(new URL(requests[0]!.url).searchParams.get('cursor')).toBe('c1')
})

test('marks the current device and revokes another session after confirmation', async () => {
  let sessions = [ownSession(currentId, 'Safari on Mac'), ownSession(otherId, 'Chrome on Windows')]
  track(spyOn(authClient, 'listOwnSessions').mockImplementation(async () => ({ items: sessions, nextCursor: null })))
  const revokeSpy = track(spyOn(authClient, 'revokeOwnSession').mockImplementation(async (id) => {
    sessions = sessions.filter((item) => item.id !== id)
  }))
  const user = userEvent.setup()
  renderSessions()

  const list = await screen.findByRole('list', { name: 'Active sessions' })
  const current = within(list).getByText('Safari on Mac').closest('li')!
  expect(within(current).getByText('This device')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Revoke session Chrome on Windows' }))
  expect(await screen.findByText('That device will be signed out immediately.')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Revoke session' }))

  await waitFor(() => expect(revokeSpy).toHaveBeenCalledWith(otherId))
  await waitFor(() => expect(screen.queryByText('Chrome on Windows')).toBeNull())
})

test('revoking the current device clears cached data and returns to login', async () => {
  track(spyOn(authClient, 'listOwnSessions').mockImplementation(async () => ({ items: [ownSession(currentId, 'Safari on Mac')], nextCursor: null })))
  track(spyOn(authClient, 'revokeOwnSession').mockImplementation(async () => undefined))
  const user = userEvent.setup()
  const { queryClient, router } = renderSessions()

  await user.click(await screen.findByRole('button', { name: 'Revoke this device' }))
  expect(await screen.findByText('Sign out this device?')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Revoke session' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  expect(queryClient.getQueryData(authSessionQuery.queryKey)).toBeUndefined()
})

test('loads more sessions with the returned cursor and shows rate-limit errors', async () => {
  const listSpy = track(spyOn(authClient, 'listOwnSessions').mockImplementation(async (cursor) => cursor
    ? { items: [ownSession('session-3', 'Firefox on Linux')], nextCursor: null }
    : { items: [ownSession(otherId, 'Chrome on Windows')], nextCursor: 'cursor-2' }))
  track(spyOn(authClient, 'revokeOwnSession').mockImplementation(async () => {
    throw new authClient.AuthRequestError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.')
  }))
  const user = userEvent.setup()
  renderSessions()

  await user.click(await screen.findByRole('button', { name: 'Load more sessions' }))
  expect(await screen.findByText('Firefox on Linux')).toBeTruthy()
  expect(listSpy).toHaveBeenLastCalledWith('cursor-2')

  await user.click(screen.getByRole('button', { name: 'Revoke session Chrome on Windows' }))
  await user.click(await screen.findByRole('button', { name: 'Revoke session' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Too many attempts. Please try again later.')
})
