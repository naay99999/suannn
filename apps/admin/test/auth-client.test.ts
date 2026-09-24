import { expect, test } from 'bun:test'
import { createAuthClient, AuthRequestError } from '../src/lib/auth-client'

const activeSession = {
  session: { id: 'session-1', expiresAt: '2026-09-24T12:00:00.000Z' },
  user: { id: 'user-1', name: 'Sam', email: 'sam@example.com', emailVerified: true, image: null, accountType: 'staff' },
  staff: { role: 'owner', permissions: ['staff:read'] },
}

test('uses credentialed JSON and recognizes MFA challenge', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = []
  const client = createAuthClient('http://localhost:6767', async (url, init) => {
    requests.push({ url: String(url), init: init ?? {} })
    return Response.json({ twoFactorRedirect: true })
  })

  expect(await client.signIn('sam@example.com', 'password')).toBe('challenge')
  expect(requests[0]?.url).toBe('http://localhost:6767/api/v1/auth/sign-in/email')
  expect(requests[0]?.init.credentials).toBe('include')
  expect((requests[0]!.init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  expect(JSON.parse(String(requests[0]!.init.body))).toEqual({ email: 'sam@example.com', password: 'password' })
})

test('recognizes completed sign-in and active session projection', async () => {
  const client = createAuthClient('http://localhost:6767', async (url, init) => {
    expect(init?.credentials).toBe('include')
    return String(url).endsWith('/get-session')
      ? Response.json(activeSession)
      : Response.json({ token: 'server-token', user: activeSession.user })
  })

  expect(await client.signIn('sam@example.com', 'password')).toBe('session')
  expect(await client.getSession()).toEqual(activeSession)
})

test('maps an expired session to no session', async () => {
  const client = createAuthClient('http://localhost:6767', async () =>
    Response.json({ code: 'SESSION_EXPIRED', message: 'Session expired' }, { status: 401 }))
  expect(await client.getSession()).toBeNull()
})

test('maps safe client errors and hides server exception text', async () => {
  for (const [status, code] of [[400, 'INVALID_CODE'], [401, 'INVALID_EMAIL_OR_PASSWORD'], [410, 'INVITATION_EXPIRED']] as const) {
    const client = createAuthClient('http://localhost:6767', async () =>
      Response.json({ code, message: 'Safe message' }, { status }))
    await expect(client.signIn('sam@example.com', 'bad')).rejects.toMatchObject({ status, code, message: 'Safe message' })
  }

  const limited = createAuthClient('http://localhost:6767', async () =>
    Response.json({ code: 'RATE_LIMITED', message: 'Safe message' }, { status: 429 }))
  await expect(limited.signIn('sam@example.com', 'bad')).rejects.toMatchObject({
    status: 429, code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.',
  })

  const client = createAuthClient('http://localhost:6767', async () =>
    Response.json({ code: 'INTERNAL_ERROR', message: 'database password leaked' }, { status: 500 }))
  try {
    await client.signIn('sam@example.com', 'bad')
    throw new Error('Expected error')
  } catch (error) {
    expect(error).toBeInstanceOf(AuthRequestError)
    expect((error as Error).message).not.toContain('database password')
  }
})
