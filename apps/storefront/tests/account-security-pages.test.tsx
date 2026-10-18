import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Toaster } from '@workspace/ui/components/toast'
import { Component as SecurityPage } from '../src/pages/account/security-page'
import { Component as ProfilePage } from '../src/pages/account/profile-page'
import { authSessionQuery } from '../src/lib/auth-session'
import { profileQueryKey } from '../src/pages/account/account-queries'

const userId = 'user-1'
const sessionData = { session: { id: 'session-1', expiresAt: '' }, user: { id: userId, name: 'มะลิ', email: 'mali@example.test', emailVerified: false, image: null, accountType: 'customer' } }
const originalFetch = globalThis.fetch

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

function renderAt(path: string, respond: (url: string, body: unknown) => Response | undefined) {
  const calls: { url: string; body: unknown }[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ url, body })
    return respond(url, body) ?? new Promise<Response>(() => {})
  }) as typeof fetch
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } } })
  queryClient.setQueryData(authSessionQuery.queryKey, sessionData)
  queryClient.setQueryData(profileQueryKey(userId), { name: 'มะลิ', email: 'mali@example.test', emailVerified: false })
  const router = createMemoryRouter([
    { path: '/account/security', Component: SecurityPage },
    { path: '/account/profile', Component: ProfilePage },
  ], { initialEntries: [path] })
  render(<QueryClientProvider client={queryClient}><Toaster><RouterProvider router={router} /></Toaster></QueryClientProvider>)
  return { calls, router }
}

async function openPasswordEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'เปลี่ยนรหัสผ่าน' }))
  await waitFor(() => expect(document.activeElement?.id).toBe('current-password'))
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('a wrong current password is reported on that field', async () => {
  renderAt('/account/security', url => url.endsWith('/change-password') ? json(400, { code: 'INVALID_PASSWORD', message: 'Invalid password' }) : undefined)
  const user = userEvent.setup()
  await openPasswordEditor(user)

  await user.type(screen.getByLabelText('รหัสผ่านปัจจุบัน'), 'old-password-1')
  await user.type(screen.getByLabelText('รหัสผ่านใหม่'), 'a-new-long-passphrase')
  await user.type(screen.getByLabelText('ยืนยันรหัสผ่านใหม่'), 'a-new-long-passphrase')
  await user.click(screen.getByRole('button', { name: 'บันทึกรหัสผ่านใหม่' }))

  expect(await screen.findByText('รหัสผ่านปัจจุบันไม่ถูกต้อง')).toBeTruthy()
  expect(screen.getByLabelText('รหัสผ่านปัจจุบัน').getAttribute('aria-invalid')).toBe('true')
})

test('changing the password signs out other devices by default', async () => {
  const { calls } = renderAt('/account/security', url => url.endsWith('/change-password') ? json(200, { token: null }) : undefined)
  const user = userEvent.setup()
  await openPasswordEditor(user)

  await user.type(screen.getByLabelText('รหัสผ่านปัจจุบัน'), 'old-password-1')
  await user.type(screen.getByLabelText('รหัสผ่านใหม่'), 'a-new-long-passphrase')
  await user.type(screen.getByLabelText('ยืนยันรหัสผ่านใหม่'), 'a-new-long-passphrase')
  await user.click(screen.getByRole('button', { name: 'บันทึกรหัสผ่านใหม่' }))

  await waitFor(() => expect(calls.find(call => call.url.endsWith('/change-password'))?.body).toMatchObject({ revokeOtherSessions: true }))
  await waitFor(() => expect(screen.queryByLabelText('รหัสผ่านปัจจุบัน')).toBeNull())
  await waitFor(() => expect(document.activeElement?.textContent).toBe('เปลี่ยนรหัสผ่าน'))
})

test('signed-in devices are plain rows in one list, with long IPv6 addresses allowed to wrap', async () => {
  renderAt('/account/security', url => url.endsWith('/list-sessions') ? json(200, [
    { id: 'session-1', token: 't1', userAgent: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z', ipAddress: '2001:0db8:85a3:0000:0000:8a2e:0370:7334' },
    { id: 'session-2', token: 't2', userAgent: null, createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z', ipAddress: '10.0.0.2' },
  ]) : undefined)

  const list = await screen.findByRole('list', { name: 'อุปกรณ์ที่เข้าสู่ระบบ' })
  expect(list.querySelectorAll(':scope > li')).toHaveLength(2)
  expect(list.querySelector('li')?.className).not.toContain('border')
  expect(screen.getByText('2001:0db8:85a3:0000:0000:8a2e:0370:7334').className).toContain('break-all')
  expect(screen.getByRole('button', { name: 'ออกจากระบบในอุปกรณ์อื่นทั้งหมด' })).toBeTruthy()
})

test('rejects reusing the current password before calling the server', async () => {
  const { calls } = renderAt('/account/security', () => undefined)
  const user = userEvent.setup()
  await openPasswordEditor(user)

  await user.type(screen.getByLabelText('รหัสผ่านปัจจุบัน'), 'same-long-password')
  await user.type(screen.getByLabelText('รหัสผ่านใหม่'), 'same-long-password')
  await user.type(screen.getByLabelText('ยืนยันรหัสผ่านใหม่'), 'same-long-password')
  await user.click(screen.getByRole('button', { name: 'บันทึกรหัสผ่านใหม่' }))

  expect(await screen.findByText('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน')).toBeTruthy()
  expect(calls.some(call => call.url.endsWith('/change-password'))).toBe(false)
})

test('old verification links that land on security move to the profile email section', async () => {
  const { router } = renderAt('/account/security?error=TOKEN_EXPIRED', () => undefined)

  await waitFor(() => expect(router.state.location.pathname).toBe('/account/profile'))
  expect(await screen.findByText(/ลิงก์ยืนยันอีเมลหมดอายุ/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'ส่งลิงก์ยืนยันอีกครั้ง' })).toBeTruthy()
})

test('profile shows one verification status with its resend action', async () => {
  renderAt('/account/profile', () => undefined)

  expect(await screen.findByText('ยังไม่ยืนยัน')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'ส่งลิงก์ยืนยันอีกครั้ง' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'ยกเลิก' })).toBeNull()
})

test('the eye button reveals and hides only its own password field', async () => {
  renderAt('/account/security', () => undefined)
  const user = userEvent.setup()
  await openPasswordEditor(user)
  const current = screen.getByLabelText('รหัสผ่านปัจจุบัน')
  const toggles = screen.getAllByRole('button', { name: 'แสดงรหัสผ่าน' })

  expect(current.getAttribute('type')).toBe('password')
  await user.click(toggles[0]!)
  expect(current.getAttribute('type')).toBe('text')
  expect(screen.getByLabelText('รหัสผ่านใหม่').getAttribute('type')).toBe('password')
  const hide = screen.getByRole('button', { name: 'ซ่อนรหัสผ่าน' })
  expect(hide.getAttribute('aria-pressed')).toBe('true')
  await user.click(hide)
  expect(current.getAttribute('type')).toBe('password')
})

test('email change opens inline in its row and returns focus when cancelled', async () => {
  renderAt('/account/profile', () => undefined)
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: 'เปลี่ยนอีเมล' }))
  await waitFor(() => expect(document.activeElement?.id).toBe('new-account-email'))
  expect(screen.queryByRole('button', { name: 'เปลี่ยนอีเมล' })).toBeNull()

  await user.click(screen.getByRole('button', { name: 'ยกเลิก' }))
  await waitFor(() => expect(document.activeElement?.textContent).toBe('เปลี่ยนอีเมล'))
})

test('renaming opens an inline editor that closes after saving', async () => {
  renderAt('/account/profile', url => url.includes('/customer/profile') ? json(200, { name: 'มะลิ ใจดี', email: 'mali@example.test', emailVerified: false }) : undefined)
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: 'แก้ไขชื่อ' }))
  const input = screen.getByLabelText('ชื่อที่แสดง')
  await user.clear(input)
  await user.type(input, 'มะลิ ใจดี')
  await user.click(screen.getByRole('button', { name: 'บันทึกชื่อ' }))

  await waitFor(() => expect(screen.queryByLabelText('ชื่อที่แสดง')).toBeNull())
  await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('แก้ไขชื่อ'))
})
