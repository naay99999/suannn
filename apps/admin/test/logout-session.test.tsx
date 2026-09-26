import { afterEach, expect, mock, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SidebarProvider } from '@workspace/ui/components/sidebar'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { AuthSession } from '../src/lib/auth-session'

let signOutResult: () => Promise<void> = async () => undefined
mock.module('../src/lib/auth-client', () => ({ signOut: () => signOutResult() }))

const { StaffAccountMenu } = await import('../src/components/layout/staff-account-menu')
const { handleApiAuthResponse } = await import('../src/lib/api')

const staffSession: AuthSession = {
  session: { id: 'session-1', expiresAt: '2026-09-24T12:00:00.000Z' },
  user: { id: 'user-1', name: 'Sam Staff', email: 'sam@example.com', emailVerified: true, image: null, accountType: 'staff' },
  staff: { role: 'owner', permissions: ['staff:read'] },
}

function renderMenu() {
  const client = new QueryClient()
  client.setQueryData(['private', 'orders'], ['order-1'])
  const router = createMemoryRouter([
    { path: '/dashboard', element: <StaffAccountMenu session={staffSession} /> },
    { path: '/login', element: <div>Login screen</div> },
  ], { initialEntries: ['/dashboard'] })
  render(<QueryClientProvider client={client}><SidebarProvider><RouterProvider router={router} /></SidebarProvider></QueryClientProvider>)
  return { client, router }
}

afterEach(() => cleanup())

test('shows the current staff identity and clears private cache on logout', async () => {
  signOutResult = async () => undefined
  const { client, router } = renderMenu()
  expect(screen.getByText('Sam Staff')).toBeTruthy()
  expect(screen.getByText('sam@example.com')).toBeTruthy()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Sam Staff account menu' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
  expect(await screen.findByText('Login screen')).toBeTruthy()
  expect(router.state.location.pathname).toBe('/login')
  expect(client.getQueryData(['private', 'orders'])).toBeUndefined()
})

test('opens each settings section from the account menu', async () => {
  const { router } = renderMenu()
  const user = userEvent.setup()
  const sections = ['Profile', 'Account', 'Security', 'Appearance', 'Notifications']

  for (const section of sections) {
    await user.click(screen.getByRole('button', { name: 'Sam Staff account menu' }))
    await user.click(await screen.findByRole('menuitem', { name: section }))
    expect(router.state.location.hash).toBe(`#settings/${section.toLowerCase()}`)
  }
})

test('disables duplicate logout while the request is pending', async () => {
  signOutResult = () => new Promise(() => {})
  renderMenu()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Sam Staff account menu' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
  expect((await screen.findByRole('menuitem', { name: 'Signing out…' })).getAttribute('aria-disabled')).toBe('true')
})

test('keeps the staff page available when logout fails', async () => {
  signOutResult = async () => { throw new Error('offline') }
  const { client } = renderMenu()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Sam Staff account menu' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Could not sign out. Try again.')
  expect(client.getQueryData(['private', 'orders'])).toEqual(['order-1'])
})

test('invalidates auth on expired protected response but preserves it on permission denial', async () => {
  const client = new QueryClient()
  client.setQueryData(['auth', 'session'], staffSession)
  client.setQueryData(['private', 'orders'], ['order-1'])
  await handleApiAuthResponse(Response.json({ code: 'PERMISSION_DENIED', message: 'Denied' }, { status: 403 }), client)
  expect(client.getQueryState(['auth', 'session'])?.isInvalidated).toBe(false)
  expect(client.getQueryData(['private', 'orders'])).toEqual(['order-1'])
  await handleApiAuthResponse(Response.json({ code: 'SESSION_EXPIRED', message: 'Expired' }, { status: 401 }), client)
  expect(client.getQueryState(['auth', 'session'])?.isInvalidated).toBe(true)
  expect(client.getQueryData(['private', 'orders'])).toBeUndefined()
})
