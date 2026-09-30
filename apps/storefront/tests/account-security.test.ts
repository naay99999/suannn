import { expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { expireSecuritySession, parseCustomerSessions, performRevokeSession, performSignOut, securityFailureMessage, verificationSentMessage } from '../src/pages/account/customer-security'
import { AuthRequestError } from '../src/lib/auth-client'

test('sign-out removes account and session cache after the server accepts it', async () => {
  const client = new QueryClient()
  client.setQueryData(['auth', 'session'], { user: { id: 'customer-1' } })
  client.setQueryData(['customer-account', 'customer-1', 'profile'], { name: 'มะลิ' })
  client.setQueryData(['store-cart'], { cartVersion: 1, lines: [] })
  await performSignOut(client, async () => undefined)
  expect(client.getQueryData(['auth', 'session'])).toBeNull()
  expect(client.getQueryData(['customer-account', 'customer-1', 'profile'])).toBeUndefined()
  expect(client.getQueryData(['store-cart'])).toBeUndefined()
})

test('revoking the current session clears the account, while another session stays signed in', async () => {
  const client = new QueryClient()
  client.setQueryData(['auth', 'session'], { user: { id: 'customer-1' } })
  const revoked: string[] = []
  expect(await performRevokeSession(client, 'other-token', false, async token => { revoked.push(token) })).toBe(false)
  expect(client.getQueryData(['auth', 'session'])).not.toBeNull()
  expect(await performRevokeSession(client, 'current-token', true, async token => { revoked.push(token) })).toBe(true)
  expect(client.getQueryData(['auth', 'session'])).toBeNull()
  expect(revoked).toEqual(['other-token', 'current-token'])
})

test('verification and password failures use privacy-safe messages', () => {
  expect(verificationSentMessage).toContain('หาก')
  expect(securityFailureMessage(new Error('secret-pass-123'))).not.toContain('secret-pass-123')
})

test('parses only usable session rows from Better Auth', () => {
  expect(parseCustomerSessions([
    { id: 'one', token: 'token-1', userAgent: 'Browser', createdAt: '2026-09-01T00:00:00Z' },
    { id: 'bad', userAgent: 'Missing token' },
  ])).toEqual([{ id: 'one', token: 'token-1', userAgent: 'Browser', createdAt: '2026-09-01T00:00:00Z' }])
})

test('security 401 clears session and protected cache; server errors remain retryable', () => {
  const client = new QueryClient()
  client.setQueryData(['auth', 'session'], { user: { id: 'customer-1' } })
  client.setQueryData(['customer-account', 'customer-1', 'sessions'], ['secret'])
  expect(expireSecuritySession(client, new AuthRequestError(500, 'SERVER_ERROR', 'oops'))).toBe(false)
  expect(client.getQueryData(['customer-account', 'customer-1', 'sessions'])).toEqual(['secret'])
  expect(expireSecuritySession(client, new AuthRequestError(401, 'UNAUTHORIZED', 'no'))).toBe(true)
  expect(client.getQueryData(['auth', 'session'])).toBeNull()
  expect(client.getQueryData(['customer-account', 'customer-1', 'sessions'])).toBeUndefined()
})
