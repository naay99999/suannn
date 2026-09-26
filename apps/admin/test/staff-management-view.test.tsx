import './setup'
import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
const { default: userEvent } = await import('@testing-library/user-event')

mock.module('../src/pages/settings/_components/staff-management-api', () => ({
  listStaff: async () => ({ items: [{ id: 'staff-1', name: 'Support User', email: 'support@example.com', role: 'support', banned: false, staffActivatedAt: '2026-01-01T00:00:00.000Z' }], nextCursor: null }),
  listStaffInvitations: async () => ({ items: [{ id: 'invite-1', email: 'new@example.com', role: 'catalog_manager', expiresAt: '2026-12-01T00:00:00.000Z', acceptedAt: null, revokedAt: null }], nextCursor: null }),
  inviteStaff: async () => undefined,
  changeStaffRole: async () => undefined,
  suspendStaff: async () => undefined,
  reactivateStaff: async () => undefined,
  revokeStaffSessions: async () => undefined,
  resetStaffMfa: async () => undefined,
  resendStaffInvitation: async () => undefined,
  cancelStaffInvitation: async () => undefined,
}))

const { StaffManagementContent } = await import('../src/pages/settings/_components/staff-management')
const session = {
  session: { id: 'session-1', expiresAt: '2026-12-01T00:00:00.000Z' },
  user: { id: 'owner-1', name: 'Owner', email: 'owner@example.com', emailVerified: true, image: null, accountType: 'staff' as const },
  staff: { role: 'owner' as const, permissions: ['staff:read', 'staff:invite', 'staff:change-role', 'staff:suspend', 'staff:revoke-session', 'staff:reset-mfa'] },
}

function renderStaffManagement() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><StaffManagementContent session={session} /></QueryClientProvider>)
}

afterEach(() => cleanup())

test('shows staff and invitation management with their server data', async () => {
  const view = renderStaffManagement()
  expect(await view.findByText('Support User')).toBeTruthy()
  expect(view.getByText('support@example.com')).toBeTruthy()
  await act(async () => fireEvent.click(view.getByRole('tab', { name: 'Invitations' })))
  expect(await view.findByText('new@example.com')).toBeTruthy()
  expect(view.getByText('Pending')).toBeTruthy()
})

test('requires a reason before confirming a staff suspension', async () => {
  const view = renderStaffManagement()
  const user = userEvent.setup()
  await view.findByText('Support User')
  await user.click(view.getByRole('button', { name: 'Actions for Support User' }))
  await user.click(await view.findByRole('menuitem', { name: 'Suspend account' }))
  expect(await view.findByRole('dialog', { name: 'Suspend staff account' })).toBeTruthy()
  const suspendButton = view.getByRole('button', { name: 'Suspend account' }) as HTMLButtonElement
  expect(suspendButton.disabled).toBe(true)
  await user.type(view.getByLabelText('Reason'), 'Access review requested')
  expect(suspendButton.disabled).toBe(false)
})
