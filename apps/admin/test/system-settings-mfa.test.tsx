import { afterEach, expect, mock, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let required = true
const changes: boolean[] = []
mock.module('../src/pages/settings/_components/system-settings-api', () => ({
  getSecuritySettings: async () => ({ staffMfaRequired: required }),
  setStaffMfaRequired: async (value: boolean) => {
    changes.push(value)
    required = value
    return { staffMfaRequired: value }
  },
}))

const { FeatureControls } = await import('../src/pages/settings/_components/feature-controls')

function renderControls() {
  const router = createMemoryRouter([
    { path: '/settings', element: <FeatureControls /> },
    { path: '/login', element: <p>Login page</p> },
  ], { initialEntries: ['/settings'] })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}

afterEach(() => {
  cleanup()
  required = true
  changes.length = 0
})

test('loads the current staff MFA policy and saves the disabled state', async () => {
  renderControls()
  const user = userEvent.setup()
  const toggle = await screen.findByRole('switch', { name: 'Require MFA for all staff' })

  expect(toggle.getAttribute('aria-checked')).toBe('true')
  await user.click(toggle)

  expect(await screen.findByText('MFA requirement is off. Staff can sign in with email and password.')).toBeTruthy()
  expect(changes).toEqual([false])
})

test('requires staff to sign in again after enabling MFA', async () => {
  required = false
  const router = renderControls()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('switch', { name: 'Require MFA for all staff' }))

  expect(await screen.findByText('MFA is enabled. All staff sessions have ended. Sign in again to continue.')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Sign in again' }))
  expect(router.state.location.pathname).toBe('/login')
  expect(changes).toEqual([true])
})
