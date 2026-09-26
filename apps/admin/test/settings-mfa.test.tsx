import { afterEach, expect, mock, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let regenerateInput: string | undefined
let regenerateResult: () => Promise<{ backupCodes: string[] }> = async () => ({ backupCodes: ['new-code-1', 'new-code-2'] })

mock.module('../src/lib/auth-client', () => ({
  regenerateBackupCodes: (password: string) => {
    regenerateInput = password
    return regenerateResult()
  },
  AuthRequestError: class extends Error {},
}))

const { SecuritySettings } = await import('../src/pages/settings/_components/security-settings')

afterEach(() => {
  cleanup()
  regenerateInput = undefined
  regenerateResult = async () => ({ backupCodes: ['new-code-1', 'new-code-2'] })
})

test('requires confirmation and a password before replacing backup codes', async () => {
  render(<SecuritySettings />)
  const user = userEvent.setup()
  const regenerate = screen.getByRole('button', { name: 'Regenerate backup codes' })
  expect((regenerate as HTMLButtonElement).disabled).toBe(true)
  await user.type(screen.getByLabelText('Current password'), 'owner-password-123')
  await user.click(screen.getByRole('checkbox', { name: 'I understand my existing codes will stop working' }))
  expect((regenerate as HTMLButtonElement).disabled).toBe(false)
  await user.click(regenerate)
  expect(regenerateInput).toBe('owner-password-123')
  expect(await screen.findByText('new-code-1')).toBeTruthy()
  expect(screen.getByText('new-code-2')).toBeTruthy()
  expect(screen.getByText('Existing backup codes have been replaced. Save this new set now.')).toBeTruthy()
})

test('keeps the current valid codes visible when a later regeneration fails', async () => {
  regenerateResult = async () => { throw new Error('Invalid password') }
  render(<SecuritySettings />)
  const user = userEvent.setup()
  regenerateResult = async () => ({ backupCodes: ['current-code-1', 'current-code-2'] })
  await user.type(screen.getByLabelText('Current password'), 'owner-password-123')
  await user.click(screen.getByRole('checkbox', { name: 'I understand my existing codes will stop working' }))
  await user.click(screen.getByRole('button', { name: 'Regenerate backup codes' }))
  expect(await screen.findByText('current-code-1')).toBeTruthy()
  regenerateResult = async () => { throw new Error('Invalid password') }
  await user.type(screen.getByLabelText('Current password'), 'wrong-password')
  await user.click(screen.getByRole('checkbox', { name: 'I understand my existing codes will stop working' }))
  await user.click(screen.getByRole('button', { name: 'Regenerate backup codes' }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByText('current-code-1')).toBeTruthy()
  expect(screen.getByText('current-code-2')).toBeTruthy()
})

test('does not expose codes before a successful regeneration', async () => {
  regenerateResult = async () => { throw new Error('Invalid password') }
  render(<SecuritySettings />)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Current password'), 'wrong-password')
  await user.click(screen.getByRole('checkbox', { name: 'I understand my existing codes will stop working' }))
  await user.click(screen.getByRole('button', { name: 'Regenerate backup codes' }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByText('new-code-1')).toBeNull()
})
