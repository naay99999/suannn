import { describe, expect, test } from 'bun:test'
import { AuthRequestError, createAuthClient } from '../src/lib/auth-client'

const customerSession = {
  session: { id: 'session-1', expiresAt: '2026-10-01T00:00:00.000Z' },
  user: {
    id: 'customer-1', name: 'มะลิ', email: 'mali@example.com', emailVerified: false,
    image: null, accountType: 'customer',
  },
}

function jsonFetch(body: unknown, status = 200) {
  const calls: { url: string; credentials: RequestCredentials | undefined; method: string }[] = []
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input), credentials: init?.credentials,
      method: init?.method ?? 'GET',
    })
    return Response.json(body, { status })
  }
  return { calls, fetcher }
}

describe('storefront auth client', () => {
  test('requests the exact session path with cookies and accepts a customer session', async () => {
    const { calls, fetcher } = jsonFetch(customerSession)
    const client = createAuthClient('http://localhost:6767', fetcher)

    expect(await client.getSession()).toEqual(customerSession)
    expect(calls).toEqual([{
      url: 'http://localhost:6767/api/v1/auth/get-session',
      credentials: 'include', method: 'GET',
    }])
  })

  test('returns null only for an anonymous session', async () => {
    const client = createAuthClient('http://localhost:6767', jsonFetch(null).fetcher)
    expect(await client.getSession()).toBeNull()
  })

  test('retains a staff session for the guard to reject', async () => {
    const staff = { ...customerSession, user: { ...customerSession.user, accountType: 'staff' } }
    const client = createAuthClient('http://localhost:6767', jsonFetch(staff).fetcher)
    expect((await client.getSession())?.user.accountType).toBe('staff')
  })

  test('keeps session expiry distinct from a network error', async () => {
    const expired = createAuthClient('http://localhost:6767', jsonFetch({ code: 'SESSION_EXPIRED' }, 401).fetcher)
    expect(await expired.getSession()).toBeNull()
    const unreachable = createAuthClient('http://localhost:6767', async () => { throw new Error('offline') })
    expect(unreachable.getSession()).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 })
  })

  test('rejects malformed success responses', async () => {
    const client = createAuthClient('http://localhost:6767', jsonFetch({ user: { id: 'x' } }).fetcher)
    expect(client.getSession()).rejects.toBeInstanceOf(AuthRequestError)
    expect(client.getSession()).rejects.toMatchObject({ code: 'INVALID_SESSION_RESPONSE' })
  })

  test('does not treat invalid JSON as an anonymous session', async () => {
    const client = createAuthClient('http://localhost:6767', async () => new Response('<html>bad gateway</html>', { status: 200 }))
    expect(client.getSession()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  test('supplies a storefront callback for verification email', async () => {
    let body: unknown
    const client = createAuthClient('http://localhost:6767', async (_input, init) => {
      body = JSON.parse(String(init?.body))
      return Response.json({ status: true })
    })
    await client.sendVerificationEmail('mali@example.com', 'http://localhost:5183/account/security')
    expect(body).toEqual({ email: 'mali@example.com', callbackURL: 'http://localhost:5183/account/security' })
  })

  test('signs in at the email route with cookies and returns challenge state', async () => {
    const { calls, fetcher } = jsonFetch({ twoFactorRedirect: true })
    const client = createAuthClient('http://localhost:6767', fetcher)
    expect(await client.signIn('mali@example.com', 'password123456')).toBe('challenge')
    expect(calls).toEqual([{
      url: 'http://localhost:6767/api/v1/auth/sign-in/email',
      credentials: 'include', method: 'POST',
    }])
  })
})
