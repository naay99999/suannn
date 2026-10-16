import { afterEach, expect, spyOn, test } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import { authSessionQuery } from '../src/lib/auth-session'
import { Component as SignInPage } from '../src/pages/auth/sign-in-page'
import { Component as SignUpPage } from '../src/pages/auth/sign-up-page'
import { Component as ForgotPasswordPage } from '../src/pages/auth/forgot-password-page'
import { Component as ResetPasswordPage } from '../src/pages/auth/reset-password-page'

const clients: QueryClient[] = []

afterEach(() => {
  cleanup()
  for (const client of clients) client.clear()
  clients.length = 0
})

function mount(page: ReactNode) {
  const client = new QueryClient()
  clients.push(client)
  client.setQueryDefaults(authSessionQuery.queryKey, { enabled: false })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/reset-password?token=test-token']}>{page}</MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

for (const { name, page, labels } of [
  { name: 'sign in', page: <SignInPage />, labels: ['อีเมล', 'รหัสผ่าน'] },
  { name: 'sign up', page: <SignUpPage />, labels: ['ชื่อที่แสดง', 'อีเมล', 'รหัสผ่าน', 'ยืนยันรหัสผ่าน'] },
  { name: 'forgot password', page: <ForgotPasswordPage />, labels: ['อีเมล'] },
  { name: 'reset password', page: <ResetPasswordPage />, labels: ['รหัสผ่านใหม่', 'ยืนยันรหัสผ่านใหม่'] },
]) {
  test(`${name} shows required errors when empty fields lose focus`, async () => {
    const user = mount(page)
    expect(screen.queryByRole('alert')).toBeNull()
    for (const label of labels) {
      const input = screen.getByLabelText(label)
      await user.click(input)
      await user.tab()
      await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'))
      const errorId = input.getAttribute('aria-describedby')!.split(' ').at(-1)!
      expect(document.getElementById(errorId)?.textContent).toBeTruthy()
    }
  })

  test(`${name} blocks submitting an invalid form and focuses the first error`, async () => {
    const user = mount(page)
    const request = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected auth request'))
    try {
      await user.click(screen.getByRole('button'))
      const firstInput = screen.getByLabelText(labels[0]!)
      await waitFor(() => expect(firstInput.getAttribute('aria-invalid')).toBe('true'))
      expect(document.activeElement).toBe(firstInput)
      expect(request).not.toHaveBeenCalled()
    } finally {
      request.mockRestore()
    }
  })
}

for (const { name, page, passwordLabel, confirmLabel } of [
  { name: 'sign up', page: <SignUpPage />, passwordLabel: 'รหัสผ่าน', confirmLabel: 'ยืนยันรหัสผ่าน' },
  { name: 'reset password', page: <ResetPasswordPage />, passwordLabel: 'รหัสผ่านใหม่', confirmLabel: 'ยืนยันรหัสผ่านใหม่' },
]) {
  test(`${name} revalidates confirmation when the original password changes`, async () => {
    const user = mount(page)
    const password = screen.getByLabelText(passwordLabel)
    const confirm = screen.getByLabelText(confirmLabel)
    await user.type(password, 'strongpassword123')
    await user.tab()
    expect(confirm.getAttribute('aria-invalid')).toBe('false')
    await user.type(confirm, 'strongpassword123')
    await user.tab()
    expect(confirm.getAttribute('aria-invalid')).toBe('false')
    await user.type(password, '4')
    await waitFor(() => expect(confirm.getAttribute('aria-invalid')).toBe('true'))
    await user.type(confirm, '4')
    await waitFor(() => expect(confirm.getAttribute('aria-invalid')).toBe('false'))
  })
}

test('email validation clears while correcting a touched field', async () => {
  const user = mount(<ForgotPasswordPage />)
  const email = screen.getByLabelText('อีเมล')
  await user.type(email, 'invalid')
  await user.tab()
  await waitFor(() => expect(email.getAttribute('aria-invalid')).toBe('true'))
  await user.clear(email)
  await user.type(email, 'mali@example.com')
  await waitFor(() => expect(email.getAttribute('aria-invalid')).toBe('false'))
})
