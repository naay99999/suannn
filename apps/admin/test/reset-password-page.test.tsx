import { afterEach, expect, spyOn, test } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'

const { Component: ResetPasswordPage } = await import('../src/pages/login/reset-password-page')
const { LoginForm } = await import('../src/pages/login/_components/login-form')

const spies: Array<{ mockRestore: () => void }> = []
const EXPIRED = 'ลิงก์หมดอายุหรือใช้ไปแล้ว กรุณาขอลิงก์ใหม่จากผู้ดูแล'

afterEach(() => {
  cleanup()
  spies.splice(0).forEach((spy) => spy.mockRestore())
})

function renderAt(url: string) {
  const router = createMemoryRouter([
    { path: '/reset-password', Component: ResetPasswordPage },
    { path: '/login', Component: LoginForm },
  ], { initialEntries: [url] })
  render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}

test('sets the password from the token and returns to login with a notice', async () => {
  const bodies: unknown[] = []
  spies.push(spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    expect(new URL(input instanceof Request ? input.url : String(input)).pathname).toBe('/api/v1/staff-auth/reset-password')
    bodies.push(JSON.parse(String(init?.body)))
    return Response.json({ status: true })
  }))
  const router = renderAt('/reset-password?token=abc')
  const user = userEvent.setup()

  await user.type(screen.getByLabelText('New password'), 'short')
  await user.type(screen.getByLabelText('Confirm password'), 'short')
  await user.click(screen.getByRole('button', { name: 'Set new password' }))
  expect(await screen.findByText('Password must be at least 12 characters')).toBeTruthy()
  expect(bodies).toHaveLength(0)

  await user.clear(screen.getByLabelText('New password'))
  await user.clear(screen.getByLabelText('Confirm password'))
  await user.type(screen.getByLabelText('New password'), 'correct horse battery')
  await user.type(screen.getByLabelText('Confirm password'), 'different horse battery')
  await user.click(screen.getByRole('button', { name: 'Set new password' }))
  expect(await screen.findByText('Passwords do not match')).toBeTruthy()
  expect(bodies).toHaveLength(0)

  await user.clear(screen.getByLabelText('Confirm password'))
  await user.type(screen.getByLabelText('Confirm password'), 'correct horse battery')
  await user.click(screen.getByRole('button', { name: 'Set new password' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  expect(bodies).toEqual([{ token: 'abc', newPassword: 'correct horse battery' }])
  expect(await screen.findByText('ตั้งรหัสผ่านใหม่แล้ว กรุณาเข้าสู่ระบบ')).toBeTruthy()
})

test('shows the expired message and no form for an invalid or missing token', () => {
  renderAt('/reset-password?error=INVALID_TOKEN')
  expect(screen.getByText(EXPIRED)).toBeTruthy()
  expect(screen.queryByLabelText('New password')).toBeNull()
  cleanup()

  renderAt('/reset-password')
  expect(screen.getByText(EXPIRED)).toBeTruthy()
  expect(screen.queryByLabelText('New password')).toBeNull()
})

test('shows the expired message when the server rejects the token', async () => {
  spies.push(spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Response.json({ code: 'INVALID_TOKEN', message: 'Invalid token' }, { status: 400 })))
  renderAt('/reset-password?token=old')
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('New password'), 'correct horse battery')
  await user.type(screen.getByLabelText('Confirm password'), 'correct horse battery')
  await user.click(screen.getByRole('button', { name: 'Set new password' }))
  expect(await screen.findByText(EXPIRED)).toBeTruthy()
})
