import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { SidebarProvider } from '@workspace/ui/components/sidebar'

const { SettingsWorkspace } = await import('../src/pages/settings/_components/settings-workspace')

function renderSettings(initialEntry: string) {
  const router = createMemoryRouter([
    { path: '/dashboard', element: <SidebarProvider><SettingsWorkspace /></SidebarProvider> },
  ], { initialEntries: [initialEntry] })
  render(<RouterProvider router={router} />)
  return router
}

afterEach(() => cleanup())

test('defaults the legacy settings hash to Profile and syncs section navigation to the hash', async () => {
  const router = renderSettings('/dashboard#settings')
  expect(screen.getByText('Account settings / Profile')).toBeTruthy()

  await userEvent.setup().click(screen.getAllByRole('button', { name: 'Security' })[0])

  expect(router.state.location.hash).toBe('#settings/security')
  expect(screen.getByText('Account settings / Security')).toBeTruthy()
})

test('opens the selected settings section from its hash', () => {
  renderSettings('/dashboard#settings/notifications')

  expect(screen.getByText('Account settings / Notifications')).toBeTruthy()
})
