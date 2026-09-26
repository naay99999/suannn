import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BackupCodesPanel } from '../src/components/auth/backup-codes-panel'

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'clipboard')
})

test('explains how to copy backup codes when clipboard access is unavailable', async () => {
  render(<BackupCodesPanel codes={['backup-123']} />)
  const user = userEvent.setup()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => { throw new Error('CLIPBOARD_UNAVAILABLE') } },
  })
  await user.click(screen.getByRole('button', { name: 'Copy backup codes' }))
  expect(await screen.findByText('Clipboard is unavailable. Select the codes above to copy them.')).toBeTruthy()
})
