import { expect, test } from 'bun:test'
import { classifySession, type AuthSession } from '../src/lib/auth-session'

function session(accountType: 'customer' | 'staff', active = false): AuthSession {
  return {
    session: { id: 'session-1', expiresAt: '2026-09-24T12:00:00.000Z' },
    user: { id: 'user-1', name: 'Sam', email: 'sam@example.com', emailVerified: true, image: null, accountType },
    ...(active ? { staff: { role: 'owner' as const, permissions: [] } } : {}),
  }
}

test('classifies only a staff projection as active admin access', () => {
  expect(classifySession(null)).toBe('anonymous')
  expect(classifySession(session('customer'))).toBe('customer')
  expect(classifySession(session('staff'))).toBe('onboarding')
  expect(classifySession(session('staff', true))).toBe('active')
})
